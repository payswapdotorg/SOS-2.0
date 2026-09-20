/**
 * ExecutionAdapter — the W12 contract for running candidate code
 * (spec/work-orders/W12-platform-adapters.md; docs/implementation/
 * REFERENCE-STACK.md: runtime/package adapters implement stable contracts).
 *
 * WHAT THIS IS: the interface an execution substrate implements (a process
 * spawner, a container runner, an isolate) to run a DECLARED operation,
 * plus an in-memory reference implementation.
 *
 * EXECUTION IS AUTHORITY CHECKED: every execution request carries the
 * AuthorityGrantArtifact itself plus its evaluation point; the reference
 * implementation validates the grant through @sos-2/authority's
 * `evaluateGrant` BEFORE running anything. An expired, revoked or
 * malformed grant yields EXECUTION_DENIED with a structured reason — the
 * operation never runs. This mirrors (and is consistent with) the
 * RuntimeHost gate in @sos-2/runtimes; both consume the same frozen
 * authority evaluation, neither re-implements it.
 *
 * TRUTHFUL RESULTS: a run that happened reports availability from the 6
 * frozen truth states (SUCCESS when the operation returned, FAILURE when it
 * threw or its output was unusable) with the output preserved as a JSON
 * payload; a run that was refused reports a structured denial. A denial is
 * never reported as a failure of the candidate — refusing to run and
 * running-and-failing are distinct facts.
 */

import { evaluateGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact, GrantEvaluationInput } from '@sos-2/authority';
import type { EvidenceTruthState, JsonValue } from '@sos-2/semantic-spine';
import { ExecutionAdapterError } from './errors.js';
import { assertValidJsonValue } from './json.js';
import { verifyAdapterOutputs } from './semantic-bridge.js';
import type { AdapterContractDescriptor } from './semantic-bridge.js';

/** The execution adapter contract: bridged outputs are the truthful availability + the JSON output. */
export const EXECUTION_ADAPTER_DESCRIPTOR: AdapterContractDescriptor = {
  contract: 'ExecutionAdapter',
  outputs: {
    availability: 'EvidenceTruthState',
    output: 'JsonValue',
    grant_ref: 'ArtifactId',
  },
} as const;

/** The executed-result output site: { availability, output, grant_ref }. */
const EXECUTION_RESULT_OUTPUT: AdapterContractDescriptor = {
  contract: 'ExecutionAdapter',
  outputs: {
    availability: 'EvidenceTruthState',
    output: 'JsonValue',
    grant_ref: 'ArtifactId',
  },
} as const;

/** Structured denial codes (authority plane; operational metadata, not semantics). */
export const EXECUTION_ADAPTER_DENIAL_CODES = ['GRANT_EXPIRED', 'GRANT_REVOKED'] as const;

export type ExecutionAdapterDenialCode = (typeof EXECUTION_ADAPTER_DENIAL_CODES)[number];

/** A structured execution denial — WHY the operation did not run. */
export interface ExecutionAdapterDenial {
  /** One of the frozen denial codes. */
  code: ExecutionAdapterDenialCode;
  /** The grant that was refused (spine id), when the grant was resolvable. */
  grant_ref: string | null;
  /** Deterministic human-readable reason. */
  reason: string;
}

/** An authority-gated execution request. */
export interface AdapterExecutionRequest {
  /** The declared operation to run (non-empty; must have a registered handler). */
  operation: string;
  /** The operation input (JSON), or null. */
  input: JsonValue | null;
  /** REQUIRED: the authority grant for this execution (validated + evaluated). */
  grant: AuthorityGrantArtifact;
  /** REQUIRED: the grant evaluation point (now, or a revision checkpoint). */
  at: GrantEvaluationInput;
}

/** The result of an execution attempt. */
export type ExecutionAdapterResult =
  | {
      /** The operation ran. */
      status: 'EXECUTED';
      /** Truthful outcome of the run (SUCCESS | FAILURE). */
      availability: EvidenceTruthState;
      /** The operation's return value (JSON), or null when failed/none. */
      output: JsonValue | null;
      /** Non-null error description iff availability is FAILURE. */
      error: string | null;
      /** The grant that authorized the run (spine id). */
      grant_ref: string;
    }
  | {
      /** The operation was REFUSED — it never ran. */
      status: 'EXECUTION_DENIED';
      /** The structured denial reason. */
      denial: ExecutionAdapterDenial;
    };

/** A candidate-code operation handler: input -> output (may throw). */
export type AdapterOperationHandler = (input: JsonValue | null) => JsonValue | null;

/**
 * The execution contract. Implementations MUST validate the grant through
 * @sos-2/authority evaluation before running anything.
 */
export interface ExecutionAdapter {
  /** The declared contract (bridged outputs; part of the semantic guard). */
  readonly descriptor: AdapterContractDescriptor;

  /** Which operations this substrate can run (sorted; deterministic). */
  operations(): string[];

  /** Execute one authority-gated request. */
  execute(request: AdapterExecutionRequest): ExecutionAdapterResult;
}

/**
 * In-memory reference implementation: operations are handler functions
 * supplied at construction. The grant gate (assertValidGrant +
 * evaluateGrant) is consumed from @sos-2/authority; every executed result is
 * self-verified through the semantic bridge guard.
 */
export class InMemoryExecutionAdapter implements ExecutionAdapter {
  readonly descriptor: AdapterContractDescriptor = EXECUTION_ADAPTER_DESCRIPTOR;

  private readonly handlers = new Map<string, AdapterOperationHandler>();

  constructor(handlers: Record<string, AdapterOperationHandler> = {}) {
    for (const [operation, handler] of Object.entries(handlers)) {
      this.registerOperation(operation, handler);
    }
  }

  /** Register a handler for a declared operation (idempotent overwrite). */
  registerOperation(operation: string, handler: AdapterOperationHandler): void {
    if (typeof operation !== 'string' || operation.length === 0) {
      throw new ExecutionAdapterError('operation name must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new ExecutionAdapterError(`handler for operation ${JSON.stringify(operation)} must be a function`);
    }
    this.handlers.set(operation, handler);
  }

  operations(): string[] {
    return [...this.handlers.keys()].sort();
  }

  execute(request: AdapterExecutionRequest): ExecutionAdapterResult {
    if (typeof request !== 'object' || request === null) {
      throw new ExecutionAdapterError('execution request must be an object');
    }
    if (typeof request.operation !== 'string' || request.operation.length === 0) {
      throw new ExecutionAdapterError('execution request operation must be a non-empty string');
    }
    if (request.input !== null) {
      try {
        assertValidJsonValue(request.input);
      } catch {
        throw new ExecutionAdapterError('execution request input must be null or a JSON value');
      }
    }
    // Missing grant (a cast-forged request) is rejected loudly, before any
    // evaluation: a grant-less execution never runs.
    if (typeof request.grant !== 'object' || request.grant === null) {
      throw new ExecutionAdapterError(
        'execution request carries no grant — execution is authority checked and a grant is REQUIRED',
      );
    }

    // AUTHORITY GATE (consumed from @sos-2/authority — never re-implemented).
    let status: ReturnType<typeof evaluateGrant>;
    try {
      status = evaluateGrant(request.grant, request.at);
    } catch (cause) {
      throw new ExecutionAdapterError(
        `grant evaluation failed (malformed grant or indeterminate evaluation point): ${(cause as Error).message}`,
      );
    }
    if (status !== 'VALID') {
      const denial: ExecutionAdapterDenial = {
        code: status === 'EXPIRED' ? 'GRANT_EXPIRED' : 'GRANT_REVOKED',
        grant_ref: request.grant.envelope?.id ?? null,
        reason:
          status === 'EXPIRED'
            ? `execution denied: grant is EXPIRED at the evaluation point (expired and revoked grants never authorize)`
            : `execution denied: grant is REVOKED (expired and revoked grants never authorize)`,
      };
      return { status: 'EXECUTION_DENIED', denial };
    }

    const handler = this.handlers.get(request.operation);
    if (handler === undefined) {
      // An undeclared operation is a contract violation, not a denial: the
      // host executes DECLARED operations only. Loud.
      throw new ExecutionAdapterError(
        `undeclared operation: ${JSON.stringify(request.operation)} (declared: ${this.operations().join(', ') || 'none'})`,
      );
    }

    let output: JsonValue | null;
    try {
      output = handler(request.input === null ? null : structuredClone(request.input));
    } catch (cause) {
      const result: ExecutionAdapterResult = {
        status: 'EXECUTED',
        availability: 'FAILURE',
        output: null,
        error: `operation threw: ${(cause as Error).message}`,
        grant_ref: request.grant.envelope.id,
      };
      this.verifyResult(result);
      return result;
    }
    if (output !== null) {
      try {
        assertValidJsonValue(output);
      } catch (cause) {
        const result: ExecutionAdapterResult = {
          status: 'EXECUTED',
          availability: 'FAILURE',
          output: null,
          error: `operation returned a non-JSON payload: ${(cause as Error).message}`,
          grant_ref: request.grant.envelope.id,
        };
        this.verifyResult(result);
        return result;
      }
    }
    const result: ExecutionAdapterResult = {
      status: 'EXECUTED',
      availability: 'SUCCESS',
      output: output === null ? null : structuredClone(output),
      error: null,
      grant_ref: request.grant.envelope.id,
    };
    this.verifyResult(result);
    return result;
  }

  private verifyResult(result: ExecutionAdapterResult): void {
    if (result.status === 'EXECUTED') {
      verifyAdapterOutputs(EXECUTION_RESULT_OUTPUT, {
        availability: result.availability,
        output: result.output,
        grant_ref: result.grant_ref,
      });
    }
  }
}
