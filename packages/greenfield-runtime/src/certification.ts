/**
 * THE COMPLETION CERTIFICATION GATE (Work Order P13).
 *
 * spec/productization-execution-architecture.md §10: "A worker/body may
 * report completion, but it may not certify mission success by itself."
 * The P13 rule pinned by the work order: THE PIPELINE ITSELF NEVER
 * CERTIFIES ITS OWN OUTPUT — the pipeline REQUESTS certification, the
 * INDEPENDENT P9 EVALUATION SUITE grants or denies.
 *
 * This module is a REQUESTER + RELAY, nothing more:
 *
 *   - it builds the evaluation plan from the typed requirements (which
 *     P9 evaluators must pass) and runs ONE suite through the merged
 *     P9 EvaluationOrchestrator against the EXACT target revision;
 *   - GRANTED is derived ONLY from the suite's own verdicts (every
 *     applicable verdict PASS, zero FAIL / UNKNOWN / denied / not
 *     evaluated) — never from the caller's opinion;
 *   - STRUCTURAL INDEPENDENCE (the P13 pin): a completion request from
 *     the ACTING BODY is a typed independence violation, denied BEFORE
 *     any probe runs — the acting body never certifies its own output.
 *     The P9 evaluator's own bound-probe denials
 *     (EVALUATION_INDEPENDENCE_VIOLATION) are surfaced verbatim;
 *   - uncertainty is RETAINED: every UNKNOWN verdict and probe limitation
 *     survives into the outcome (no fabricated completion).
 */

import { contentAddress } from '@sos-2/action-gateway';
import type { ActionFamily, Clock } from '@sos-2/action-gateway';
import { aggregate, buildPlan } from '@sos-2/evaluation-orchestration';
import type {
  EvaluationOrchestrator,
  EvaluationPlan,
  EvaluationSummary,
  SuiteContext,
  SuiteRunRecord,
} from '@sos-2/evaluation-orchestration';
import { EVALUATION_TYPES } from '@sos-2/evaluator';
import type { EvaluationActorRef, EvaluationDenial, EvaluationTarget, EvaluationType, StructuredFailure } from '@sos-2/evaluator';

/** A completion certification request (typed, inspectable). */
export interface CertificationRequest {
  /** Which P9 evaluators must pass (non-empty, from the P9 vocabulary). */
  readonly requirements: readonly EvaluationType[];
  /** The exact target under evaluation (source + deployment revisions + producer). */
  readonly target: EvaluationTarget;
  /** Who requests the certification. */
  readonly requestedBy: EvaluationActorRef;
  /** The action family context (P9 applicability), or null. */
  readonly family: ActionFamily | null;
  /** The mission context (P9 applicability), or null. */
  readonly mission: string | null;
  /** Probe invocation bound per evaluation step (default 2). */
  readonly maxAttemptsPerStep?: number;
}

/** The typed outcome of a certification request. */
export type CertificationOutcome =
  | {
      readonly kind: 'GRANTED';
      readonly certificationId: string;
      readonly run: SuiteRunRecord;
      readonly summary: EvaluationSummary;
    }
  | {
      readonly kind: 'DENIED';
      readonly certificationId: string;
      readonly run: SuiteRunRecord;
      readonly summary: EvaluationSummary;
      /** Typed denial reasons (never a bare score). */
      readonly reasons: readonly string[];
      readonly failures: readonly StructuredFailure[];
    }
  | {
      readonly kind: 'INDEPENDENCE_DENIED';
      /** The typed independence violation surfaced verbatim. */
      readonly denial:
        | { readonly code: 'EVALUATION_INDEPENDENCE'; readonly requestedBy: EvaluationActorRef; readonly producedBy: EvaluationActorRef; readonly detail: string }
        | EvaluationDenial;
      readonly certificationId: string | null;
    };

/** Certifier dependencies: the P9 evaluation orchestration + the injected clock. */
export interface CompletionCertifierDeps {
  readonly orchestration: EvaluationOrchestrator;
  readonly clock: Clock;
}

function sameActor(a: EvaluationActorRef, b: EvaluationActorRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Validate a certification request (throws TypeError on shape violations). */
function assertValidCertificationRequest(input: CertificationRequest): void {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('a certification request must be an object');
  }
  if (
    !Array.isArray(input.requirements) ||
    input.requirements.length === 0 ||
    !input.requirements.every((type) => (EVALUATION_TYPES as readonly string[]).includes(type)) ||
    new Set(input.requirements as string[]).size !== (input.requirements as string[]).length
  ) {
    throw new TypeError(
      `certification requirements must be a non-empty, duplicate-free array of P9 evaluation types [${EVALUATION_TYPES.join(', ')}]`,
    );
  }
  if (typeof input.target !== 'object' || input.target === null || typeof input.target.sourceRevision !== 'string') {
    throw new TypeError('certification target must carry the exact source revision under evaluation');
  }
  if (typeof input.requestedBy !== 'object' || input.requestedBy === null || typeof input.requestedBy.id !== 'string') {
    throw new TypeError('certification requestedBy must be { kind, id }');
  }
}

/**
 * THE COMPLETION CERTIFIER — the pipeline's request surface to the
 * independent evaluation suite. It grants NOTHING on its own: every
 * GRANTED verdict is a relay of the P9 suite's own verdicts.
 */
export class CompletionCertifier {
  private readonly orchestration: EvaluationOrchestrator;
  private readonly clock: Clock;

  constructor(deps: CompletionCertifierDeps) {
    if (typeof deps !== 'object' || deps === null || typeof deps.orchestration !== 'object' || deps.orchestration === null) {
      throw new TypeError('CompletionCertifier requires the P9 EvaluationOrchestrator injected');
    }
    if (typeof deps.clock !== 'object' || deps.clock === null || typeof deps.clock.now !== 'function') {
      throw new TypeError('CompletionCertifier requires an injected clock (no hidden time)');
    }
    this.orchestration = deps.orchestration;
    this.clock = deps.clock;
  }

  /** Request completion certification (the ONLY completion path). */
  request(input: CertificationRequest): CertificationOutcome {
    assertValidCertificationRequest(input);

    // STRUCTURAL INDEPENDENCE (the P13 pin): the acting body never
    // certifies its own output. Denied BEFORE any probe runs.
    if (input.requestedBy.kind === 'body' && sameActor(input.requestedBy, input.target.producedBy)) {
      return {
        kind: 'INDEPENDENCE_DENIED',
        denial: {
          code: 'EVALUATION_INDEPENDENCE',
          requestedBy: input.requestedBy,
          producedBy: input.target.producedBy,
          detail:
            'the acting body requested certification of its own output — a worker/body may report completion but may never certify mission success (§10); the request is denied before any probe runs',
        },
        certificationId: null,
      };
    }

    const maxAttempts = input.maxAttemptsPerStep ?? 2;
    const plan: EvaluationPlan = buildPlan({
      steps: input.requirements.map((type) => ({ stepId: `p13-cert-${type}`, type, maxAttempts })),
      applicability: [{ families: ['*'], missions: '*', types: [...input.requirements] }],
      maxRepairAttempts: 0,
    });
    const context: SuiteContext = {
      plan,
      target: input.target,
      requestedBy: input.requestedBy,
      family: input.family,
      mission: input.mission,
    };
    const run = this.orchestration.runSuite(context);
    const summary = aggregate(run);

    // A P9 independence denial (a bound evaluator asked to certify its
    // producer) surfaces verbatim — never a grant.
    for (const step of run.results) {
      if (step.outcome.kind === 'denied') {
        return {
          kind: 'INDEPENDENCE_DENIED',
          denial: step.outcome.denial,
          certificationId: null,
        };
      }
    }

    const certificationId = contentAddress(
      {
        requirements: [...input.requirements],
        target: input.target,
        runId: run.runId,
        summaryDigest: summary.summaryDigest,
        passed: summary.passed,
        failed: summary.failed,
        unknown: summary.unknown,
        denied: summary.denied,
        notEvaluated: summary.notEvaluated,
      },
      'p13-certification',
    );

    if (summary.failed > 0 || summary.unknown > 0 || summary.denied > 0 || summary.notEvaluated > 0 || summary.passed !== input.requirements.length) {
      const reasons: string[] = [];
      if (summary.failed > 0) reasons.push(`${summary.failed} evaluation verdict(s) FAILED`);
      if (summary.unknown > 0) reasons.push(`${summary.unknown} evaluation verdict(s) UNKNOWN — evidence is absent and completion is never fabricated from absence`);
      if (summary.denied > 0) reasons.push(`${summary.denied} evaluation step(s) denied`);
      if (summary.notEvaluated > 0) reasons.push(`${summary.notEvaluated} evaluation step(s) not evaluated`);
      if (summary.passed !== input.requirements.length && reasons.length === 0) {
        reasons.push(`only ${summary.passed}/${input.requirements.length} required evaluators passed`);
      }
      return { kind: 'DENIED', certificationId, run, summary, reasons, failures: [...summary.failures] };
    }

    return { kind: 'GRANTED', certificationId, run, summary };
  }

  /** The injected clock (audit). */
  get now(): Clock {
    return this.clock;
  }
}
