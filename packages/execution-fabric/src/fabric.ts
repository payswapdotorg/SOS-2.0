/**
 * THE EXECUTION FABRIC (Work Order P5) — the provider-neutral orchestration
 * surface composing harness + broker + the durable P2 stores + authority.
 *
 * BOUNDED TASK EXECUTION THROUGH THE CONTRACT — every dispatch runs the
 * same uniform gate pipeline, in order:
 *
 *   1. TASK        the durable TaskRecord must exist and be RUNNING
 *   2. LEASE       the fail-closed broker gate (expired/revoked/released
 *                  leases authorize NOTHING)
 *   3. AUTHORITY   the CURRENT grant heads resolve over the durable
 *                  AuthorityGrantRepository and re-evaluate through
 *                  evaluateGrant at the injected instant (W12 pattern)
 *   4. ADVERTISMENT the binding §3 capability advertisement must carry
 *                  the operation (explicit, never silent)
 *   5. DISPATCH    the §9 harness contract surface executes
 *
 * Every attempt — executed, denied or unsupported — lands in the typed
 * OBSERVATION BOUNDARY (durable, replay-protected) and the task record is
 * updated with a CAS write: refusing-to-run and running-and-failing stay
 * distinct, truthful facts.
 *
 * A BODY CANNOT MINT OR WIDEN AUTHORITY: the operation surface validates
 * exact request shapes (smuggled authority keys are typed-rejected),
 * grants resolve ONLY from the durable store, the task's authority
 * context is fixed at creation, and body outputs are recorded as
 * NON-AUTHORITATIVE observations — a body completion report never
 * certifies a task (§10); completeTask requires the Spirit-side
 * verification record.
 *
 * TASK IDENTITY IS DURABLE: the task is its TaskRecord; bodies, leases
 * and providers come and go. replaceBodyForTask ends the current lease,
 * acquires a new one on a capability-selected replacement body and points
 * the SAME task record at it — kill mid-task -> new body -> resume keeps
 * the task id and every checkpoint, artifact and observation.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — the clock, stores and broker are injected; observation
 * ids are deterministic sequences.
 */

import { fabricDenial } from './denials.js';
import type { FabricDenial } from './denials.js';
import { evaluateTaskAuthority } from './authority-gate.js';
import type { AuthorityGateOutcome } from './authority-gate.js';
import { assertValidFabricOperation, harnessOperationOf } from './operations.js';
import type { FabricOperation } from './operations.js';
import { InvalidFabricInputError } from './errors.js';
import type { BodyBroker, BodySelectionRequirements, LeaseDenial } from '@sos-2/body-broker';
import { assertValidBodySelectionRequirements } from '@sos-2/body-broker';
import type { HarnessContract, HarnessOperationName, HarnessResult } from '@sos-2/harness';
import { isOperationAdvertised } from '@sos-2/harness';
import type {
  AuthorityGrantRepository,
  BodyLeaseRecord,
  Clock,
  IngestEventOutcome,
  ObjectStoreAdapter,
  ObservationEventInput,
  ObservationEventRepository,
  PutResult,
  TaskArtifactRecord,
  TaskCheckpoint,
  TaskRecord,
  TaskStateRepository,
  TaskVerificationRecord,
} from '@sos-2/live-store';
import { RFC3339_PATTERN, formatRfc3339 } from '@sos-2/live-store';
import { isArtifactId } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';

/** Fabric dependencies — every store, the broker and the clock are INJECTED. */
export interface ExecutionFabricDeps {
  /** Durable task state (the §6 shape — P2 port). */
  readonly tasks: TaskStateRepository;
  /** Durable authority grants (the CURRENT grant resolves here). */
  readonly authorityGrants: AuthorityGrantRepository;
  /** The typed observation boundary (durable, replay-protected — P2 port). */
  readonly observationEvents: ObservationEventRepository;
  /** The content-addressed object store for captured artifacts (P2 port). */
  readonly objects: ObjectStoreAdapter;
  /** The body broker (selection + fail-closed leases). */
  readonly broker: BodyBroker;
  /** The injected clock. */
  readonly clock: Clock;
}

/** Input for creating a bounded task. */
export interface CreateBoundedTaskInput {
  /** Task identity — an EXECUTION-FABRIC id (never a semantic identity). */
  readonly task_id: string;
  /** Mission artifact id (sos://Mission/...), or null while unlinked. */
  readonly mission_ref: string | null;
  /** The bounded task plan/work graph (canonical JSON). */
  readonly plan: JsonValue;
  /** The authority grant references the task acts under (non-empty; resolved from the durable store). */
  readonly grant_refs: readonly string[];
  /** Requirements for the executing body (capability-based selection). */
  readonly requirements: BodySelectionRequirements;
  /** The acquiring principal (recorded on the lease). */
  readonly holder: string;
  /** Lease expiry instant (RFC3339), or null for a non-expiring lease. */
  readonly expires_at: string | null;
  /** Unresolved uncertainty statements, retained from the start. */
  readonly unresolved_uncertainty?: readonly string[];
}

/** The typed outcome of a bounded task creation. */
export type BoundedTaskCreation =
  | {
      readonly status: 'CREATED';
      readonly task: TaskRecord;
      readonly lease: BodyLeaseRecord;
      readonly body_id: string;
      readonly observation_id: string;
    }
  | { readonly status: 'DENIED'; readonly denial: FabricDenial }
  | {
      /** The body-side createTask RAN and failed — truthful; the lease was released, no task record was created. */
      readonly status: 'FAILED';
      readonly error: string;
      readonly body_id: string;
    };

/** The typed outcome of one dispatched operation. */
export type FabricOperationResult =
  | {
      /** The operation ran (SUCCESS or FAILURE — truthful availability). */
      readonly status: 'EXECUTED';
      readonly availability: 'SUCCESS' | 'FAILURE';
      readonly output: JsonValue | null;
      readonly error: string | null;
      readonly observation_id: string;
      readonly task_revision: number;
    }
  | {
      /** The operation NEVER RAN — a typed denial (lease/authority/shape). */
      readonly status: 'DENIED';
      readonly denial: FabricDenial;
      readonly observation_id: string | null;
    }
  | {
      /** The operation is explicitly unsupported by the binding advertisement. */
      readonly status: 'UNSUPPORTED';
      readonly operation: HarnessOperationName;
      readonly reason: string;
      readonly observation_id: string;
      readonly task_revision: number;
    }
  | {
      /** The durable task write lost the CAS race — retry with the fresh record. */
      readonly status: 'CONFLICT';
      readonly current_revision: number;
      readonly current_record: TaskRecord;
      readonly reason: string;
    };

/** The typed outcome of a task lifecycle transition. */
export type FabricTaskTransition =
  | { readonly status: 'TRANSITIONED'; readonly task: TaskRecord; readonly observation_id: string }
  | { readonly status: 'DENIED'; readonly denial: FabricDenial; readonly observation_id: string | null }
  | {
      /** The body-side lifecycle operation RAN and failed — the durable task keeps its prior status (truthful). */
      readonly status: 'FAILED';
      readonly error: string;
      readonly observation_id: string | null;
    };

/** The typed outcome of a body replacement. */
export type FabricBodyReplacement =
  | {
      readonly status: 'REPLACED';
      readonly task: TaskRecord;
      readonly ended_lease: BodyLeaseRecord;
      readonly new_lease: BodyLeaseRecord;
      readonly body_id: string;
      readonly observation_id: string;
    }
  | { readonly status: 'DENIED'; readonly denial: FabricDenial; observation_id: string | null };

/** The non-authoritative body completion report shape. */
export interface BodyCompletionReport {
  /** The body's own summary of what it believes it achieved. */
  readonly summary: string;
  /** Optional supporting payload (opaque JSON; NEVER authoritative evidence). */
  readonly evidence: JsonValue | null;
}

const FABRIC_EVENT_SOURCE = 'execution-fabric';
const CREATION_EVENT_KIND = 'task.created';
const BODY_COMPLETION_EVENT_KIND = 'task.body-completion-report';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_PATTERN.test(value);
}

/** Deterministic observation event id for a task sequence number. */
function observationEventId(taskId: string, sequence: number): string {
  return `fabric-obs:${taskId}:${String(sequence).padStart(6, '0')}`;
}

/** Validate a Spirit-side verification record before completion (typed, loud). */
function assertValidVerification(value: unknown): asserts value is TaskVerificationRecord {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 4 ||
    typeof value['verified'] !== 'boolean' ||
    !isRfc3339(value['recorded_at']) ||
    !Array.isArray(value['evidence_refs']) ||
    !value['evidence_refs'].every((entry) => typeof entry === 'string') ||
    (value['summary'] !== null && !isNonEmptyString(value['summary']))
  ) {
    throw new InvalidFabricInputError(
      'task verification record must be { verified: boolean, recorded_at: RFC3339, evidence_refs: string[], summary: string | null } — completion requires evidence (§10)',
    );
  }
}

/**
 * THE EXECUTION FABRIC.
 */
export class ExecutionFabric {
  private readonly tasks: TaskStateRepository;
  private readonly authorityGrants: AuthorityGrantRepository;
  private readonly observationEvents: ObservationEventRepository;
  private readonly objects: ObjectStoreAdapter;
  private readonly broker: BodyBroker;
  private readonly clock: Clock;

  constructor(deps: ExecutionFabricDeps) {
    if (
      typeof deps !== 'object' ||
      deps === null ||
      typeof deps.tasks !== 'object' ||
      typeof deps.authorityGrants !== 'object' ||
      typeof deps.observationEvents !== 'object' ||
      typeof deps.objects !== 'object' ||
      typeof deps.broker !== 'object' ||
      typeof deps.clock !== 'object' ||
      deps.clock === null ||
      typeof deps.clock.nowEpochMs !== 'function'
    ) {
      throw new InvalidFabricInputError('ExecutionFabric requires injected tasks/authorityGrants/observationEvents/objects stores, a BodyBroker and a clock');
    }
    this.tasks = deps.tasks;
    this.authorityGrants = deps.authorityGrants;
    this.observationEvents = deps.observationEvents;
    this.objects = deps.objects;
    this.broker = deps.broker;
    this.clock = deps.clock;
  }

  // -------------------------------------------------------------------------
  // Bounded task creation (authority-gated BEFORE any body is summoned)
  // -------------------------------------------------------------------------

  /** Create a bounded task: authority gate -> body selection -> lease -> contract createTask -> durable record. */
  async createBoundedTask(input: CreateBoundedTaskInput): Promise<BoundedTaskCreation> {
    // Typed input validation (fail closed — a semantic-shaped task id or a
    // body id where a mission ref belongs is rejected loudly).
    try {
      assertValidRuntimeIdentifier(input.task_id, 'bounded task task_id');
    } catch (cause) {
      return { status: 'DENIED', denial: fabricDenial('INVALID_TASK_INPUT', (cause as Error).message, { task_id: null }) };
    }
    if (input.mission_ref !== null && !isArtifactId(input.mission_ref)) {
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'INVALID_TASK_INPUT',
          `mission_ref must be a well-formed spine artifact id or null — a body/provider identity is NEVER a semantic identity, received: ${JSON.stringify(input.mission_ref)}`,
          { task_id: input.task_id },
        ),
      };
    }
    try {
      canonicalSerialize(input.plan);
    } catch {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', 'plan must be a canonical-JSON value', { task_id: input.task_id }),
      };
    }
    if (!Array.isArray(input.grant_refs) || input.grant_refs.length === 0 || !input.grant_refs.every(isArtifactId)) {
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'INVALID_TASK_INPUT',
          'grant_refs must be a non-empty array of well-formed spine grant artifact ids — a bounded task runs under explicit authority (fail closed)',
          { task_id: input.task_id },
        ),
      };
    }
    try {
      assertValidBodySelectionRequirements(input.requirements);
    } catch (cause) {
      return { status: 'DENIED', denial: fabricDenial('INVALID_TASK_INPUT', (cause as Error).message, { task_id: input.task_id }) };
    }
    if (!isNonEmptyString(input.holder)) {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', 'holder must be a non-empty string', { task_id: input.task_id }),
      };
    }
    if (input.expires_at !== null && !isRfc3339(input.expires_at)) {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', 'expires_at must be null or an RFC3339 timestamp', { task_id: input.task_id }),
      };
    }
    // Task ids are single-use: an existing durable record under the id
    // refuses creation BEFORE any body is summoned or event ingested.
    const existing = await this.tasks.get(input.task_id);
    if (existing !== undefined) {
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'INVALID_TASK_INPUT',
          `task ${JSON.stringify(input.task_id)} already exists in the durable store — task ids are single-use`,
          { task_id: input.task_id },
        ),
      };
    }

    // AUTHORITY GATE — a bounded task cannot START under dead authority.
    const authority = await evaluateTaskAuthority(this.authorityGrants, input.grant_refs, this.clock.nowEpochMs(), input.task_id);
    if (authority.status === 'DENIED') {
      return { status: 'DENIED', denial: authority.denial };
    }

    // BODY SELECTION — capability-based, vendor-blind.
    const selection = this.broker.select(input.requirements);
    if (selection.status === 'NO_BODY_AVAILABLE') {
      return { status: 'DENIED', denial: fabricDenial('NO_BODY_AVAILABLE', selection.reason, { task_id: input.task_id }) };
    }
    const body = selection.body;

    // LEASE — the task owns a single-use lease on the body.
    const acquisition = await this.broker.acquireLease({
      task_ref: input.task_id,
      body_id: body.body_id,
      holder: input.holder,
      expires_at: input.expires_at,
    });
    if (acquisition.status === 'DENIED') {
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'LEASE_DENIED',
          `lease acquisition for body ${JSON.stringify(body.body_id)} was denied: ${acquisition.denial.reason}`,
          { task_id: input.task_id },
        ),
      };
    }
    if (acquisition.status === 'CONFLICT') {
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'LEASE_DENIED',
          `lease acquisition for body ${JSON.stringify(body.body_id)} conflicted: ${acquisition.reason}`,
          { task_id: input.task_id },
        ),
      };
    }
    const lease = acquisition.lease;
    const harness = this.broker.harnessFor(body.body_id);

    // CONTRACT createTask — through the §9 surface.
    const created = harness.createTask({ task_ref: input.task_id, input: input.plan });
    if (created.status === 'UNSUPPORTED') {
      await this.broker.releaseLease(lease.lease_id, 'createTask unsupported by body advertisement');
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'OPERATION_UNSUPPORTED',
          `body ${JSON.stringify(body.body_id)} advertisement does not carry createTask: ${created.reason}`,
          { task_id: input.task_id, operation: 'createTask' },
        ),
      };
    }
    if (created.status === 'FAILED') {
      // Truthful failure: the body ran and failed; release the lease; no
      // durable task exists. The orchestrator may retry (new lease).
      await this.broker.releaseLease(lease.lease_id, `createTask failed: ${created.error}`);
      return { status: 'FAILED', error: created.error, body_id: body.body_id };
    }

    // DURABLE RECORD — the §6 shape, with the creation observation id
    // pre-computed (deterministic sequence) so one CAS write lands both.
    const now = formatRfc3339(this.clock.nowEpochMs());
    const eventId = observationEventId(input.task_id, 1);
    const event: ObservationEventInput = {
      id: eventId,
      source: FABRIC_EVENT_SOURCE,
      kind: CREATION_EVENT_KIND,
      occurred_at: now,
      payload: {
        task_id: input.task_id,
        mission_ref: input.mission_ref,
        body_id: body.body_id,
        lease_id: lease.lease_id,
        grant_refs: [...input.grant_refs],
      },
      provenance: [FABRIC_EVENT_SOURCE, `body:${body.body_id}`, `lease:${lease.lease_id}`, ...input.grant_refs],
    };
    const ingested = await this.ingestObservation(event);

    const task: TaskRecord = {
      task_id: input.task_id,
      mission_ref: input.mission_ref,
      status: 'RUNNING',
      plan: structuredClone(input.plan),
      owned_revision: { source_revision: null, deployment_revision: null },
      authority_context: { grant_refs: [...input.grant_refs], notes: 'bounded task authority (P5 execution fabric)' },
      body_lease_ref: lease.lease_id,
      checkpoints: [],
      artifacts: [],
      observations: [ingested.event.id],
      unresolved_uncertainty: [...(input.unresolved_uncertainty ?? [])],
      retries: 0,
      recovery_state: null,
      resource_usage: null,
      final_verification: null,
      revision: 1,
      created_at: now,
      updated_at: now,
    };
    const put = await this.tasks.put(task);
    if (put.kind === 'CONFLICT') {
      // Lost a creation race under this task id — release the lease; the
      // stored task stands.
      await this.endLeaseIfLive(lease.lease_id, 'task creation lost the durable write race');
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', `task ${JSON.stringify(input.task_id)} could not be stored: ${put.reason}`, {
          task_id: input.task_id,
        }),
      };
    }

    return { status: 'CREATED', task: put.record, lease, body_id: body.body_id, observation_id: ingested.event.id };
  }

  // -------------------------------------------------------------------------
  // The uniform operation gate pipeline
  // -------------------------------------------------------------------------

  /** Execute one §9 operation on a task's body through the uniform gates. */
  async execute(taskId: string, operation: FabricOperation): Promise<FabricOperationResult> {
    const task = await this.tasks.get(taskId);
    if (task === undefined) {
      return {
        status: 'DENIED',
        denial: fabricDenial('TASK_NOT_FOUND', `task ${JSON.stringify(taskId)} is not in the durable task store`, { task_id: taskId }),
        observation_id: null,
      };
    }
    try {
      assertValidFabricOperation(operation);
    } catch (cause) {
      const denial = fabricDenial('OPERATION_INVALID', (cause as Error).message, { task_id: taskId, operation: String(operation?.['kind'] ?? null) });
      const observed = await this.observeDenial(task, operation, denial);
      return { status: 'DENIED', denial, observation_id: observed.eventId };
    }
    const opKind = operation.kind;

    if (task.status !== 'RUNNING') {
      const denial = fabricDenial(
        'TASK_NOT_ACTIVE',
        `task ${JSON.stringify(taskId)} is ${task.status} — only RUNNING tasks execute operations`,
        { task_id: taskId, operation: opKind },
      );
      const observed = await this.observeDenial(task, operation, denial);
      return { status: 'DENIED', denial, observation_id: observed.eventId };
    }
    if (task.body_lease_ref === null) {
      const denial = fabricDenial('LEASE_NOT_HELD', `task ${JSON.stringify(taskId)} holds no body lease`, {
        task_id: taskId,
        operation: opKind,
      });
      const observed = await this.observeDenial(task, operation, denial);
      return { status: 'DENIED', denial, observation_id: observed.eventId };
    }

    // LEASE GATE (fail closed).
    const leaseAuth = await this.broker.authorizeOperation({
      lease_id: task.body_lease_ref,
      task_ref: taskId,
      body_id: null,
    });
    if (!leaseAuth.authorized) {
      const denial = fabricDenial(
        'LEASE_DENIED',
        `lease gate refused: ${leaseAuth.denial.reason}`,
        { task_id: taskId, operation: opKind },
      );
      const observed = await this.observeDenial(task, operation, denial);
      return { status: 'DENIED', denial, observation_id: observed.eventId };
    }
    const lease = leaseAuth.lease;
    if (lease.body_id === null) {
      const denial = fabricDenial('LEASE_NOT_HELD', `lease ${JSON.stringify(lease.lease_id)} binds no body`, {
        task_id: taskId,
        operation: opKind,
      });
      const observed = await this.observeDenial(task, operation, denial);
      return { status: 'DENIED', denial, observation_id: observed.eventId };
    }

    // AUTHORITY GATE — the CURRENT grants re-evaluate on every operation.
    const authority = await evaluateTaskAuthority(
      this.authorityGrants,
      task.authority_context.grant_refs,
      this.clock.nowEpochMs(),
      taskId,
    );
    if (authority.status === 'DENIED') {
      const observed = await this.observeDenial(task, operation, authority.denial);
      return { status: 'DENIED', denial: authority.denial, observation_id: observed.eventId };
    }

    // ADVERTISEMENT GATE — explicit capability, never silent.
    const registration = this.broker.body(lease.body_id);
    if (registration === undefined) {
      const denial = fabricDenial(
        'LEASE_DENIED',
        `lease ${JSON.stringify(lease.lease_id)} binds body ${JSON.stringify(lease.body_id)} which is no longer registered with the broker`,
        { task_id: taskId, operation: opKind },
      );
      const observed = await this.observeDenial(task, operation, denial);
      return { status: 'DENIED', denial, observation_id: observed.eventId };
    }
    const harnessOperation = harnessOperationOf(operation);
    if (!isOperationAdvertised(registration.capabilities, harnessOperation)) {
      const denial = fabricDenial(
        'OPERATION_UNSUPPORTED',
        `body ${JSON.stringify(lease.body_id)} advertisement does not carry operation ${JSON.stringify(harnessOperation)} — unsupported capabilities are explicit, never silent`,
        { task_id: taskId, operation: harnessOperation },
      );
      const observed = await this.observeDenial(task, operation, denial);
      return {
        status: 'UNSUPPORTED',
        operation: harnessOperation,
        reason: denial.reason,
        observation_id: observed.eventId,
        task_revision: observed.revision,
      };
    }

    // DISPATCH — through the §9 contract surface.
    const harness = this.broker.harnessFor(lease.body_id);
    let result: HarnessResult<unknown>;
    try {
      result = this.dispatch(harness, operation, taskId);
    } catch (cause) {
      // A contract violation (thrown) is an honest FAILURE of the attempt.
      const denial = fabricDenial('OPERATION_INVALID', `dispatching ${JSON.stringify(opKind)} threw: ${(cause as Error).message}`, {
        task_id: taskId,
        operation: opKind,
      });
      const observed = await this.observeDenial(task, operation, denial);
      return { status: 'DENIED', denial, observation_id: observed.eventId };
    }

    if (result.status === 'UNSUPPORTED') {
      const observed = await this.observeResult(task, operation, {
        status: 'UNSUPPORTED',
        availability: 'UNSUPPORTED',
        output: null,
        error: result.reason,
        body_id: lease.body_id,
        lease_id: lease.lease_id,
      });
      return {
        status: 'UNSUPPORTED',
        operation: harnessOperation,
        reason: result.reason,
        observation_id: observed.eventId,
        task_revision: observed.revision,
      };
    }

    const availability = result.status === 'OK' ? 'SUCCESS' : 'FAILURE';
    const output = result.status === 'OK' ? result.value : null;
    const error = result.status === 'OK' ? null : result.error;

    // JSON-safety of the output (a body returning a non-JSON payload is a
    // truthful FAILURE — never recorded as success).
    let outputJson: JsonValue | null = null;
    if (output !== null && output !== undefined) {
      try {
        canonicalSerialize(output);
        outputJson = output as JsonValue;
      } catch {
        const observed = await this.observeResult(task, operation, {
          status: 'EXECUTED',
          availability: 'FAILURE',
          output: null,
          error: 'operation returned a non-JSON payload',
          body_id: lease.body_id,
          lease_id: lease.lease_id,
        });
        return {
          status: 'EXECUTED',
          availability: 'FAILURE',
          output: null,
          error: 'operation returned a non-JSON payload',
          observation_id: observed.eventId,
          task_revision: observed.revision,
        };
      }
    }

    // artifacts.capture: persist the captured content object BEFORE
    // recording success — a malformed capture payload is a truthful FAILURE.
    let artifact: TaskArtifactRecord | null = null;
    if (opKind === 'artifacts.capture' && result.status === 'OK') {
      artifact = await this.persistArtifact(task, operation, result.value);
      if (artifact === null) {
        const observed = await this.observeResult(task, operation, {
          status: 'EXECUTED',
          availability: 'FAILURE',
          output: null,
          error: 'artifacts.capture returned a malformed payload (no artifact_id) — the artifact was not persisted',
          body_id: lease.body_id,
          lease_id: lease.lease_id,
        });
        return {
          status: 'EXECUTED',
          availability: 'FAILURE',
          output: null,
          error: 'artifacts.capture returned a malformed payload (no artifact_id) — the artifact was not persisted',
          observation_id: observed.eventId,
          task_revision: observed.revision,
        };
      }
    }

    // observations.emit: ingest the body observation through the boundary.
    const bodyObservation =
      opKind === 'observations.emit' && result.status === 'OK'
        ? await this.ingestBodyObservation(task, lease.body_id!, operation)
        : null;

    const observed = await this.observeResult(task, operation, {
      status: 'EXECUTED',
      availability,
      output: outputJson,
      error,
      body_id: lease.body_id,
      lease_id: lease.lease_id,
      artifact,
      bodyObservation,
    });

    if (availability === 'FAILURE') {
      return {
        status: 'EXECUTED',
        availability: 'FAILURE',
        output: null,
        error,
        observation_id: observed.eventId,
        task_revision: observed.revision,
      };
    }
    return {
      status: 'EXECUTED',
      availability: 'SUCCESS',
      output: outputJson,
      error: null,
      observation_id: observed.eventId,
      task_revision: observed.revision,
    };
  }

  private dispatch(harness: HarnessContract, operation: FabricOperation, taskId: string): HarnessResult<unknown> {
    switch (operation.kind) {
      case 'workspace.read':
        return harness.workspace.read({ task_ref: taskId, path: operation.path });
      case 'workspace.write':
        return harness.workspace.write({ task_ref: taskId, path: operation.path, content: operation.content });
      case 'shell.exec':
        return harness.shell.exec({ task_ref: taskId, command: operation.command, args: [...operation.args], cwd: operation.cwd });
      case 'browser.open':
        return harness.browser.open({ task_ref: taskId, url: operation.url });
      case 'browser.interact':
        return harness.browser.interact({
          task_ref: taskId,
          page_id: operation.page_id,
          action: operation.action,
          target: operation.target,
          value: operation.value,
        });
      case 'git.status':
        return harness.git.status({ task_ref: taskId });
      case 'git.diff':
        return harness.git.diff({ task_ref: taskId, ref: operation.ref });
      case 'git.commit':
        return harness.git.commit({ task_ref: taskId, message: operation.message, paths: [...operation.paths] });
      case 'git.push':
        return harness.git.push({ task_ref: taskId, remote: operation.remote, ref: operation.ref });
      case 'git.createBranch':
        return harness.git.createBranch({ task_ref: taskId, name: operation.name, from_ref: operation.from_ref });
      case 'git.createPullRequest':
        return harness.git.createPullRequest({
          task_ref: taskId,
          title: operation.title,
          source_branch: operation.source_branch,
          target_branch: operation.target_branch,
        });
      case 'artifacts.capture':
        return harness.artifacts.capture({ task_ref: taskId, name: operation.name, content: operation.content });
      case 'observations.emit':
        return harness.observations.emit({ task_ref: taskId, observation_kind: operation.observation_kind, payload: operation.payload });
      case 'events.subscribe':
        return harness.events.subscribe({ task_ref: taskId, filter: operation.filter, cursor: operation.cursor });
    }
  }

  // -------------------------------------------------------------------------
  // Task lifecycle (Spirit-side durable transitions; body-side best-effort)
  // -------------------------------------------------------------------------

  /** Pause a RUNNING task. With a live lease the body pauses through the contract (gated); without one the durable transition stands alone. */
  async pauseTask(taskId: string): Promise<FabricTaskTransition> {
    const task = await this.tasks.get(taskId);
    if (task === undefined) {
      return { status: 'DENIED', denial: fabricDenial('TASK_NOT_FOUND', `task ${JSON.stringify(taskId)} is not in the durable task store`, { task_id: taskId }), observation_id: null };
    }
    if (task.status !== 'RUNNING') {
      return {
        status: 'DENIED',
        denial: fabricDenial('TASK_NOT_ACTIVE', `task ${JSON.stringify(taskId)} is ${task.status} — only RUNNING tasks pause`, { task_id: taskId }),
        observation_id: null,
      };
    }
    let bodyPaused = false;
    let bodyNote: JsonValue = 'no live body — durable pause only';
    if (task.body_lease_ref !== null) {
      const leaseAuth = await this.broker.authorizeOperation({ lease_id: task.body_lease_ref, task_ref: taskId, body_id: null });
      if (leaseAuth.authorized && leaseAuth.lease.body_id !== null) {
        const authority = await evaluateTaskAuthority(this.authorityGrants, task.authority_context.grant_refs, this.clock.nowEpochMs(), taskId);
        if (authority.status === 'DENIED') {
          return { status: 'DENIED', denial: authority.denial, observation_id: null };
        }
        const harness = this.broker.harnessFor(leaseAuth.lease.body_id);
        const paused = harness.pauseTask({ task_ref: taskId });
        bodyPaused = paused.status === 'OK';
        bodyNote = paused.status === 'OK' ? 'body session paused through the contract' : `body pause reported: ${paused.status}`;
      }
    }
    const transition = await this.transitionTask(task, 'PAUSED', 'task.paused', {
      body_paused: bodyPaused,
      body_note: bodyNote,
    });
    return transition;
  }

  /** Resume a PAUSED task — REQUIRES a live lease and live authority (the body must reattach through the contract). */
  async resumeTask(taskId: string): Promise<FabricTaskTransition> {
    const task = await this.tasks.get(taskId);
    if (task === undefined) {
      return { status: 'DENIED', denial: fabricDenial('TASK_NOT_FOUND', `task ${JSON.stringify(taskId)} is not in the durable task store`, { task_id: taskId }), observation_id: null };
    }
    if (task.status !== 'PAUSED') {
      return {
        status: 'DENIED',
        denial: fabricDenial('TASK_NOT_ACTIVE', `task ${JSON.stringify(taskId)} is ${task.status} — only PAUSED tasks resume`, { task_id: taskId }),
        observation_id: null,
      };
    }
    if (task.body_lease_ref === null) {
      return {
        status: 'DENIED',
        denial: fabricDenial('LEASE_NOT_HELD', `task ${JSON.stringify(taskId)} holds no body lease — replace the body first`, { task_id: taskId }),
        observation_id: null,
      };
    }
    const leaseAuth = await this.broker.authorizeOperation({ lease_id: task.body_lease_ref, task_ref: taskId, body_id: null });
    if (!leaseAuth.authorized) {
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'LEASE_DENIED',
          `the task's lease no longer authorizes (${leaseAuth.denial.code}: ${leaseAuth.denial.reason}) — replace the body to continue (task identity is preserved)`,
          { task_id: taskId },
        ),
        observation_id: null,
      };
    }
    if (leaseAuth.lease.body_id === null) {
      return {
        status: 'DENIED',
        denial: fabricDenial('LEASE_NOT_HELD', `lease ${JSON.stringify(leaseAuth.lease.lease_id)} binds no body`, { task_id: taskId }),
        observation_id: null,
      };
    }
    const authority = await evaluateTaskAuthority(this.authorityGrants, task.authority_context.grant_refs, this.clock.nowEpochMs(), taskId);
    if (authority.status === 'DENIED') {
      return { status: 'DENIED', denial: authority.denial, observation_id: null };
    }
    const harness = this.broker.harnessFor(leaseAuth.lease.body_id);
    const resumed = harness.resumeTask({ task_ref: taskId, input: null });
    if (resumed.status === 'UNSUPPORTED') {
      return {
        status: 'DENIED',
        denial: fabricDenial('OPERATION_UNSUPPORTED', `body advertisement does not carry resumeTask: ${resumed.reason}`, {
          task_id: taskId,
          operation: 'resumeTask',
        }),
        observation_id: null,
      };
    }
    if (resumed.status === 'FAILED') {
      // The body ran and failed — the durable task stays PAUSED (truthful).
      return {
        status: 'FAILED',
        error: `body resumeTask ran and failed: ${resumed.error}`,
        observation_id: null,
      };
    }
    return this.transitionTask(task, 'RUNNING', 'task.resumed', { body_id: leaseAuth.lease.body_id, recovered: resumed.value.recovered });
  }

  /** Cancel a task (RUNNING or PAUSED): best-effort body cancel through the contract, durable CANCELLED, lease released. */
  async cancelTask(taskId: string): Promise<FabricTaskTransition> {
    const task = await this.tasks.get(taskId);
    if (task === undefined) {
      return { status: 'DENIED', denial: fabricDenial('TASK_NOT_FOUND', `task ${JSON.stringify(taskId)} is not in the durable task store`, { task_id: taskId }), observation_id: null };
    }
    if (task.status !== 'RUNNING' && task.status !== 'PAUSED') {
      return {
        status: 'DENIED',
        denial: fabricDenial('TASK_NOT_ACTIVE', `task ${JSON.stringify(taskId)} is ${task.status} — only RUNNING or PAUSED tasks cancel`, { task_id: taskId }),
        observation_id: null,
      };
    }
    let bodyNote: JsonValue = 'no live body — durable cancel only';
    if (task.body_lease_ref !== null) {
      const leaseAuth = await this.broker.authorizeOperation({ lease_id: task.body_lease_ref, task_ref: taskId, body_id: null });
      if (leaseAuth.authorized && leaseAuth.lease.body_id !== null) {
        const harness = this.broker.harnessFor(leaseAuth.lease.body_id);
        const cancelled = harness.cancelTask({ task_ref: taskId });
        bodyNote = cancelled.status === 'OK' ? 'body session cancelled through the contract' : `body cancel reported: ${cancelled.status}`;
      }
      await this.endLeaseIfLive(task.body_lease_ref, 'task cancelled');
    }
    return this.transitionTask(task, 'CANCELLED', 'task.cancelled', { body_note: bodyNote });
  }

  /**
   * Record a body completion REPORT (§10): the body's own claim enters the
   * observation boundary as NON-AUTHORITATIVE input. The task does NOT
   * complete — a worker/body may report completion but may not certify
   * mission success by itself; only completeTask (the Spirit-side
   * verification record) completes the task.
   */
  async reportBodyCompletion(taskId: string, report: BodyCompletionReport): Promise<FabricTaskTransition> {
    const task = await this.tasks.get(taskId);
    if (task === undefined) {
      return { status: 'DENIED', denial: fabricDenial('TASK_NOT_FOUND', `task ${JSON.stringify(taskId)} is not in the durable task store`, { task_id: taskId }), observation_id: null };
    }
    if (typeof report !== 'object' || report === null || Object.keys(report).length !== 2 || typeof report.summary !== 'string' || report.summary.length === 0) {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', 'a body completion report must be { summary: non-empty string, evidence: JSON | null }', {
          task_id: taskId,
        }),
        observation_id: null,
      };
    }
    if (report.evidence !== null) {
      try {
        canonicalSerialize(report.evidence);
      } catch {
        return {
          status: 'DENIED',
          denial: fabricDenial('INVALID_TASK_INPUT', 'report evidence must be canonical JSON or null', { task_id: taskId }),
          observation_id: null,
        };
      }
    }
    // Body attribution comes from the CURRENT lease when it still binds a
    // body; the report is non-authoritative either way.
    let bodyId = 'unknown';
    if (task.body_lease_ref !== null) {
      const lease = await this.broker.leaseRepository.get(task.body_lease_ref);
      if (lease !== undefined && lease.body_id !== null) {
        bodyId = lease.body_id;
      }
    }
    const sequence = task.observations.length + 1;
    const eventId = observationEventId(task.task_id, sequence);
    const now = formatRfc3339(this.clock.nowEpochMs());
    const ingested = await this.ingestObservation({
      id: eventId,
      source: `body:${bodyId}`,
      kind: BODY_COMPLETION_EVENT_KIND,
      occurred_at: now,
      payload: {
        task_id: task.task_id,
        summary: report.summary,
        evidence: report.evidence,
        non_authoritative: true,
        note: 'a body may report completion but may not certify mission success (§10) — this report never completes the task',
      },
      provenance: [`body:${bodyId}`, FABRIC_EVENT_SOURCE, `task:${task.task_id}`],
    });
    const updated: TaskRecord = {
      ...structuredClone(task),
      observations: [...task.observations, ingested.event.id],
      updated_at: now,
      revision: task.revision + 1,
    };
    const put = await this.tasks.put(updated, { expected_revision: task.revision });
    if (put.kind === 'CONFLICT') {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', `recording the completion report lost the CAS race (${put.reason}) — retry`, { task_id: taskId }),
        observation_id: ingested.event.id,
      };
    }
    return { status: 'TRANSITIONED', task: put.record, observation_id: ingested.event.id };
  }

  /**
   * Complete a task (Spirit-side, §10): requires the verification record
   * (evidence refs + verdict). The task's status flips to COMPLETED only
   * here — never through a body report. A live lease is released.
   */
  async completeTask(taskId: string, verification: TaskVerificationRecord): Promise<FabricTaskTransition> {
    const task = await this.tasks.get(taskId);
    if (task === undefined) {
      return { status: 'DENIED', denial: fabricDenial('TASK_NOT_FOUND', `task ${JSON.stringify(taskId)} is not in the durable task store`, { task_id: taskId }), observation_id: null };
    }
    if (task.status !== 'RUNNING' && task.status !== 'PAUSED') {
      return {
        status: 'DENIED',
        denial: fabricDenial('TASK_NOT_ACTIVE', `task ${JSON.stringify(taskId)} is ${task.status} — only RUNNING or PAUSED tasks complete`, { task_id: taskId }),
        observation_id: null,
      };
    }
    assertValidVerification(verification);
    if (task.body_lease_ref !== null) {
      await this.endLeaseIfLive(task.body_lease_ref, 'task completed');
    }
    const sequence = task.observations.length + 1;
    const eventId = observationEventId(task.task_id, sequence);
    const now = formatRfc3339(this.clock.nowEpochMs());
    const ingested = await this.ingestObservation({
      id: eventId,
      source: FABRIC_EVENT_SOURCE,
      kind: 'task.completed',
      occurred_at: now,
      payload: {
        task_id: task.task_id,
        verified: verification.verified,
        evidence_refs: [...verification.evidence_refs],
        summary: verification.summary,
        spirit_side: true,
      },
      provenance: [FABRIC_EVENT_SOURCE, `task:${task.task_id}`, ...verification.evidence_refs],
    });
    const updated: TaskRecord = {
      ...structuredClone(task),
      status: 'COMPLETED',
      final_verification: structuredClone(verification),
      observations: [...task.observations, ingested.event.id],
      updated_at: now,
      revision: task.revision + 1,
    };
    const put = await this.tasks.put(updated, { expected_revision: task.revision });
    if (put.kind === 'CONFLICT') {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', `completing the task lost the CAS race (${put.reason}) — retry`, { task_id: taskId }),
        observation_id: ingested.event.id,
      };
    }
    return { status: 'TRANSITIONED', task: put.record, observation_id: ingested.event.id };
  }

  /**
   * Replace the task's body (kill mid-task -> new body): the broker ends
   * the current lease and acquires a NEW one on a capability-selected
   * replacement body; the SAME durable task record points at it. Task
   * identity — task id, checkpoints, artifacts, observations — is
   * preserved (pinned by tests). A RUNNING task is parked to PAUSED in
   * the same durable write: a task without a live lease cannot execute,
   * and resume reattaches through the new body's contract.
   */
  async replaceBodyForTask(taskId: string, reason: string): Promise<FabricBodyReplacement> {
    const task = await this.tasks.get(taskId);
    if (task === undefined) {
      return { status: 'DENIED', denial: fabricDenial('TASK_NOT_FOUND', `task ${JSON.stringify(taskId)} is not in the durable task store`, { task_id: taskId }), observation_id: null };
    }
    if (task.body_lease_ref === null) {
      return {
        status: 'DENIED',
        denial: fabricDenial('LEASE_NOT_HELD', `task ${JSON.stringify(taskId)} holds no body lease to replace`, { task_id: taskId }),
        observation_id: null,
      };
    }
    const replacement = await this.broker.replaceBodyLease({
      task_ref: taskId,
      current_lease_id: task.body_lease_ref,
      reason,
    });
    if (replacement.status === 'DENIED') {
      const denial: FabricDenial =
        replacement.denial.code === 'NO_BODY_AVAILABLE'
          ? fabricDenial('NO_BODY_AVAILABLE', replacement.denial.reason, { task_id: taskId })
          : fabricDenial('LEASE_DENIED', `body replacement refused: ${replacement.denial.reason}`, { task_id: taskId });
      return { status: 'DENIED', denial, observation_id: null };
    }
    const sequence = task.observations.length + 1;
    const eventId = observationEventId(task.task_id, sequence);
    const now = formatRfc3339(this.clock.nowEpochMs());
    const ingested = await this.ingestObservation({
      id: eventId,
      source: FABRIC_EVENT_SOURCE,
      kind: 'task.body-replaced',
      occurred_at: now,
      payload: {
        task_id: task.task_id,
        ended_lease_id: replacement.ended_lease.lease_id,
        new_lease_id: replacement.new_lease.lease_id,
        new_body_id: replacement.body.body_id,
        reason,
        task_identity_preserved: true,
      },
      provenance: [FABRIC_EVENT_SOURCE, `body:${replacement.body.body_id}`, `lease:${replacement.new_lease.lease_id}`, `task:${task.task_id}`],
    });
    const updated: TaskRecord = {
      ...structuredClone(task),
      status: task.status === 'RUNNING' ? 'PAUSED' : task.status,
      body_lease_ref: replacement.new_lease.lease_id,
      observations: [...task.observations, ingested.event.id],
      updated_at: now,
      revision: task.revision + 1,
    };
    const put = await this.tasks.put(updated, { expected_revision: task.revision });
    if (put.kind === 'CONFLICT') {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', `body replacement lost the CAS race (${put.reason}) — retry`, { task_id: taskId }),
        observation_id: ingested.event.id,
      };
    }
    return {
      status: 'REPLACED',
      task: put.record,
      ended_lease: replacement.ended_lease,
      new_lease: replacement.new_lease,
      body_id: replacement.body.body_id,
      observation_id: ingested.event.id,
    };
  }

  /** Record a checkpoint on a RUNNING task (durable, CAS-guarded). */
  async recordCheckpoint(
    taskId: string,
    checkpoint: { label: string | null; work_graph_state: JsonValue; notes: string | null },
  ): Promise<FabricTaskTransition> {
    const task = await this.tasks.get(taskId);
    if (task === undefined) {
      return { status: 'DENIED', denial: fabricDenial('TASK_NOT_FOUND', `task ${JSON.stringify(taskId)} is not in the durable task store`, { task_id: taskId }), observation_id: null };
    }
    if (task.status !== 'RUNNING' && task.status !== 'PAUSED') {
      return {
        status: 'DENIED',
        denial: fabricDenial('TASK_NOT_ACTIVE', `task ${JSON.stringify(taskId)} is ${task.status} — checkpoints record on RUNNING or PAUSED tasks`, { task_id: taskId }),
        observation_id: null,
      };
    }
    try {
      canonicalSerialize(checkpoint.work_graph_state);
    } catch {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', 'checkpoint work_graph_state must be canonical JSON', { task_id: taskId }),
        observation_id: null,
      };
    }
    if (checkpoint.label !== null && !isNonEmptyString(checkpoint.label)) {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', 'checkpoint label must be null or a non-empty string', { task_id: taskId }),
        observation_id: null,
      };
    }
    if (checkpoint.notes !== null && !isNonEmptyString(checkpoint.notes)) {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', 'checkpoint notes must be null or a non-empty string', { task_id: taskId }),
        observation_id: null,
      };
    }
    const now = formatRfc3339(this.clock.nowEpochMs());
    const durableCheckpoint: TaskCheckpoint = {
      checkpoint_id: `cp-${String(task.checkpoints.length + 1).padStart(4, '0')}`,
      recorded_at: now,
      label: checkpoint.label,
      work_graph_state: structuredClone(checkpoint.work_graph_state),
      notes: checkpoint.notes,
    };
    const sequence = task.observations.length + 1;
    const eventId = observationEventId(task.task_id, sequence);
    const ingested = await this.ingestObservation({
      id: eventId,
      source: FABRIC_EVENT_SOURCE,
      kind: 'task.checkpoint',
      occurred_at: now,
      payload: { task_id: task.task_id, checkpoint_id: durableCheckpoint.checkpoint_id, label: durableCheckpoint.label },
      provenance: [FABRIC_EVENT_SOURCE, `task:${task.task_id}`],
    });
    const updated: TaskRecord = {
      ...structuredClone(task),
      checkpoints: [...task.checkpoints, durableCheckpoint],
      observations: [...task.observations, ingested.event.id],
      updated_at: now,
      revision: task.revision + 1,
    };
    const put = await this.tasks.put(updated, { expected_revision: task.revision });
    if (put.kind === 'CONFLICT') {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', `checkpoint recording lost the CAS race (${put.reason}) — retry`, { task_id: taskId }),
        observation_id: ingested.event.id,
      };
    }
    return { status: 'TRANSITIONED', task: put.record, observation_id: ingested.event.id };
  }

  // -------------------------------------------------------------------------
  // Internals: observation boundary, artifacts, durable transitions
  // -------------------------------------------------------------------------

  private async ingestObservation(event: ObservationEventInput): Promise<IngestEventOutcome> {
    // APPLIED on first delivery; DUPLICATE on identical replay — both carry
    // the stored event (a differing collision under a stored id throws
    // typed from the store, which is the honest answer).
    return this.observationEvents.ingest(event);
  }

  private async endLeaseIfLive(leaseId: string, reason: string): Promise<void> {
    const lease = await this.broker.leaseRepository.get(leaseId);
    if (lease === undefined || lease.state !== 'ACTIVE') {
      return;
    }
    await this.broker.releaseLease(leaseId, reason);
  }

  /** Persist a captured artifact's content into the object store and build the durable record. */
  private async persistArtifact(task: TaskRecord, operation: FabricOperation, value: unknown): Promise<TaskArtifactRecord | null> {
    if (operation.kind !== 'artifacts.capture' || typeof value !== 'object' || value === null) {
      return null;
    }
    const captured = value as { artifact_id?: unknown; size_bytes?: unknown; description?: unknown };
    if (typeof captured.artifact_id !== 'string' || captured.artifact_id.length === 0) {
      return null;
    }
    const bytes = new TextEncoder().encode(operation.content);
    const stored = await this.objects.putObject(bytes);
    return {
      artifact_id: `${task.task_id}:artifacts:${String(task.artifacts.length + 1).padStart(3, '0')}`,
      content_hash: stored.content_hash,
      object_ref: stored.object_ref,
      size_bytes: stored.size_bytes,
      description: typeof captured.description === 'string' ? captured.description : null,
    };
  }

  /** Ingest a body-emitted observation through the typed boundary (non-authoritative input). */
  private async ingestBodyObservation(
    task: TaskRecord,
    bodyId: string,
    operation: FabricOperation,
  ): Promise<string | null> {
    if (operation.kind !== 'observations.emit') {
      return null;
    }
    const sequence = task.observations.length + 1;
    const eventId = observationEventId(task.task_id, sequence);
    const now = formatRfc3339(this.clock.nowEpochMs());
    const ingested = await this.ingestObservation({
      id: eventId,
      source: `body:${bodyId}`,
      kind: operation.observation_kind,
      occurred_at: now,
      payload: operation.payload,
      provenance: [`body:${bodyId}`, FABRIC_EVENT_SOURCE, `task:${task.task_id}`],
    });
    return ingested.event.id;
  }

  /** Record a denial attempt in the observation boundary + durable task. */
  private async observeDenial(
    task: TaskRecord,
    operation: FabricOperation,
    denial: FabricDenial,
  ): Promise<{ eventId: string; revision: number }> {
    const sequence = task.observations.length + 1;
    const eventId = observationEventId(task.task_id, sequence);
    const now = formatRfc3339(this.clock.nowEpochMs());
    const ingested = await this.ingestObservation({
      id: eventId,
      source: FABRIC_EVENT_SOURCE,
      kind: `fabric.denied:${operation.kind}`,
      occurred_at: now,
      payload: { task_id: task.task_id, operation: operation.kind, denial: { code: denial.code, reason: denial.reason } },
      provenance: [FABRIC_EVENT_SOURCE, `task:${task.task_id}`],
    });
    const updated: TaskRecord = {
      ...structuredClone(task),
      observations: [...task.observations, ingested.event.id],
      updated_at: now,
      revision: task.revision + 1,
    };
    const put = await this.tasks.put(updated, { expected_revision: task.revision });
    if (put.kind === 'CONFLICT') {
      // The denial observation is durable; the task write lost the race —
      // the event id and the pre-race revision return; the denial stands.
      return { eventId: ingested.event.id, revision: task.revision };
    }
    return { eventId: ingested.event.id, revision: put.record.revision };
  }

  /** Record an operation outcome (executed/unsupported) in the observation boundary + durable task. */
  private async observeResult(
    task: TaskRecord,
    operation: FabricOperation,
    outcome: {
      status: string;
      availability: 'SUCCESS' | 'FAILURE' | 'UNSUPPORTED';
      output: JsonValue | null;
      error: string | null;
      body_id: string;
      lease_id: string;
      artifact?: TaskArtifactRecord | null;
      bodyObservation?: string | null;
    },
  ): Promise<{ eventId: string; revision: number }> {
    const now = formatRfc3339(this.clock.nowEpochMs());
    const eventIds: string[] = [];
    if (outcome.bodyObservation !== null && outcome.bodyObservation !== undefined) {
      eventIds.push(outcome.bodyObservation);
    }
    const sequence = task.observations.length + 1 + eventIds.length;
    const eventId = observationEventId(task.task_id, sequence);
    const ingested = await this.ingestObservation({
      id: eventId,
      source: FABRIC_EVENT_SOURCE,
      kind: `fabric.operation:${operation.kind}`,
      occurred_at: now,
      payload: {
        task_id: task.task_id,
        operation: { kind: operation.kind, ...stripKind(operation) },
        result: { status: outcome.status, availability: outcome.availability, output: outcome.output, error: outcome.error },
      },
      provenance: [FABRIC_EVENT_SOURCE, `body:${outcome.body_id}`, `lease:${outcome.lease_id}`, ...task.authority_context.grant_refs],
    });
    eventIds.push(ingested.event.id);

    const updated: TaskRecord = {
      ...structuredClone(task),
      observations: [...task.observations, ...eventIds],
      artifacts: outcome.artifact !== null && outcome.artifact !== undefined ? [...task.artifacts, outcome.artifact] : task.artifacts,
      updated_at: now,
      revision: task.revision + 1,
    };
    const put = await this.tasks.put(updated, { expected_revision: task.revision });
    if (put.kind === 'CONFLICT') {
      // The observations are durable; the caller retries the operation
      // against the fresh record (deterministic ids make replays no-ops).
      return { eventId: ingested.event.id, revision: task.revision };
    }
    return { eventId: ingested.event.id, revision: put.record.revision };
  }

  /** Durable task status transition + observation (single CAS write). */
  private async transitionTask(
    task: TaskRecord,
    status: TaskRecord['status'],
    eventKind: string,
    payloadExtra: Record<string, unknown>,
  ): Promise<FabricTaskTransition> {
    const sequence = task.observations.length + 1;
    const eventId = observationEventId(task.task_id, sequence);
    const now = formatRfc3339(this.clock.nowEpochMs());
    const ingested = await this.ingestObservation({
      id: eventId,
      source: FABRIC_EVENT_SOURCE,
      kind: eventKind,
      occurred_at: now,
      payload: { task_id: task.task_id, from: task.status, to: status, ...payloadExtra },
      provenance: [FABRIC_EVENT_SOURCE, `task:${task.task_id}`],
    });
    const updated: TaskRecord = {
      ...structuredClone(task),
      status,
      observations: [...task.observations, ingested.event.id],
      updated_at: now,
      revision: task.revision + 1,
    };
    const put = await this.tasks.put(updated, { expected_revision: task.revision });
    if (put.kind === 'CONFLICT') {
      return {
        status: 'DENIED',
        denial: fabricDenial('INVALID_TASK_INPUT', `transition to ${status} lost the CAS race (${put.reason}) — retry`, {
          task_id: task.task_id,
        }),
        observation_id: ingested.event.id,
      };
    }
    return { status: 'TRANSITIONED', task: put.record, observation_id: ingested.event.id };
  }
}

/** Strip the discriminating `kind` for the observation payload's operation echo. */
function stripKind(operation: FabricOperation): Record<string, unknown> {
  const { kind: _kind, ...rest } = operation;
  return rest as Record<string, unknown>;
}
