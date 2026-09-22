/**
 * Typed WorkerResult records (Work Order P6) — the honest output of one
 * worker run over an assigned task.
 *
 * HONESTY DISCIPLINE:
 *   - evidence_refs are DURABLE references (observation event ids +
 *     content-addressed artifact ids) — never fabricated; a run that
 *     produced no evidence says so (empty list);
 *   - workspace_revision is the EXACT revision the worker produced or
 *     observed (a git commit ref when a commit ran, else null — never
 *     defaulted);
 *   - provenance carries the worker identity, the body/harness identity
 *     and — WHEN THE REASONING BROKER PARTICIPATED in producing the plan
 *     the worker executes — the provider identity + model + version and
 *     the analysis ids;
 *   - status is one of:
 *       COMPLETED_REPORT — the worker BELIEVES it finished (a report,
 *                          NEVER a certification — section 10: the
 *                          orchestrator routes it to independent
 *                          verification);
 *       FAILED           — a typed failure (worker crash, body loss,
 *                          provider outage, operation failure, capability
 *                          unsupported, authority gap) with the honest
 *                          reason and the fabric denial code when any;
 *       ASK_REQUIRED     — the run stopped on an ask step; the
 *                          orchestrator escalates a first-class ask;
 *   - uncertainty statements are RETAINED (never dropped);
 *   - resumed_from_checkpoint names the checkpoint the run resumed from
 *     (null when it started from zero).
 */

import type { TaskFailureKind } from '@sos-2/task-graph';

/** The honest status of one worker run. */
export const WORKER_RESULT_STATUSES = ['COMPLETED_REPORT', 'FAILED', 'ASK_REQUIRED'] as const;
export type WorkerResultStatus = (typeof WORKER_RESULT_STATUSES)[number];

/** Provenance of the reasoning that produced the executed plan (when the broker participated). */
export interface WorkerReasoningProvenance {
  readonly provider_id: string;
  readonly provider_kind: 'managed' | 'byo';
  readonly model: string;
  readonly version: string;
  /** The non-authoritative analysis ids that informed the plan. */
  readonly analysis_ids: readonly string[];
  readonly simulated: boolean;
}

/** Full provenance of one worker run. */
export interface WorkerProvenance {
  /** The worker's RUNTIME identity (never a semantic identity). */
  readonly worker_id: string;
  /** The body/harness the run executed on (runtime identities). */
  readonly body_id: string | null;
  readonly harness_id: string | null;
  /** The reasoning provenance when the broker participated, else null. */
  readonly reasoning: WorkerReasoningProvenance | null;
}

/** The typed failure block of a FAILED result. */
export interface WorkerFailure {
  readonly kind: TaskFailureKind;
  readonly reason: string;
  /** The fabric denial code when the failure derived from a denial. */
  readonly denial_code: string | null;
  /** True when the failure is an explicit simulated injection (honest marker). */
  readonly simulated: boolean;
}

/** The typed ask-escalation payload of an ASK_REQUIRED result. */
export interface WorkerAskEscalation {
  readonly statement: string;
  readonly basis: string;
}

/** THE typed worker result. */
export interface WorkerResult {
  readonly task_id: string;
  readonly worker_id: string;
  readonly status: WorkerResultStatus;
  /** Durable evidence references (observation ids + artifact ids) — never fabricated. */
  readonly evidence_refs: readonly string[];
  /** The exact workspace revision produced/observed (never defaulted). */
  readonly workspace_revision: { readonly source_revision: string | null; readonly deployment_revision: string | null };
  readonly provenance: WorkerProvenance;
  /** Retained unresolved uncertainty statements. */
  readonly uncertainty: readonly string[];
  readonly failure: WorkerFailure | null;
  readonly ask: WorkerAskEscalation | null;
  /** The checkpoint the run resumed from (null when from zero). */
  readonly resumed_from_checkpoint: string | null;
  readonly summary: string;
  /** How many steps ran, and how many the program carries (honest progress). */
  readonly steps_executed: number;
  readonly steps_total: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate a WorkerResult (throws typed on shape violations — honest shapes only). */
export function assertValidWorkerResult(value: unknown): asserts value is WorkerResult {
  if (!isPlainObject(value)) {
    throw new Error('worker result must be an object');
  }
  const keys = [
    'task_id',
    'worker_id',
    'status',
    'evidence_refs',
    'workspace_revision',
    'provenance',
    'uncertainty',
    'failure',
    'ask',
    'resumed_from_checkpoint',
    'summary',
    'steps_executed',
    'steps_total',
  ];
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(`worker result must have the exact field set { ${keys.join(', ')} }`);
  }
  if (!isNonEmptyString(value['task_id']) || !isNonEmptyString(value['worker_id'])) {
    throw new Error('worker result task_id and worker_id must be non-empty strings');
  }
  if (value['status'] !== 'COMPLETED_REPORT' && value['status'] !== 'FAILED' && value['status'] !== 'ASK_REQUIRED') {
    throw new Error(`worker result status must be one of ${WORKER_RESULT_STATUSES.join(', ')}, received: ${JSON.stringify(value['status'])}`);
  }
  if (!Array.isArray(value['evidence_refs']) || !value['evidence_refs'].every(isNonEmptyString)) {
    throw new Error('worker result evidence_refs must be an array of non-empty durable references');
  }
  if (!Array.isArray(value['uncertainty']) || !value['uncertainty'].every(isNonEmptyString)) {
    throw new Error('worker result uncertainty must be an array of non-empty statements');
  }
  if (typeof value['summary'] !== 'string') {
    throw new Error('worker result summary must be a string');
  }
  if (typeof value['steps_executed'] !== 'number' || typeof value['steps_total'] !== 'number') {
    throw new Error('worker result step counts must be numbers');
  }
  if (value['status'] === 'FAILED' && !isPlainObject(value['failure'])) {
    throw new Error('a FAILED worker result carries its typed failure block');
  }
  if (value['status'] === 'ASK_REQUIRED' && !isPlainObject(value['ask'])) {
    throw new Error('an ASK_REQUIRED worker result carries its ask escalation payload');
  }
}
