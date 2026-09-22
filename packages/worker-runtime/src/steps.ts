/**
 * The typed work program (Work Order P6) — the step list a worker
 * executes for an assigned task.
 *
 * The step program is the authoritative plan fragment built by the
 * ORCHESTRATOR's deterministic decomposition (informed — never governed —
 * by the reasoning broker's non-authoritative analysis) and persisted in
 * the durable task node (opaque canonical JSON to the task graph; THIS
 * module is the typed vocabulary that serializes/deserializes it).
 *
 * Step kinds:
 *   - operation   : one section 9 harness operation dispatched through
 *                   the execution fabric (capability-checked first);
 *   - checkpoint  : record a durable checkpoint (progress + artifact
 *                   refs) through the fabric and chain it into the task
 *                   graph — a crashed worker resumes from the last
 *                   checkpoint, not from zero;
 *   - uncertainty : record an unresolved uncertainty statement (the run
 *                   CONTINUES — uncertainty is retained, never dropped);
 *   - ask         : stop the run and escalate an ASK to the authority
 *                   (ASK IS A SUCCESS STATE — the orchestrator enqueues
 *                   a first-class ask and parks the task).
 */

import type { FabricOperation } from '@sos-2/execution-fabric';
import { assertValidFabricOperation } from '@sos-2/execution-fabric';
import type { JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { InvalidWorkerInputError } from './errors.js';

/** One typed step of the work program. */
export type WorkerStep =
  | { readonly kind: 'operation'; readonly operation: FabricOperation }
  | { readonly kind: 'checkpoint'; readonly label: string | null; readonly notes: string | null }
  | { readonly kind: 'uncertainty'; readonly statement: string }
  | { readonly kind: 'ask'; readonly statement: string; readonly basis: string };

/** The serialized work program (the durable node's steps field). */
export interface WorkerStepProgram {
  readonly steps: readonly WorkerStep[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate one deserialized step (throws InvalidWorkerInputError). */
function assertValidStep(value: unknown): asserts value is WorkerStep {
  if (!isPlainObject(value) || typeof value['kind'] !== 'string') {
    throw new InvalidWorkerInputError(`work program step must be an object with a kind, received: ${JSON.stringify(value)}`);
  }
  switch (value['kind']) {
    case 'operation': {
      if (Object.keys(value).length !== 2 || !('operation' in value)) {
        throw new InvalidWorkerInputError('an operation step must be { kind: "operation", operation }');
      }
      try {
        assertValidFabricOperation(value['operation']);
      } catch (cause) {
        throw new InvalidWorkerInputError(`operation step failed fabric validation: ${(cause as Error).message}`);
      }
      return;
    }
    case 'checkpoint': {
      if (Object.keys(value).length !== 3 || !('label' in value) || !('notes' in value)) {
        throw new InvalidWorkerInputError('a checkpoint step must be { kind: "checkpoint", label, notes }');
      }
      if (value['label'] !== null && !isNonEmptyString(value['label'])) {
        throw new InvalidWorkerInputError('checkpoint label must be null or a non-empty string');
      }
      if (value['notes'] !== null && !isNonEmptyString(value['notes'])) {
        throw new InvalidWorkerInputError('checkpoint notes must be null or a non-empty string');
      }
      return;
    }
    case 'uncertainty': {
      if (Object.keys(value).length !== 2 || !('statement' in value) || !isNonEmptyString(value['statement'])) {
        throw new InvalidWorkerInputError('an uncertainty step must be { kind: "uncertainty", statement: non-empty string }');
      }
      return;
    }
    case 'ask': {
      if (
        Object.keys(value).length !== 3 ||
        !('statement' in value) ||
        !('basis' in value) ||
        !isNonEmptyString(value['statement']) ||
        !isNonEmptyString(value['basis'])
      ) {
        throw new InvalidWorkerInputError('an ask step must be { kind: "ask", statement: non-empty, basis: non-empty }');
      }
      return;
    }
    default:
      throw new InvalidWorkerInputError(
        `work program step kind must be operation | checkpoint | uncertainty | ask, received: ${JSON.stringify(value['kind'])}`,
      );
  }
}

/** Validate a full step program (throws InvalidWorkerInputError). */
export function assertValidWorkerStepProgram(value: unknown): asserts value is WorkerStepProgram {
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || !Array.isArray(value['steps'])) {
    throw new InvalidWorkerInputError('work program must be { steps: WorkerStep[] }');
  }
  for (const step of value['steps']) {
    assertValidStep(step);
  }
}

/** Serialize a step program to the canonical JSON stored in the node. */
export function serializeWorkerStepProgram(program: WorkerStepProgram): JsonValue {
  assertValidWorkerStepProgram(program);
  return structuredClone(program) as unknown as JsonValue;
}

/** Deserialize (and validate) the step program stored in a durable node. */
export function deserializeWorkerStepProgram(value: unknown): WorkerStepProgram {
  assertValidWorkerStepProgram(value);
  return { steps: [...value.steps] };
}

/** Structural JSON safety check used before validation. */
export function isCanonicalJson(value: unknown): boolean {
  try {
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}
