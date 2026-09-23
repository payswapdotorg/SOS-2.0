import { contentAddress } from '@sos-2/action-gateway';
import type { Clock } from '@sos-2/action-gateway';

export type Timestamp = number;
export type { Clock };

export interface EvaluationActorRef {
  readonly kind: 'body' | 'human' | 'system';
  readonly id: string;
}

/** §10 completion-discipline evidence types — every one a typed probe contract. */
export const EVALUATION_TYPES = [
  'tests',
  'static-contract-checks',
  'browser-journeys',
  'runtime-verification',
  'security-checks',
  'mission-metrics',
  'deployment-checks',
] as const;

export type EvaluationType = (typeof EVALUATION_TYPES)[number];

/**
 * What was evaluated. A verdict NEVER floats free of its target: the exact
 * source revision (and deployment revision where applicable) is part of the
 * verdict's content address.
 */
export interface EvaluationTarget {
  readonly sourceRevision: string;
  readonly deploymentRevision: string | null;
  /** The body/actor whose output is under evaluation (independence basis). */
  readonly producedBy: EvaluationActorRef;
}

export interface EvaluationRequest {
  readonly evaluationId: string;
  readonly type: EvaluationType;
  readonly target: EvaluationTarget;
  readonly requestedBy: EvaluationActorRef;
}

export type VerdictStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface CheckResult {
  readonly check: string;
  readonly passed: boolean;
  readonly detail: string;
  readonly expected: string | null;
  readonly actual: string | null;
}

export interface StructuredFailure {
  readonly check: string;
  readonly message: string;
  readonly expected: string | null;
  readonly actual: string | null;
}

export interface CollectedEvidence {
  readonly evidenceType: EvaluationType;
  readonly summary: string;
  readonly checks: readonly CheckResult[];
  readonly artifactDigest: string;
}

export interface EvaluatorRefShape {
  readonly evaluatorId: string;
  readonly boundActor: EvaluationActorRef | null;
}

export interface EvaluationVerdict {
  readonly verdictId: string;
  readonly type: EvaluationType;
  readonly verdict: VerdictStatus;
  readonly target: EvaluationTarget;
  readonly evaluator: EvaluatorRefShape;
  /** null exactly when no evidence exists — an honest absence, never fabricated. */
  readonly evidence: CollectedEvidence | null;
  readonly uncertainty: readonly string[];
  /** Structured failure evidence a repair loop or an ASK consumes. */
  readonly failureEvidence: readonly StructuredFailure[];
  readonly observedAt: Timestamp;
}

export type EvaluationDenial = {
  readonly code: 'EVALUATION_INDEPENDENCE_VIOLATION';
  readonly evaluatorId: string;
  readonly boundActor: EvaluationActorRef;
  readonly requestedBy: EvaluationActorRef;
  readonly detail: string;
};

export type EvaluationResult =
  | { readonly kind: 'verdict'; readonly verdict: EvaluationVerdict }
  | { readonly kind: 'denied'; readonly denial: EvaluationDenial };

export function verdictFingerprint(input: {
  readonly type: EvaluationType;
  readonly verdict: VerdictStatus;
  readonly target: EvaluationTarget;
  readonly evaluatorId: string;
  readonly failureEvidence: readonly StructuredFailure[];
}): string {
  return contentAddress(
    {
      type: input.type,
      verdict: input.verdict,
      target: input.target,
      evaluatorId: input.evaluatorId,
      failureEvidence: input.failureEvidence,
    },
    'evaluation-verdict',
  );
}

/** A verdict is bound to its target exactly when its content address recomputes against it. */
export function verdictMatchesTarget(verdict: EvaluationVerdict, target: EvaluationTarget): boolean {
  if (contentAddress(verdict.target, 'evaluation-target') !== contentAddress(target, 'evaluation-target')) {
    return false;
  }
  return (
    verdict.verdictId ===
    verdictFingerprint({
      type: verdict.type,
      verdict: verdict.verdict,
      target,
      evaluatorId: verdict.evaluator.evaluatorId,
      failureEvidence: verdict.failureEvidence,
    })
  );
}

/** What a single probe run produced (the worker's types.ts amendment, applied verbatim). */
export type ProbeObservation =
  | { readonly status: 'EVIDENCE_COLLECTED'; readonly evidence: CollectedEvidence; readonly limitations: readonly string[] }
  | { readonly status: 'NO_EVIDENCE'; readonly limitations: readonly string[] }
  | { readonly status: 'NOT_YET_CONNECTED'; readonly limitations: readonly string[] }
  | { readonly status: 'PROBE_FAILED'; readonly retryable: boolean; readonly limitations: readonly string[] };
