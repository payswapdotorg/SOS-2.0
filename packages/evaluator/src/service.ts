import type { Clock } from '@sos-2/action-gateway';
import type { EvaluatorProbe, EvaluatorRegistry } from './probes.js';
import { verdictFingerprint } from './types.js';
import type {
  CollectedEvidence,
  EvaluationActorRef,
  EvaluationDenial,
  EvaluationRequest,
  EvaluationResult,
  EvaluationVerdict,
  ProbeObservation,
  StructuredFailure,
  VerdictStatus,
} from './types.js';

export const RETRYABLE_PROBE_FAILURE = 'probe failed (retryable)';
const NON_RETRYABLE_PROBE_FAILURE = 'probe failed (non-retryable)';

function sameActor(a: EvaluationActorRef, b: EvaluationActorRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** A body cannot approve its own output — nor can a bound evaluator certify its producer. */
export function independenceViolation(probe: EvaluatorProbe, request: EvaluationRequest): EvaluationDenial | null {
  const bound = probe.boundActor;
  if (bound === null) return null;
  const hitsRequester = sameActor(bound, request.requestedBy);
  const hitsProducer = sameActor(bound, request.target.producedBy);
  if (!hitsRequester && !hitsProducer) return null;
  return {
    code: 'EVALUATION_INDEPENDENCE_VIOLATION',
    evaluatorId: probe.evaluatorId,
    boundActor: bound,
    requestedBy: request.requestedBy,
    detail: `evaluator ${probe.evaluatorId} is bound to ${bound.kind}:${bound.id}; it cannot certify output produced/requested by ${request.target.producedBy.kind}:${request.target.producedBy.id}`,
  };
}

function buildVerdict(
  request: EvaluationRequest,
  probe: { evaluatorId: string; boundActor: EvaluationActorRef | null },
  observation: ProbeObservation,
  at: number,
): EvaluationVerdict {
  let verdict: VerdictStatus;
  let evidence: CollectedEvidence | null = null;
  let failureEvidence: StructuredFailure[] = [];
  let uncertainty: string[];
  if (observation.status === 'EVIDENCE_COLLECTED') {
    const failedChecks = observation.evidence.checks.filter((check) => !check.passed);
    failureEvidence = failedChecks.map((check) => ({
      check: check.check,
      message: check.detail,
      expected: check.expected,
      actual: check.actual,
    }));
    verdict = failedChecks.length === 0 ? 'PASS' : 'FAIL';
    evidence = observation.evidence;
    uncertainty = [...observation.limitations];
  } else if (observation.status === 'NO_EVIDENCE') {
    verdict = 'UNKNOWN';
    uncertainty = [...observation.limitations, 'no evidence was collected'];
  } else if (observation.status === 'NOT_YET_CONNECTED') {
    verdict = 'UNKNOWN';
    uncertainty = [...observation.limitations, 'NOT_YET_CONNECTED: no real provider evidence exists'];
  } else {
    verdict = 'UNKNOWN';
    uncertainty = [...observation.limitations, observation.retryable ? RETRYABLE_PROBE_FAILURE : NON_RETRYABLE_PROBE_FAILURE];
  }
  return {
    verdictId: verdictFingerprint({
      type: request.type,
      verdict,
      target: request.target,
      evaluatorId: probe.evaluatorId,
      failureEvidence,
    }),
    type: request.type,
    verdict,
    target: request.target,
    evaluator: { evaluatorId: probe.evaluatorId, boundActor: probe.boundActor },
    evidence,
    uncertainty,
    failureEvidence,
    observedAt: at,
  };
}

/**
 * Independent evaluation front door. Order is fixed:
 *   1. evaluator selection by evidence type,
 *   2. independence check (typed denial BEFORE the probe runs),
 *   3. probe run through the injectable seam,
 *   4. typed verdict — honest UNKNOWN wherever evidence is absent.
 */
export class IndependentEvaluationService {
  constructor(
    private readonly registry: EvaluatorRegistry,
    private readonly clock: Clock,
  ) {}

  evaluate(request: EvaluationRequest): EvaluationResult {
    const probe = this.registry.primaryFor(request.type);
    if (probe === null) {
      return {
        kind: 'verdict',
        verdict: buildVerdict(
          request,
          { evaluatorId: 'unbound', boundActor: null },
          { status: 'NO_EVIDENCE', limitations: [`no evaluator registered for ${request.type}`] },
          this.clock.now(),
        ),
      };
    }
    const violation = independenceViolation(probe, request);
    if (violation !== null) return { kind: 'denied', denial: violation };
    let observation: ProbeObservation;
    try {
      observation = probe.run(request);
    } catch (error) {
      observation = {
        status: 'PROBE_FAILED',
        retryable: false,
        limitations: [error instanceof Error ? error.message : 'probe threw'],
      };
    }
    return { kind: 'verdict', verdict: buildVerdict(request, probe, observation, this.clock.now()) };
  }
}
