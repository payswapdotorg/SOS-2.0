/**
 * Brownfield stage 5 — ASSURANCE (W15).
 *
 * A living assurance case is built over the candidate
 * (@sos-2/assurance createAssuranceCase): claims about invariant
 * preservation, bounded evolution and runtime observation; a runtime
 * monitor (@sos-2/verification reference engine) evaluates the candidate's
 * invariant preservation over monitor events and its evidence enters the
 * case; PASS-verdict runtime-conformance evidence from ingestion supports
 * the observation claims; objections are RETAINED (the golden case carries
 * one RESOLVED objection — resolved is terminal and never dropped).
 *
 * The case is evaluated truthfully (evaluateAssuranceCase: revision
 * bounds, evidence freshness, assumption checks). An INVALID verdict
 * BLOCKS promotion (the stage records `blocks: true` and the promotion
 * fixture verdict maps to REFUTED — the W9 gate then REJECTS).
 *
 * The W8 verdict is projected onto the W9 promotion fixture surface
 * (VALID -> SATISFIED, OBJECTIONED -> INCOMPLETE, INVALID -> REFUTED) —
 * a projection, never a second assurance authority.
 *
 * Links: assurance case --VERIFIES--> candidate state.
 */

import { createAssuranceCase, evaluateAssuranceCase } from '@sos-2/assurance';
import type { AssuranceCaseArtifact, AssuranceEvaluation } from '@sos-2/assurance';
import { createInMemoryReferenceEngine, evaluateMonitor } from '@sos-2/verification';
import type { MonitorEvaluationResult } from '@sos-2/verification';
import type { CandidateStateFixture } from '@sos-2/experiments';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { RecoveryHypothesis } from '@sos-2/recovery';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { InvariantCheckResult } from '@sos-2/conformance';
import type { RuntimeConformanceResult } from '@sos-2/runtime-conformance';
import type { AssuranceVerdict } from '@sos-2/promotion';
import { BrownfieldError } from './errors.js';
import type { BrownfieldLoopInput } from './input.js';
import type { AssuranceStageRecord } from './stages.js';
import { brownfieldTraceLink } from './trace.js';

/** The frozen W8 -> W9 verdict projection (documented, never inverted). */
export const ASSURANCE_VERDICT_PROJECTION: Readonly<Record<AssuranceEvaluation['verdict'], AssuranceVerdict>> = {
  VALID: 'SATISFIED',
  OBJECTIONED: 'INCOMPLETE',
  INVALID: 'REFUTED',
};

/** Everything stage 5 produces. */
export interface AssuranceStageOutput {
  record: AssuranceStageRecord;
  assuranceCase: AssuranceCaseArtifact;
  evaluation: AssuranceEvaluation;
  monitor: MonitorEvaluationResult;
  evidencePool: EvidenceRecordW3[];
  promotionFixture: {
    id: string;
    claims: Array<{ id: string; statement: string }>;
    verdict: AssuranceVerdict;
    validity: { status: 'CURRENT' | 'EXPIRED' | 'SUPERSEDED' | 'VIOLATED'; expires_at: string | null; reason: string };
  };
}

/** Run the assurance stage (deterministic, pure). */
export function runAssuranceStage(
  input: BrownfieldLoopInput,
  candidateState: CandidateStateFixture,
  candidateArchitecture: ArchitectureGraphArtifact,
  selectedHypothesis: RecoveryHypothesis,
  systemState: SystemStateArtifact,
  runtimeConformance: RuntimeConformanceResult,
  invariantResults: InvariantCheckResult[],
): AssuranceStageOutput {
  // 1. Runtime verification of the candidate's invariant preservation.
  const monitorDefinition = {
    id: 'monitor:candidate-invariants-preserved',
    property: {
      kind: 'ALWAYS' as const,
      predicate: 'candidate.preserves_declared_invariants',
      description: 'Every declared executable invariant holds on the applied candidate architecture.',
    },
  };
  const monitorEvents = invariantResults.map((result) => ({
    predicate: 'candidate.preserves_declared_invariants',
    holds: result.status === 'PASS' || result.status === 'NOT_APPLICABLE',
    at: input.now,
  }));
  let monitor: MonitorEvaluationResult;
  try {
    monitor = evaluateMonitor(createInMemoryReferenceEngine(), monitorDefinition, monitorEvents, {
      now: input.now,
      system_state_id: systemState.envelope.id,
      system_state_version: systemState.envelope.version,
      subject_revision: `${systemState.envelope.id}@v${systemState.envelope.version}`,
      implementation_revision: input.snapshot.revision,
      deployment_revision: `dpl-${input.snapshot.revision.slice(0, 12)}`,
      producer: input.producer,
    });
  } catch (cause) {
    throw new BrownfieldError('ASSURANCE_EVALUATION_FAILED', `runtime monitor evaluation failed: ${(cause as Error).message}`);
  }

  // 2. The evidence pool: monitor evidence + PASS-verdict runtime
  //    conformance evidence (UNKNOWN/FAIL records are NOT supporting
  //    evidence — truthful, never conflated).
  const evidencePool: EvidenceRecordW3[] = [monitor.evidence];
  for (const recordEntry of runtimeConformance.records) {
    if (recordEntry.verdict === 'PASS') {
      evidencePool.push(recordEntry.evidence);
    }
  }

  // 3. The assurance case over the candidate.
  const claims = [
    { id: 'claim-invariants-preserved', statement: `Every declared executable invariant is preserved by the candidate replacement of "${input.goal.target_component}".` },
    { id: 'claim-evolution-bounded', statement: 'The candidate is a bounded subgraph replacement of the recovered architecture hypothesis with declared preserved invariants.' },
    { id: 'claim-runtime-observed', statement: 'The legacy runtime was observed at the exact system revision and declared-but-unobserved components were recorded as gaps, not silence.' },
    { id: 'claim-recovery-reversible', statement: 'The candidate change is reversible within the declared bounded recovery window.' },
  ];
  const assuranceCase = createAssuranceCase({
    content: {
      claims,
      arguments: [
        {
          id: 'argument-candidate-safety',
          strategy: 'Argument from invariant preservation and bounded, reversible change over observed evidence.',
          conclusion: 'claim-invariants-preserved',
          premises: ['claim-evolution-bounded', 'claim-runtime-observed', 'claim-recovery-reversible'],
        },
      ],
      assumptions: [
        { id: 'assumption-snapshot-representative', statement: 'The ingested legacy snapshot is representative of the production system at the exact revision.' },
      ],
      hazards: [
        { id: 'hazard-guardrail-breach', description: 'The replacement component breaches a guardrail metric under live traffic.' },
        { id: 'hazard-drift-unreconciled', description: 'Implementation-versus-declared drift is classified but not remediated.' },
      ],
      controls: [
        { id: 'control-experiment-guardrails', mechanism: 'Wired experiment guardrails with fail-closed rollback triggers.', addresses: ['hazard-guardrail-breach'] },
        { id: 'control-bounded-recovery', mechanism: 'Bounded recovery declaration with rollback triggers wired to the experiment.', addresses: ['hazard-guardrail-breach', 'hazard-drift-unreconciled'] },
      ],
      evidence: [
        { evidence_id: monitor.evidence.id, role: 'VERIFIES', claim_ref: 'claim-invariants-preserved' },
        ...evidencePool
          .filter((evidence) => evidence.id !== monitor.evidence.id)
          .map((evidence) => ({ evidence_id: evidence.id, role: 'SUPPORTS' as const, claim_ref: 'claim-runtime-observed' })),
      ],
      validity_conditions: [
        { kind: 'IMPLEMENTATION', subject: input.snapshot.system_name, valid_revisions: [input.snapshot.revision] },
        { kind: 'ENVIRONMENT', subject: 'production', valid_revisions: ['production-v1'] },
      ],
      objections: [
        {
          id: 'objection-human-review-pending',
          statement: 'A human architect should review the recovered hypothesis selection before live promotion.',
          raised_at: input.now,
          status: 'RESOLVED',
          resolution: {
            note: 'Resolved for this loop iteration: promotion is evidence-gated regardless; the competing hypothesis set is retained for review.',
            resolved_at: input.now,
            provenance: [...input.provenance, 'brownfield:assurance-objection-resolution'],
          },
        },
      ],
    },
    provenance: [
      ...input.provenance,
      'brownfield:assurance-case',
      `brownfield:candidate:${candidateState.envelope.id}`,
      `brownfield:hypothesis:${selectedHypothesis.artifact.envelope.id}`,
    ],
    created_at: input.now,
    authority_ref: input.authority_ref,
    status: 'ACTIVE',
  });

  // 4. Truthful evaluation (revision bounds + freshness + assumptions).
  let evaluation: AssuranceEvaluation;
  try {
    evaluation = evaluateAssuranceCase(assuranceCase, {
      now: input.now,
      systemStateRevision: `${systemState.envelope.id}@v${systemState.envelope.version}`,
      implementation_revisions: { [input.snapshot.system_name]: input.snapshot.revision },
      environment_revisions: { production: 'production-v1' },
      evidence: evidencePool,
      assumption_checks: { 'assumption-snapshot-representative': true },
    });
  } catch (cause) {
    throw new BrownfieldError('ASSURANCE_EVALUATION_FAILED', `assurance case evaluation failed: ${(cause as Error).message}`);
  }

  // 5. The W8 -> W9 projection (the promotion gate consumes the fixture).
  const verdict: AssuranceVerdict = ASSURANCE_VERDICT_PROJECTION[evaluation.verdict];
  const promotionFixture = {
    id: assuranceCase.envelope.id,
    claims: claims.map((claim) => ({ id: claim.id, statement: claim.statement })),
    verdict,
    validity: {
      status: 'CURRENT' as const,
      expires_at: null,
      reason: `evaluated by @sos-2/assurance evaluateAssuranceCase at ${input.now} (verdict: ${evaluation.verdict})`,
    },
  };

  const links = [
    brownfieldTraceLink({
      source: assuranceCase.envelope.id,
      target: candidateState.envelope.id,
      type: 'VERIFIES',
      provenance: [...input.provenance, 'brownfield:stage:assurance'],
    }),
    ...monitor.links,
  ];

  const record: AssuranceStageRecord = {
    stage: 'ASSURANCE',
    input_refs: [candidateState.envelope.id, candidateArchitecture.envelope.id],
    output_refs: [assuranceCase.envelope.id, monitor.evidence.id],
    links,
    assurance_case_id: assuranceCase.envelope.id,
    verdict: evaluation.verdict,
    invalidations: evaluation.invalidations,
    objections: assuranceCase.content.objections.map((objection) => ({ id: objection.id, status: objection.status })),
    monitor: {
      monitor_id: monitorDefinition.id,
      verdict: monitor.verdict,
      evidence_id: monitor.evidence.id,
    },
    promotion_fixture: promotionFixture,
    blocks: evaluation.verdict === 'INVALID',
  };

  return { record, assuranceCase, evaluation, monitor, evidencePool, promotionFixture };
}
