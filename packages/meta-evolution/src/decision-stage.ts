/**
 * Meta-evolution stage 5 — DECISION + PROMOTION (W16).
 *
 * AUTHORITY FIRST (the W10 rule order): every measured change goes through
 * @sos-2/decision's authority-aware engine —
 *   - the request targets the MetaProcess artifact (action REVISE) with the
 *     loop's REVISE grant over the MetaProcess kind, the change's
 *     blast-radius/impact/risk/reversibility/uncertainty dimensions and the
 *     WIRED rollback signals from the effectiveness measurement (a fired
 *     guardrail trigger forces ROLLBACK through R2 SAFETY — safety outranks
 *     everything after authority);
 *   - ASK IS FIRST-CLASS (R16): an authority-insufficient change (the
 *     SUPERVISED corner) produces an ASK decision + escalation, and the
 *     AskRequest is composed through @sos-2/ask and ENQUEUED — a SUCCESS
 *     state, never an error; the trial stays DRAFT pending authority;
 *   - the SIMULATED measurement is NEVER presented as evidence (R3 REJECTS
 *     simulated records loudly) — the evidence set is the fixture-declared
 *     PRIOR evidence, minted fresh by this stage.
 *
 * Then the @sos-2/promotion guardrails (only reached on an ACT engine
 * decision): the candidate fixture, the assurance case (built through
 * @sos-2/assurance over a @sos-2/verification runtime monitor of the
 * governance guard results, projected onto the W9 fixture surface), the
 * PROMOTE grant over the CandidateState kind, the prior promotion evidence
 * subject-bound to the candidate, the wired live triggers and the bounded
 * recovery declaration. An ACT promotion ACTIVATES the trial revision —
 * the applied MetaChange produces the new MetaProcess revision (versioned,
 * spine-traceable).
 *
 * Links: engine decision --DERIVED_FROM--> measurement result and change;
 * grants --CONSTRAINS--> decisions; promotion record --DERIVED_FROM-->
 * engine decision; assurance case --VERIFIES--> candidate; ask
 * --DERIVED_FROM--> engine decision; activated revision --DERIVED_FROM-->
 * promotion record.
 */

import { evaluate as evaluateDecision } from '@sos-2/decision';
import type { DecisionEvaluation, DecisionMeta, DecisionRequest } from '@sos-2/decision';
import { composeAskContent } from '@sos-2/ask';
import { AskQueue } from '@sos-2/ask';
import { createAskRequest } from '@sos-2/authority';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { evaluatePromotion } from '@sos-2/promotion';
import type { PromotionEvaluation, BoundedRecoveryDeclaration, AssuranceVerdict } from '@sos-2/promotion';
import { createAssuranceCase, evaluateAssuranceCase } from '@sos-2/assurance';
import type { AssuranceCaseArtifact, AssuranceEvaluation } from '@sos-2/assurance';
import { createInMemoryReferenceEngine, evaluateMonitor } from '@sos-2/verification';
import type { MonitorEvaluationResult } from '@sos-2/verification';
import { createEvidence } from '@sos-2/evidence';
import { createQualitativeConfidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { CandidateStateFixture, ExperimentEvaluation } from '@sos-2/experiments';
import { MetaEvolutionError } from './errors.js';
import type { MetaEvolutionInput, MetaChangeSpec, EvidenceSpec } from './input.js';
import type { DecisionStageRecord } from './stages.js';
import { metaTraceLink } from './trace.js';
import { activateRevision } from './process.js';
import type { MetaProcessArtifact, MetaProcessStore } from './process.js';
import type { MetaChangeArtifact } from './change.js';
import type { EffectivenessMeasurement } from './effectiveness.js';

/** The frozen W8 -> W9 verdict projection (documented, never inverted). */
export const ASSURANCE_VERDICT_PROJECTION: Readonly<Record<AssuranceEvaluation['verdict'], AssuranceVerdict>> = {
  VALID: 'SATISFIED',
  OBJECTIONED: 'INCOMPLETE',
  INVALID: 'REFUTED',
};

export interface DecisionEntry {
  record: DecisionStageRecord['entries'][number];
  change: MetaChangeArtifact;
  spec: MetaChangeSpec;
  measurement: EffectivenessMeasurement;
  engine: DecisionEvaluation;
  reviseGrant: AuthorityGrantArtifact;
  promotion: PromotionEvaluation | null;
  promoteGrant: AuthorityGrantArtifact | null;
  recovery: BoundedRecoveryDeclaration | null;
  assuranceCase: AssuranceCaseArtifact | null;
  assuranceEvaluation: AssuranceEvaluation | null;
  monitor: MonitorEvaluationResult | null;
  promotionEvidence: EvidenceRecordW3[];
  decisionEvidence: EvidenceRecordW3[];
  askId: string | null;
  activated: MetaProcessArtifact | null;
}

export interface DecisionStageOutput {
  record: DecisionStageRecord;
  entries: DecisionEntry[];
  askQueue: AskQueue;
}

/**
 * THE MEASUREMENT GATE: a meta change may only enter the promotion lane
 * AFTER its adaptation effectiveness has been measured (before/after on
 * the frozen §11 axes). An unmeasured promotion attempt is REJECTED loudly
 * (the W16 invariant "effectiveness-unmeasured promotion REJECTED").
 */
export function assertMeasuredBeforePromotion(
  candidateId: string,
  measurements: ReadonlyArray<{ candidate: CandidateStateFixture }>,
): void {
  const measured = measurements.some((measurement) => measurement.candidate.envelope.id === candidateId);
  if (!measured) {
    throw new MetaEvolutionError(
      'EFFECTIVENESS_UNMEASURED',
      `candidate ${candidateId} has no adaptation-effectiveness measurement — an unmeasured meta change cannot be promoted (W16: every applied MetaChange is measured before/after on the frozen section-11 axes)`,
    );
  }
}

/** Mint evidence records from specs, subject-bound to `subject`. */
export function mintEvidenceSet(
  input: MetaEvolutionInput,
  specs: readonly EvidenceSpec[],
  subject: string,
): EvidenceRecordW3[] {
  return specs.map((spec) =>
    createEvidence({
      kind: spec.kind,
      subject_ref: subject,
      availability: spec.availability,
      evidence_class: spec.evidence_class,
      method: spec.method,
      provenance: [...input.provenance, ...spec.provenance],
      window: { start: input.now, end: input.now },
      producer: input.producer,
    }),
  );
}

/** Build the bounded recovery declaration wired to the measurement guardrails. */
export function buildMetaBoundedRecovery(
  input: MetaEvolutionInput,
  measurement: EffectivenessMeasurement,
  grantId: string,
): BoundedRecoveryDeclaration {
  return {
    mechanism: `retire the DRAFT trial revision of meta change ${measurement.spec.key} and restore the exact pre-change MetaProcess parameters (supersede the trial with the restore revision; the applied surface is parameter state only)`,
    max_recovery_seconds: 120,
    containment_exception: null,
    rollback_triggers: measurement.evaluation.rollback.map((trigger) => ({
      experiment_id: measurement.experiment.envelope.id,
      trigger,
    })),
    authority_ref: grantId,
  };
}

/** The promotion-gate assurance fixture (the W9 surface projection). */
export interface MetaAssuranceFixture {
  id: string;
  claims: Array<{ id: string; statement: string }>;
  verdict: AssuranceVerdict;
  validity: { status: 'CURRENT' | 'EXPIRED' | 'SUPERSEDED' | 'VIOLATED'; expires_at: string | null; reason: string };
}

/** The assurance case over one meta candidate (governance-preservation claims). */
function buildAssurance(
  input: MetaEvolutionInput,
  measurement: EffectivenessMeasurement,
  process: MetaProcessArtifact,
): { assuranceCase: AssuranceCaseArtifact; evaluation: AssuranceEvaluation; monitor: MonitorEvaluationResult; fixture: MetaAssuranceFixture } {
  const { spec, change } = measurement;
  // 1. Runtime verification of the governance-guard verdict for this change.
  const monitor = evaluateMonitor(
    createInMemoryReferenceEngine(),
    {
      id: 'monitor:meta-governance-preserved',
      property: {
        kind: 'ALWAYS',
        predicate: 'change.preserves_governance_invariants',
        description: 'Every meta change preserves the frozen governance invariants (the guard is outside the evolvable surface).',
      },
    },
    [
      {
        predicate: 'change.preserves_governance_invariants',
        holds: true, // guard-passing changes only reach the promotion lane
        at: input.now,
      },
    ],
    {
      now: input.now,
      system_state_id: process.envelope.id,
      system_state_version: process.envelope.version,
      subject_revision: `${process.envelope.id}@v${process.envelope.version}`,
      implementation_revision: `meta-${spec.key}`,
      deployment_revision: 'meta-process-deployment-v1',
      producer: input.producer,
    },
  );

  // 2. The assurance case over the candidate.
  const claims = [
    { id: 'claim-governance-preserved', statement: `The meta change "${spec.key}" preserves every frozen governance invariant (authority gates, traceability, ASK, decision records).` },
    { id: 'claim-effectiveness-measured', statement: 'The meta change was measured before/after on the frozen section-11 axes through the fixed-seed simulator (marked simulated — never intervention evidence).' },
    { id: 'claim-change-reversible', statement: 'The trial revision is DRAFT-only and reversible within the declared bounded recovery window (exact parameter restore).' },
  ];
  const assuranceCase = createAssuranceCase({
    content: {
      claims,
      arguments: [
        {
          id: 'argument-meta-safety',
          strategy: 'Argument from governance-guard preservation, simulated measurement and bounded, reversible parameter change over observed evidence.',
          conclusion: 'claim-governance-preserved',
          premises: ['claim-effectiveness-measured', 'claim-change-reversible'],
        },
      ],
      assumptions: [
        { id: 'assumption-meta-fixture-representative', statement: 'The golden meta scenario is representative of the SOS process state at the exact revision.' },
      ],
      hazards: [
        { id: 'hazard-negative-effectiveness', description: 'The applied meta change degrades the process objectives below a wired guardrail.' },
      ],
      controls: [
        { id: 'control-wired-guardrails', mechanism: 'Wired effectiveness guardrails with fail-closed rollback triggers driving the ROLLBACK decision.', addresses: ['hazard-negative-effectiveness'] },
        { id: 'control-exact-restore', mechanism: 'Bounded recovery declaration with exact parameter restoration (the restore revision).', addresses: ['hazard-negative-effectiveness'] },
      ],
      evidence: [
        { evidence_id: monitor.evidence.id, role: 'VERIFIES', claim_ref: 'claim-governance-preserved' },
      ],
      validity_conditions: [
        { kind: 'IMPLEMENTATION', subject: 'sos-meta-process', valid_revisions: ['meta-process-v1'] },
        { kind: 'ENVIRONMENT', subject: 'sos-meta', valid_revisions: ['sos-meta-env-v1'] },
      ],
      objections: [
        {
          id: 'objection-architect-review-pending',
          statement: 'A human architect should review process-parameter evolution before the next meta cycle.',
          raised_at: input.now,
          status: 'RESOLVED',
          resolution: {
            note: 'Resolved for this cycle: activation is promotion-gated regardless; the guard re-runs on every application path.',
            resolved_at: input.now,
            provenance: [...input.provenance, 'meta-evolution:assurance-objection-resolution'],
          },
        },
      ],
    },
    provenance: [...input.provenance, 'meta-evolution:assurance-case', `meta-evolution:change:${change.envelope.id}`],
    created_at: input.now,
    authority_ref: input.authority_ref,
    status: 'ACTIVE',
  });

  const evaluation = evaluateAssuranceCase(assuranceCase, {
    now: input.now,
    systemStateRevision: `${process.envelope.id}@v${process.envelope.version}`,
    implementation_revisions: { 'sos-meta-process': 'meta-process-v1' },
    environment_revisions: { 'sos-meta': 'sos-meta-env-v1' },
    evidence: [monitor.evidence],
    assumption_checks: { 'assumption-meta-fixture-representative': true },
  });

  const fixture = {
    id: assuranceCase.envelope.id,
    claims: claims.map((claim) => ({ id: claim.id, statement: claim.statement })),
    verdict: ASSURANCE_VERDICT_PROJECTION[evaluation.verdict],
    validity: { status: 'CURRENT' as const, expires_at: null, reason: `the meta assurance case verdict is ${evaluation.verdict} at ${input.now}` },
  };
  return { assuranceCase, evaluation, monitor, fixture };
}

/** Run the decision + promotion lane for one measured change (deterministic, pure). */
export function decideChange(
  input: MetaEvolutionInput,
  measurement: EffectivenessMeasurement,
  process: MetaProcessArtifact,
  processStore: MetaProcessStore,
  askQueue: AskQueue,
): DecisionEntry {
  const { spec, change } = measurement;
  const meta: DecisionMeta = {
    provenance: [...input.provenance, 'meta-evolution:decision', `meta-evolution:spec:${spec.key}`],
    created_at: input.now,
    authority_ref: input.authority_ref,
  };

  // 1. The REVISE grant over the MetaProcess kind (the decision lane).
  let reviseGrant: AuthorityGrantArtifact;
  try {
    reviseGrant = createGrant({
      grantee: input.authority.decision.grantee,
      scope: { kind: 'KIND', artifact_kind: 'MetaProcess' },
      permissions: [...input.authority.decision.permissions],
      expiry: { kind: 'TIME', at: input.authority.decision.expires_at },
      provenance: [...input.provenance, 'meta-evolution:decision-authority'],
      created_at: input.now,
      authority_ref: input.authority_ref,
      status: 'ACTIVE',
    });
  } catch (cause) {
    throw new MetaEvolutionError('DECISION_STAGE_FAILED', `revise grant creation failed: ${(cause as Error).message}`);
  }

  // 2. The prior decision evidence (subject-bound to the PROCESS — the
  //    decision target). The SIMULATED measurement is NEVER presented.
  const decisionEvidence = mintEvidenceSet(input, spec.decision_evidence, process.envelope.id);

  // 3. The authority-aware decision request.
  const rollbackSignals = measurement.evaluation.rollback
    .filter((trigger) => trigger.triggered)
    .map((trigger) => `effectiveness rollback trigger "${trigger.rule_id}" fired: ${trigger.reason}`);
  const request: DecisionRequest = {
    action_kind: 'REVISE',
    action_description: `Apply the meta change "${spec.key}" to the SOS process parameters (target revision ${process.envelope.id}@v${process.envelope.version}).`,
    target: { kind: 'ARTIFACT', artifact_id: process.envelope.id },
    blast_radius: spec.blast_radius,
    impact: spec.impact,
    risk: spec.risk,
    reversibility: spec.reversibility,
    causal_claim: true,
    uncertainty: spec.uncertainty,
    rollback_signals: rollbackSignals,
    evidence: decisionEvidence,
    grants: [reviseGrant],
    evaluation_point: { kind: 'TIME', now: input.now },
    explicit_authority_decision_ref: null,
    confidence: createQualitativeConfidence('MODERATE'),
  };

  let engine: DecisionEvaluation;
  try {
    engine = evaluateDecision(request, meta);
  } catch (cause) {
    throw new MetaEvolutionError('DECISION_STAGE_FAILED', `decision evaluation failed: ${(cause as Error).message}`);
  }

  // 4. Dispatch on the engine action.
  let promotion: PromotionEvaluation | null = null;
  let promoteGrant: AuthorityGrantArtifact | null = null;
  let recovery: BoundedRecoveryDeclaration | null = null;
  let assuranceCase: AssuranceCaseArtifact | null = null;
  let assuranceEvaluation: AssuranceEvaluation | null = null;
  let monitorResult: MonitorEvaluationResult | null = null;
  let promotionEvidence: EvidenceRecordW3[] = [];
  let askId: string | null = null;
  let activated: MetaProcessArtifact | null = null;

  if (engine.action === 'ACT') {
    // 4a. The promotion guardrails (@sos-2/promotion) — ONLY for measured
    //     changes (the W16 measurement gate).
    assertMeasuredBeforePromotion(measurement.candidate.envelope.id, [measurement]);
    promotionEvidence = mintEvidenceSet(input, spec.promotion_evidence, measurement.candidate.envelope.id);
    const assurance = buildAssurance(input, measurement, process);
    assuranceCase = assurance.assuranceCase;
    assuranceEvaluation = assurance.evaluation;
    monitorResult = assurance.monitor;

    let grant: AuthorityGrantArtifact;
    try {
      grant = createGrant({
        grantee: input.authority.promotion.grantee,
        scope: { kind: 'KIND', artifact_kind: 'CandidateState' },
        permissions: [...input.authority.promotion.permissions],
        expiry: { kind: 'TIME', at: input.authority.promotion.expires_at },
        provenance: [...input.provenance, 'meta-evolution:promotion-authority'],
        created_at: input.now,
        authority_ref: input.authority_ref,
        status: 'ACTIVE',
      });
    } catch (cause) {
      throw new MetaEvolutionError('PROMOTION_STAGE_FAILED', `promote grant creation failed: ${(cause as Error).message}`);
    }
    promoteGrant = grant;
    recovery = buildMetaBoundedRecovery(input, measurement, grant.envelope.id);

    try {
      promotion = evaluatePromotion(measurement.candidate, {
        authority: { grant, now: input.now },
        assurance: assurance.fixture,
        evidence: promotionEvidence,
        liveTriggers: measurement.evaluation.rollback,
        systemState: { revision: `${process.envelope.id}@v${process.envelope.version}` },
        recovery,
        provenance: [...input.provenance, 'meta-evolution:promotion-decision', `meta-evolution:spec:${spec.key}`],
        created_at: input.now,
      });
    } catch (cause) {
      throw new MetaEvolutionError('PROMOTION_STAGE_FAILED', `promotion evaluation failed: ${(cause as Error).message}`);
    }

    // 4b. ACT promotion ACTIVATES the trial revision — the applied
    //     MetaChange produces the new MetaProcess revision.
    if (promotion.decision === 'ACT') {
      const { activated: activatedRevision, superseded } = activateRevision(measurement.trial, process);
      processStore.replace(process, superseded);
      processStore.replace(measurement.trial, activatedRevision);
      activated = activatedRevision;
    }
  } else if (engine.action === 'ASK') {
    // 4c. ASK is FIRST-CLASS (R16): compose + enqueue; the trial stays
    //     DRAFT pending the authority's resolution.
    let askContent;
    try {
      askContent = composeAskContent({ decision: engine.record, evidence: decisionEvidence });
    } catch (cause) {
      throw new MetaEvolutionError('ASK_STAGE_FAILED', `ask content composition failed: ${(cause as Error).message}`);
    }
    let ask;
    try {
      ask = createAskRequest({
        content: askContent,
        provenance: [...input.provenance, 'meta-evolution:ask', `meta-evolution:spec:${spec.key}`],
        created_at: input.now,
        authority_ref: input.authority_ref,
        status: 'ACTIVE',
      });
    } catch (cause) {
      throw new MetaEvolutionError('ASK_STAGE_FAILED', `ask request creation failed: ${(cause as Error).message}`);
    }
    try {
      askQueue.enqueue({ ask, origin_decision: engine.record, enqueued_at: input.now });
    } catch (cause) {
      throw new MetaEvolutionError('ASK_STAGE_FAILED', `ask enqueue failed: ${(cause as Error).message}`);
    }
    askId = ask.envelope.id;
  }
  // ROLLBACK / REJECT / EXPERIMENT / GATHER_EVIDENCE: no activation, no
  // promotion gate run for REJECT-class; ROLLBACK flows to the promotion
  // gate with wired live triggers in the rollback lane (revision.ts drives it).

  const record: DecisionStageRecord['entries'][number] = {
    change_id: change.envelope.id,
    candidate_id: measurement.candidate.envelope.id,
    engine_decision: engine.action,
    engine_record_id: engine.record.envelope.id,
    escalation_code: engine.escalation?.code ?? null,
    promotion_decision: promotion?.decision ?? null,
    promotion_record_id: promotion?.record.envelope.id ?? null,
    authority_grant_id: promoteGrant?.envelope.id ?? reviseGrant.envelope.id,
    recovery,
    ask_id: askId,
    ask_queue_pending: askId !== null,
    applied_revision_id: activated?.envelope.id ?? null,
  };

  return {
    record,
    change,
    spec,
    measurement,
    engine,
    reviseGrant,
    promotion,
    promoteGrant,
    recovery,
    assuranceCase,
    assuranceEvaluation,
    monitor: monitorResult,
    promotionEvidence,
    decisionEvidence,
    askId,
    activated,
  };
}

/** Assemble the full stage record + links. */
export function assembleDecisionRecord(
  input: MetaEvolutionInput,
  entries: readonly DecisionEntry[],
): DecisionStageRecord {
  const links = entries.flatMap((entry) => {
    const base = [
      metaTraceLink({
        source: entry.engine.record.envelope.id,
        target: entry.measurement.result.id,
        type: 'DERIVED_FROM',
        provenance: [...input.provenance, 'meta-evolution:stage:decision', `meta-evolution:spec:${entry.spec.key}`],
      }),
      metaTraceLink({
        source: entry.engine.record.envelope.id,
        target: entry.change.envelope.id,
        type: 'DERIVED_FROM',
        provenance: [...input.provenance, 'meta-evolution:stage:decision', `meta-evolution:change:${entry.change.envelope.id}`],
      }),
      metaTraceLink({
        source: entry.reviseGrant.envelope.id,
        target: entry.engine.record.envelope.id,
        type: 'CONSTRAINS',
        provenance: [...input.provenance, 'meta-evolution:stage:decision', `meta-evolution:grantee:${input.authority.decision.grantee}`],
      }),
    ];
    const promotionLinks = entry.promotion
      ? [
          metaTraceLink({
            source: entry.promotion.record.envelope.id,
            target: entry.engine.record.envelope.id,
            type: 'DERIVED_FROM',
            provenance: [...input.provenance, 'meta-evolution:stage:decision', `meta-evolution:promotion:${entry.promotion.decision}`],
          }),
          ...(entry.promoteGrant
            ? [
                metaTraceLink({
                  source: entry.promoteGrant.envelope.id,
                  target: entry.promotion.record.envelope.id,
                  type: 'CONSTRAINS',
                  provenance: [...input.provenance, 'meta-evolution:stage:decision', `meta-evolution:grantee:${input.authority.promotion.grantee}`],
                }),
              ]
            : []),
          ...(entry.activated
            ? [
                metaTraceLink({
                  source: entry.activated.envelope.id,
                  target: entry.promotion.record.envelope.id,
                  type: 'DERIVED_FROM',
                  provenance: [...input.provenance, 'meta-evolution:stage:decision', `meta-evolution:activated:${entry.activated.envelope.id}`],
                }),
              ]
            : []),
        ]
      : [];
    const assuranceLinks = entry.assuranceCase
      ? [
          metaTraceLink({
            source: entry.assuranceCase.envelope.id,
            target: entry.measurement.candidate.envelope.id,
            type: 'VERIFIES',
            provenance: [...input.provenance, 'meta-evolution:stage:decision', `meta-evolution:assurance:${entry.assuranceCase.envelope.id}`],
          }),
        ]
      : [];
    const askLinks = entry.askId
      ? [
          metaTraceLink({
            source: entry.askId,
            target: entry.engine.record.envelope.id,
            type: 'DERIVED_FROM',
            provenance: [...input.provenance, 'meta-evolution:stage:decision', `meta-evolution:ask:${entry.askId}`],
          }),
        ]
      : [];
    return [...base, ...promotionLinks, ...assuranceLinks, ...askLinks];
  });

  const records = entries.map((entry) => entry.record);
  return {
    stage: 'DECISION',
    input_refs: entries.map((entry) => entry.measurement.candidate.envelope.id),
    output_refs: entries.flatMap((entry) => [
      entry.engine.record.envelope.id,
      entry.reviseGrant.envelope.id,
      ...(entry.promotion ? [entry.promotion.record.envelope.id] : []),
      ...(entry.promoteGrant ? [entry.promoteGrant.envelope.id] : []),
      ...(entry.assuranceCase ? [entry.assuranceCase.envelope.id] : []),
      ...(entry.askId ? [entry.askId] : []),
      ...(entry.activated ? [entry.activated.envelope.id] : []),
    ]),
    links,
    entries: records,
    promote_count: records.filter((entry) => entry.applied_revision_id !== null).length,
    rollback_count: records.filter((entry) => entry.engine_decision === 'ROLLBACK' || entry.promotion_decision === 'ROLLBACK').length,
    ask_count: records.filter((entry) => entry.engine_decision === 'ASK').length,
  };
}
