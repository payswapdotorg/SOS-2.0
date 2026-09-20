/**
 * @sos-2/greenfield — the SOS 2.0 greenfield pipeline orchestrator
 * (Work Order W14, parallel slot B).
 *
 * Mission-only onboarding becomes an executable system realization with
 * semantic traceability and package reuse (spec/architecture.md section 15:
 * "Greenfield starts from mission... Both converge on System State";
 * requirements R6, R29):
 *
 *   1. mission formalization (@sos-2/mission)
 *   2. capability derivation + candidate composition at the highest
 *      validated altitude (@sos-2/search + @sos-2/retrieval +
 *      @sos-2/registry + @sos-2/composition + @sos-2/optimization)
 *   3. human decision flow (@sos-2/decision + @sos-2/ask + @sos-2/autonomy
 *      + @sos-2/authority)
 *   4. realization (@sos-2/system-state + @sos-2/architecture)
 *   5. reconciliation (@sos-2/conformance over the W0.5 spine classifier)
 *   6. evidence ingestion (@sos-2/evidence + @sos-2/telemetry)
 *
 * The TRACEABILITY INVARIANT: every stage-to-stage handoff is a typed
 * trace link and the full result is ONE connected semantic subgraph from
 * Mission to SystemState — queryable through the spine, machine-checked at
 * every stage boundary and over the final result (a missing link fails
 * the pipeline).
 *
 * The orchestrator is PURE and DETERMINISTIC (zero I/O, zero hidden
 * clocks, zero randomness — every identity is spine-minted and
 * content-addressed). It ORCHESTRATES the merged W0.5-W12 packages and
 * never redefines any of their vocabularies (the spine is the only
 * identity/envelope/kind authority; no second registry exists here).
 */

export { GreenfieldError } from './errors.js';

export {
  GREENFIELD_CAPABILITY_PATTERN,
  assertValidGreenfieldAskDecider,
  assertValidGreenfieldMissionInput,
  assertValidGreenfieldRealizationPlan,
  assertValidGreenfieldRiskProfile,
  assertValidGreenfieldRunContext,
  assertValidGreenfieldWorld,
} from './context.js';
export type {
  GreenfieldAskDecider,
  GreenfieldGoalInput,
  GreenfieldMeasureInput,
  GreenfieldMissionInput,
  GreenfieldRealizationPlan,
  GreenfieldRiskProfile,
  GreenfieldRunContext,
  GreenfieldWorld,
} from './context.js';

export {
  GREENFIELD_HANDOFF_LINKS,
  assertTraceChainComplete,
  canonicalLinkOrder,
  checkTraceChain,
  connectedComponent,
  deduplicateLinks,
  directedPath,
} from './trace.js';
export type { TraceChainCheck } from './trace.js';

export { runMissionStage } from './stages/mission.js';
export type { MissionStageInput, MissionStageRecord } from './stages/mission.js';

export {
  GREENFIELD_VALIDATED_ALTITUDES,
  assertCandidateOwnEvidence,
  deriveMemberRoles,
  runCandidateStage,
} from './stages/candidate.js';
export type { CandidateSearchEntry, CandidateStageInput, CandidateStageRecord } from './stages/candidate.js';

export { runDecisionStage } from './stages/decision.js';
export type { DecisionStageInput, DecisionStageRecord } from './stages/decision.js';

export {
  BINDING_EDGE_KINDS,
  assertRealizationRevision,
  runRealizationStage,
} from './stages/realization.js';
export type { RealizationStageInput, RealizationStageRecord } from './stages/realization.js';

export { runReconciliationStage } from './stages/reconciliation.js';
export type { ReconciliationStageInput, ReconciliationStageRecord } from './stages/reconciliation.js';

export { runEvidenceStage } from './stages/evidence.js';
export type { EvidenceStageInput, EvidenceStageRecord } from './stages/evidence.js';

export { runGreenfieldPipeline } from './pipeline.js';
export type {
  GreenfieldPipelineInput,
  GreenfieldPipelineResult,
  GreenfieldPipelineSummary,
  GreenfieldStageRecords,
} from './pipeline.js';
