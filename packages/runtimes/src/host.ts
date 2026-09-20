/**
 * The RuntimeHost — executes DECLARED operations against DECLARED runtimes
 * (Work Order W12) with the authority gate, the observation record and the
 * trace links.
 *
 * EXECUTION IS AUTHORITY CHECKED: every execution request carries a grant
 * reference; the host resolves it from the operator-supplied grant pool and
 * validates it through @sos-2/authority's `evaluateGrant` BEFORE running
 * anything. Expired, revoked, missing or unknown grants yield
 * EXECUTION_DENIED with a STRUCTURED reason ({ code, grant_ref, reason })
 * — the operation never runs (pinned by tests with run-flag probes).
 *
 * EVERY EXECUTION EMITS A TYPED OBSERVATION RECORD (evidence-shaped,
 * truthful availability) linked to the SystemState revision it observed:
 * when the request carries a subject and an observed SystemState id, the
 * host mints an OBSERVES (or, for verification executions, VERIFIES) trace
 * link through the spine's createTraceLink and stores it in the host's
 * trace link store. RUNTIME OBSERVATIONS NEVER MUTATE SYSTEM STATE
 * DIRECTLY — they are input to reconciliation; the observation carries the
 * SystemState REFERENCE only, and the host exposes no system-state write
 * path (structurally impossible; pinned by tests).
 *
 * Loud failures (RuntimeError): unknown runtimes, undeclared operations,
 * missing handlers and malformed requests — contract violations, not
 * operational outcomes. Operational denials are structured results.
 *
 * DETERMINISM: identical inputs (descriptor, handler behavior, request,
 * grant state) yield identical observations — the observation id is the
 * content hash of the canonical observation content; no ambient entropy, no
 * hidden clocks (windows and evaluation points are caller-supplied).
 */

import { createTraceLink, TraceLinkStore, canonicalSerialize } from '@sos-2/semantic-spine';
import type { JsonValue, TraceLink } from '@sos-2/semantic-spine';
import { evaluateGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact, GrantEvaluationInput } from '@sos-2/authority';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { assertValidRuntimeDescriptor } from './descriptor.js';
import type { RuntimeDescriptor } from './descriptor.js';
import { RuntimeRequestError, RuntimeError } from './errors.js';
import { assertValidRuntimeObservation, runtimeObservationId } from './observation.js';
import type { RuntimeObservation } from './observation.js';

/** Structured denial codes (authority plane). */
export const EXECUTION_DENIAL_CODES = [
  'GRANT_MISSING',
  'GRANT_UNKNOWN',
  'GRANT_EXPIRED',
  'GRANT_REVOKED',
] as const;

export type ExecutionDenialCode = (typeof EXECUTION_DENIAL_CODES)[number];

/** A structured execution denial — WHY the operation did not run. */
export interface ExecutionDenial {
  /** One of the frozen denial codes. */
  code: ExecutionDenialCode;
  /** The grant reference that was refused, or null when none was carried. */
  grant_ref: string | null;
  /** Deterministic human-readable reason. */
  reason: string;
}

/** An authority-checked execution request. */
export interface ExecutionRequest {
  /** The declared runtime to execute against (descriptor id). */
  runtime_id: string;
  /** The DECLARED operation to execute (must be a capability of the runtime). */
  operation: string;
  /** The operation input (JSON), or null. */
  input: JsonValue | null;
  /** REQUIRED: the AuthorityGrant spine id authorizing this execution. */
  grant_ref: string;
  /** REQUIRED: the grant evaluation point ({ kind: 'TIME', now } or a revision checkpoint). */
  at: GrantEvaluationInput;
  /** REQUIRED: the execution time window (caller-supplied; no hidden clocks). */
  window: TimeWindow;
  /** WHO/WHAT is executing (the host's producer on the observation). */
  producer: Producer;
  /** Spine artifact id of the executed subject (candidate), or null. */
  subject_ref?: string | null;
  /** Spine SystemState artifact id of the revision observed, or null. */
  observed_system_state?: string | null;
  /** OBSERVES (default) or VERIFIES (assurance-verification executions). */
  link_type?: 'OBSERVES' | 'VERIFIES';
}

/** The result of an execution attempt. */
export type ExecutionResult =
  | { status: 'EXECUTED'; observation: RuntimeObservation }
  | { status: 'EXECUTION_DENIED'; denial: ExecutionDenial };

/** A declared operation handler: input -> output (may throw). */
export type OperationHandler = (input: JsonValue | null) => JsonValue | null;

/** Resolves grant spine ids to grant artifacts (operator-supplied pool). */
export type GrantResolver = (grant_ref: string) => AuthorityGrantArtifact | undefined;

/** The runtime host contract. */
export interface RuntimeHost {
  /** Register a declared runtime with its operation handlers (idempotent per runtime id: loud overwrite). */
  registerRuntime(descriptor: RuntimeDescriptor, handlers: Record<string, OperationHandler>): void;

  /** Registered runtime descriptors, sorted by id (deterministic). */
  listRuntimes(): RuntimeDescriptor[];

  /** Execute one authority-checked request (declared operations against declared runtimes only). */
  execute(request: ExecutionRequest): ExecutionResult;

  /** Emitted observations, emission order (deterministic). */
  observations(): RuntimeObservation[];

  /** Emitted trace links, emission order (deterministic). */
  traceLinks(): TraceLink[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonOrNull(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  try {
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * In-memory reference RuntimeHost. The authority gate is consumed from
 * @sos-2/authority (evaluateGrant — never re-implemented); the MAX_OUTPUT_
 * BYTES constraint is enforced deterministically over the canonical output
 * size (the in-memory substrate cannot honor wall-clock/duration or
 * memory bounds — those are declarations concrete runtimes enforce; the
 * in-memory host records them).
 */
export class InMemoryRuntimeHost implements RuntimeHost {
  private readonly runtimes = new Map<string, RuntimeDescriptor>();
  private readonly handlers = new Map<string, OperationHandler>();
  private readonly emittedObservations: RuntimeObservation[] = [];
  private readonly links = new TraceLinkStore();
  private readonly resolveGrant: GrantResolver;

  constructor(grantResolver: GrantResolver) {
    if (typeof grantResolver !== 'function') {
      throw new RuntimeError('RuntimeHost requires a grant resolver function (the authority pool)');
    }
    this.resolveGrant = grantResolver;
  }

  registerRuntime(descriptor: RuntimeDescriptor, handlers: Record<string, OperationHandler>): void {
    assertValidRuntimeDescriptor(descriptor);
    if (this.runtimes.has(descriptor.id)) {
      throw new RuntimeError(`runtime already registered: ${descriptor.id}`);
    }
    for (const capability of descriptor.capabilities) {
      const handler = handlers[capability];
      if (typeof handler !== 'function') {
        throw new RuntimeError(
          `runtime ${descriptor.id} declares operation ${JSON.stringify(capability)} but no handler was supplied ` +
            '(the host executes DECLARED operations — every capability needs a handler)',
        );
      }
      this.handlers.set(this.operationKey(descriptor.id, capability), handler);
    }
    this.runtimes.set(descriptor.id, structuredClone(descriptor));
  }

  listRuntimes(): RuntimeDescriptor[] {
    return [...this.runtimes.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((descriptor) => structuredClone(descriptor));
  }

  execute(request: ExecutionRequest): ExecutionResult {
    this.assertWellFormedRequest(request);

    // 1. AUTHORITY GATE — before anything runs (consumed from @sos-2/authority).
    const denial = this.checkAuthority(request);
    if (denial !== null) {
      return { status: 'EXECUTION_DENIED', denial };
    }

    // 2. Declared runtimes only (loud: a contract violation, not a denial).
    const descriptor = this.runtimes.get(request.runtime_id);
    if (descriptor === undefined) {
      throw new RuntimeError(
        `unknown runtime: ${JSON.stringify(request.runtime_id)} (declared: ${[...this.runtimes.keys()].sort().join(', ') || 'none'})`,
      );
    }

    // 3. Declared operations only (loud).
    if (!descriptor.capabilities.includes(request.operation)) {
      throw new RuntimeError(
        `undeclared operation: ${JSON.stringify(request.operation)} on runtime ${descriptor.id} ` +
          `(declared: ${descriptor.capabilities.join(', ')})`,
      );
    }
    const handler = this.handlers.get(this.operationKey(descriptor.id, request.operation))!;
    if (handler === undefined) {
      throw new RuntimeError(`no handler registered for declared operation ${request.operation} on ${descriptor.id}`);
    }

    // 4. Run, truthfully.
    let output: JsonValue | null;
    let error: string | null = null;
    let availability: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
    try {
      output = handler(request.input === null ? null : structuredClone(request.input));
    } catch (cause) {
      output = null;
      error = `operation threw: ${(cause as Error).message}`;
      availability = 'FAILURE';
    }
    if (output !== null) {
      if (!isJsonOrNull(output)) {
        output = null;
        error = 'operation returned a non-JSON payload';
        availability = 'FAILURE';
      } else {
        const maxOutputBytes = descriptor.constraints.find(
          (constraint) => constraint.kind === 'MAX_OUTPUT_BYTES',
        );
        if (maxOutputBytes !== undefined && maxOutputBytes.kind === 'MAX_OUTPUT_BYTES') {
          const size = canonicalSerialize(output).length;
          if (size > maxOutputBytes.max_bytes) {
            output = null;
            error = `output exceeds MAX_OUTPUT_BYTES (${size} > ${maxOutputBytes.max_bytes} canonical bytes)`;
            availability = 'FAILURE';
          }
        }
      }
    }

    // 5. Emit the observation + trace links.
    const traceLinks: TraceLink[] = [];
    if (request.subject_ref !== null && request.subject_ref !== undefined && request.observed_system_state != null) {
      const link = createTraceLink({
        source: request.subject_ref,
        target: request.observed_system_state,
        type: request.link_type ?? 'OBSERVES',
        provenance: [
          `runtime:${descriptor.id}`,
          `operation:${request.operation}`,
          `grant:${request.grant_ref}`,
        ],
      });
      // The (subject, state, type) RELATIONSHIP is stored once (the spine
      // rejects duplicate triples); every observation still carries the
      // minted link, so per-execution traceability is preserved on the
      // observation record itself.
      if (!this.links.has(link.source, link.target, link.type)) {
        this.links.add(link);
      }
      traceLinks.push(link);
    }

    const content: Omit<RuntimeObservation, 'id'> = {
      runtime_id: descriptor.id,
      runtime_kind: descriptor.kind,
      runtime_version: descriptor.version,
      operation: request.operation,
      availability,
      output,
      error,
      window: { ...request.window },
      producer: { ...request.producer },
      subject_ref: request.subject_ref ?? null,
      observed_system_state: request.observed_system_state ?? null,
      grant_ref: request.grant_ref,
      trace_links: traceLinks,
    };
    const observation: RuntimeObservation = { id: runtimeObservationId(content), ...content };
    assertValidRuntimeObservation(observation);
    this.emittedObservations.push(observation);
    return { status: 'EXECUTED', observation };
  }

  observations(): RuntimeObservation[] {
    return this.emittedObservations.map((observation) => structuredClone(observation));
  }

  traceLinks(): TraceLink[] {
    return this.links.all();
  }

  private operationKey(runtimeId: string, operation: string): string {
    return `${runtimeId}\u0000${operation}`;
  }

  private assertWellFormedRequest(request: ExecutionRequest): void {
    if (!isPlainObject(request)) {
      throw new RuntimeRequestError('execution request must be an object');
    }
    if (typeof request.runtime_id !== 'string' || request.runtime_id.length === 0) {
      throw new RuntimeRequestError('execution request runtime_id must be a non-empty string');
    }
    if (typeof request.operation !== 'string' || request.operation.length === 0) {
      throw new RuntimeRequestError('execution request operation must be a non-empty string');
    }
    if (!isJsonOrNull(request.input)) {
      throw new RuntimeRequestError('execution request input must be null or a JSON value');
    }
    if (typeof request.window !== 'object' || request.window === null) {
      throw new RuntimeRequestError('execution request window is required (caller-supplied; no hidden clocks)');
    }
    if (typeof request.producer !== 'object' || request.producer === null) {
      throw new RuntimeRequestError('execution request producer is required');
    }
    if (request.subject_ref != null && typeof request.subject_ref !== 'string') {
      throw new RuntimeRequestError('execution request subject_ref must be a string or null');
    }
    if (request.observed_system_state != null && typeof request.observed_system_state !== 'string') {
      throw new RuntimeRequestError('execution request observed_system_state must be a string or null');
    }
    if (request.link_type !== undefined && request.link_type !== 'OBSERVES' && request.link_type !== 'VERIFIES') {
      throw new RuntimeRequestError('execution request link_type must be OBSERVES or VERIFIES');
    }
  }

  /**
   * The authority gate. Returns a structured denial, or null when the grant
   * is VALID (or the request carries no grant at all — GRANT_MISSING, a
   * runtime guard against cast-forged requests).
   */
  private checkAuthority(request: ExecutionRequest): ExecutionDenial | null {
    const grantRef = request.grant_ref;
    if (typeof grantRef !== 'string' || grantRef.length === 0) {
      return {
        code: 'GRANT_MISSING',
        grant_ref: null,
        reason: 'execution denied: the request carries no grant reference — execution is authority checked',
      };
    }
    const grant = this.resolveGrant(grantRef);
    if (grant === undefined) {
      return {
        code: 'GRANT_UNKNOWN',
        grant_ref: grantRef,
        reason: `execution denied: grant ${grantRef} is not present in the authority pool`,
      };
    }
    let status: ReturnType<typeof evaluateGrant>;
    try {
      status = evaluateGrant(grant, request.at);
    } catch (cause) {
      throw new RuntimeRequestError(
        `grant evaluation failed (malformed grant or indeterminate evaluation point): ${(cause as Error).message}`,
      );
    }
    if (status === 'VALID') {
      return null;
    }
    return {
      code: status === 'EXPIRED' ? 'GRANT_EXPIRED' : 'GRANT_REVOKED',
      grant_ref: grantRef,
      reason:
        status === 'EXPIRED'
          ? `execution denied: grant ${grantRef} is EXPIRED at the evaluation point (expired and revoked grants never authorize)`
          : `execution denied: grant ${grantRef} is REVOKED (expired and revoked grants never authorize)`,
    };
  }
}
