/**
 * Independent verification (Work Order P6) — the no-self-approval gate.
 *
 * spec/productization-execution-architecture.md §10: "A worker/body may
 * report completion, but it may not certify mission success by itself."
 * Worker results are routed to an INDEPENDENT VERIFICATION PORT whose
 * verdicts derive from DURABLE EVIDENCE ONLY (the observation-event
 * store and the task record's artifacts) — never from the worker's own
 * claim and NEVER from broker output.
 *
 * STRUCTURAL INDEPENDENCE (pinned):
 *   - the port's signature accepts only (task_id, worker_result) and
 *     reads the durable stores — there is no path through which a
 *     NonAuthoritativeAnalysis, a provider identity or any reasoning
 *     output can become a verdict input;
 *   - the reference verifier REJECTS evidence refs shaped like broker
 *     analysis ids ('ra:') with a typed SilentBypassViolationError naming
 *     the rule ('broker-output-never-verification-evidence') and the
 *     implicated field — a broker analysis can NEVER be verification
 *     evidence;
 *   - the verdict gates the task COMPLETED transition (the orchestrator
 *     completes a task only through completeVerifiedTask).
 */

import { contentHash } from '@sos-2/semantic-spine';
import type { Clock, ObservationEventRepository, TaskStateRepository } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import type { WorkerResult } from '@sos-2/worker-runtime';
import { assertValidWorkerResult } from '@sos-2/worker-runtime';
import { SilentBypassViolationError } from './errors.js';

/** The verification subject — what the verifier examines. */
export interface VerificationSubject {
  readonly task_id: string;
  readonly worker_result: WorkerResult;
}

/** The typed orchestrator verification record (independent verdict). */
export interface OrchestratorVerificationRecord {
  /** Content-derived deterministic id ('ver:' + 24 hex). */
  readonly verification_id: string;
  readonly task_id: string;
  readonly verdict: 'VERIFIED' | 'REJECTED';
  /** The durable evidence refs supporting the verdict. */
  readonly evidence_refs: readonly string[];
  /** The deterministic checks that ran (what was checked). */
  readonly checked: readonly string[];
  readonly summary: string;
  readonly recorded_at: string;
  /** STRUCTURAL marker: the verdict came from the independent port, never the worker. */
  readonly independent_of_worker: true;
}

/**
 * THE INDEPENDENT VERIFICATION PORT. The orchestrator routes every
 * worker completion REPORT here; the verdict (never the worker's claim)
 * gates the COMPLETED transition.
 */
export interface IndependentVerificationPort {
  verify(subject: VerificationSubject): Promise<OrchestratorVerificationRecord>;
}

/** Reference-verifier dependencies: the durable stores + the injected clock. */
export interface ReferenceVerifierDeps {
  readonly tasks: TaskStateRepository;
  readonly observationEvents: ObservationEventRepository;
  readonly clock: Clock;
}

/**
 * THE REFERENCE INDEPENDENT VERIFIER — deterministic, durable-evidence
 * driven. Checks (each recorded):
 *
 *   C1 worker-report-shape   the result validates as a WorkerResult;
 *   C2 report-not-claim      the status is COMPLETED_REPORT (a report —
 *                            the verdict, not the status, decides);
 *   C3 evidence-resolution   every evidence ref resolves in the durable
 *                            observation-event store OR the task
 *                            record's artifacts (no fabricated refs);
 *   C4 durable-trace         the task record carries observations (the
 *                            run left a durable trace);
 *   C5 complete-program      steps_executed === steps_total (the whole
 *                            program ran);
 *   C6 no-broker-evidence    NO evidence ref is a broker analysis id —
 *                            broker output is NEVER verification
 *                            evidence (typed violation naming the rule).
 */
export class ReferenceIndependentVerifier implements IndependentVerificationPort {
  private readonly tasks: TaskStateRepository;
  private readonly observationEvents: ObservationEventRepository;
  private readonly clock: Clock;

  constructor(deps: ReferenceVerifierDeps) {
    if (
      typeof deps !== 'object' ||
      deps === null ||
      typeof deps.tasks !== 'object' ||
      deps.tasks === null ||
      typeof deps.observationEvents !== 'object' ||
      deps.observationEvents === null ||
      typeof deps.clock !== 'object' ||
      deps.clock === null ||
      typeof deps.clock.nowEpochMs !== 'function'
    ) {
      throw new Error('ReferenceIndependentVerifier requires injected tasks, observationEvents and clock ports');
    }
    this.tasks = deps.tasks;
    this.observationEvents = deps.observationEvents;
    this.clock = deps.clock;
  }

  async verify(subject: VerificationSubject): Promise<OrchestratorVerificationRecord> {
    const checked: string[] = [];
    const failures: string[] = [];
    const now = formatRfc3339(this.clock.nowEpochMs());

    // C1 — the report shape.
    try {
      assertValidWorkerResult(subject.worker_result);
      checked.push('C1:worker-report-shape');
    } catch (cause) {
      checked.push('C1:worker-report-shape');
      failures.push(`the worker result failed shape validation: ${(cause as Error).message}`);
    }
    const result = subject.worker_result;

    // C2 — a completion REPORT (the claim under examination).
    checked.push('C2:report-not-claim');
    if (result.status !== 'COMPLETED_REPORT') {
      failures.push(`the worker result status is ${result.status}, not COMPLETED_REPORT — only completion reports enter verification`);
    }

    // C6 — no broker analysis ids as evidence (typed violation — LOUD).
    checked.push('C6:no-broker-evidence');
    for (const ref of result.evidence_refs) {
      if (ref.startsWith('ra:')) {
        throw new SilentBypassViolationError(
          'broker-output-never-verification-evidence',
          `evidence_refs[${result.evidence_refs.indexOf(ref)}]`,
          `broker analysis ${JSON.stringify(ref)} was presented as verification evidence — model-produced analysis is explicitly non-authoritative (spec/productization-execution-architecture.md §8) and can NEVER enter the verification-verdict path`,
        );
      }
    }

    // C3 — every evidence ref resolves durably.
    checked.push('C3:evidence-resolution');
    const record = await this.tasks.get(subject.task_id);
    if (record === undefined) {
      failures.push(`task ${JSON.stringify(subject.task_id)} is not in the durable task store`);
    } else {
      for (const ref of result.evidence_refs) {
        const observation = await this.observationEvents.get(ref);
        const artifact = observation === undefined ? record.artifacts.find((candidate) => candidate.artifact_id === ref) : undefined;
        if (observation === undefined && artifact === undefined) {
          failures.push(`evidence ref ${JSON.stringify(ref)} resolves to neither a durable observation event nor a task artifact — never fabricated`);
        }
      }
    }

    // C4 — a durable trace exists.
    checked.push('C4:durable-trace');
    if (record === undefined || record.observations.length === 0) {
      failures.push('the task record carries no durable observation trace');
    }

    // C5 — the whole program ran.
    checked.push('C5:complete-program');
    if (result.steps_executed !== result.steps_total) {
      failures.push(`the worker executed ${result.steps_executed}/${result.steps_total} steps — the work program is incomplete`);
    }

    const verdict: 'VERIFIED' | 'REJECTED' = failures.length === 0 ? 'VERIFIED' : 'REJECTED';
    const summary =
      verdict === 'VERIFIED'
        ? `independently verified from durable evidence: ${result.evidence_refs.length} evidence ref(s) resolved, the full program ran (${result.steps_total} steps), the durable trace exists`
        : `verification rejected: ${failures.join('; ')}`;
    const verificationId = `ver:${contentHash({
      task_id: subject.task_id,
      verdict,
      evidence_refs: [...result.evidence_refs],
      checked: [...checked],
      recorded_at: now,
    }).slice(0, 24)}`;
    return {
      verification_id: verificationId,
      task_id: subject.task_id,
      verdict,
      evidence_refs: [...result.evidence_refs],
      checked,
      summary,
      recorded_at: now,
      independent_of_worker: true,
    };
  }
}

/**
 * The verification gate for COMPLETED transitions: only a VERIFIED,
 * worker-independent record passes (pinned — a worker completion report
 * never certifies; a REJECTED verdict fails closed).
 */
export function assertVerificationGatesCompletion(record: OrchestratorVerificationRecord): void {
  if (record.independent_of_worker !== true) {
    throw new SilentBypassViolationError(
      'verification-gates-completion',
      'independent_of_worker',
      'completion requires a verification record produced by the INDEPENDENT verification port — the worker never certifies its own mission success (§10)',
    );
  }
  if (record.verdict !== 'VERIFIED') {
    throw new SilentBypassViolationError(
      'verification-gates-completion',
      'verdict',
      `completion requires a VERIFIED verdict, received ${JSON.stringify(record.verdict)} — the verification record gates the COMPLETED transition (no self-approval)`,
    );
  }
}
