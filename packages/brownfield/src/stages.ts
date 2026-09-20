/**
 * Brownfield stage records — the TYPED, pure-JSON record of every stage of
 * the loop (W15). Each record carries its stage kind, its input/output
 * spine artifact refs and the typed trace links it minted: every stage
 * handoff is a typed trace link, and the records are the queryable
 * projection of the loop (the harness and console surface these directly).
 *
 * All vocabularies (trace types, truth states, conformance classes,
 * decision actions, altitudes, uncertainty classes...) are imported from
 * their merged authorities — never redefined here.
 */

import type { AmbiguityMarker, RecoveryStrategy } from '@sos-2/recovery';
import type { CandidateUncertainty } from '@sos-2/registry';
import type { RetrievalAltitude } from '@sos-2/registry';
import type { LadderStep } from '@sos-2/search';
import type { CarriedUncertainty, ObjectiveAxis } from '@sos-2/optimization';
import type { Invariant } from '@sos-2/conformance';
import type { ConformanceClass } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import type { TriggerRecord } from '@sos-2/experiments';
import type { DecisionAction } from '@sos-2/authority';
import type { BoundedRecoveryDeclaration } from '@sos-2/promotion';
import type { AssuranceEvaluation } from '@sos-2/assurance';
import type { AssuranceVerdict, AssuranceValidity } from '@sos-2/promotion';
import type { ContextQuery } from '@sos-2/retrieval';
import type { EvolutionOperation, GraphDiff, EdgeKey } from '@sos-2/architecture';
import type { LocalCandidate } from '@sos-2/architecture';

/** The nine brownfield stages, in canonical pipeline order. */
export const BROWNFIELD_STAGES = [
  'INGESTION',
  'RECOVERY',
  'RETRIEVAL',
  'EVOLUTION',
  'ASSURANCE',
  'EXPERIMENT',
  'PROMOTION',
  'RECONCILIATION',
  'LEARNING',
] as const;

export type BrownfieldStage = (typeof BROWNFIELD_STAGES)[number];

/** Fields shared by every stage record. */
export interface StageRecordBase {
  stage: BrownfieldStage;
  /** Spine artifact ids consumed by the stage. */
  input_refs: string[];
  /** Spine artifact ids produced by the stage. */
  output_refs: string[];
  /** Typed trace links minted by the stage (the stage handoffs). */
  links: TraceLink[];
}

/** Stage 1 — repository/runtime ingestion. */
export interface IngestionStageRecord extends StageRecordBase {
  stage: 'INGESTION';
  system_name: string;
  source_revision: string;
  system_state_id: string;
  declared_architecture_id: string;
  implementation_model_id: string;
  ingestion_evidence_id: string;
  module_count: number;
  dependency_count: number;
  interface_count: number;
  runtime_observation_count: number;
  telemetry: {
    ingested: number;
    spans: number;
    metrics: number;
    logs: number;
    gaps: number;
    digest: string;
  };
  runtime_conformance: {
    verdicts: Record<'PASS' | 'FAIL' | 'UNKNOWN', number>;
    evidence_ids: string[];
  };
}

/** Stage 2 — COMPETING architecture recovery (never one under ambiguity). */
export interface RecoveryStageRecord extends StageRecordBase {
  stage: 'RECOVERY';
  hypothesis_ids: string[];
  hypothesis_count: number;
  ambiguity_detected: boolean;
  strategies: RecoveryStrategy[];
  markers: AmbiguityMarker[];
  selected_hypothesis_id: string;
  selection_rule: string;
  /** True iff ambiguity was detected AND >= 2 hypotheses were retained. */
  competing: boolean;
}

/** Stage 3 — context-conditioned package retrieval (uncertainty surfaced). */
export interface RetrievalStageRecord extends StageRecordBase {
  stage: 'RETRIEVAL';
  query: ContextQuery;
  candidate_count: number;
  families: string[];
  altitudes_present: RetrievalAltitude[];
  matched_count: number;
  retrieval_evidence_id: string;
  /** One surfaced entry per candidate (uncertainty VERBATIM, never stripped). */
  candidates: Array<{
    id: string;
    kind: 'PACKAGE' | 'COMPOSITION';
    family: string;
    altitude: RetrievalAltitude;
    context_match: 'MATCHED' | 'UNMATCHED' | 'NO_QUERY_CONTEXT';
    uncertainty: CandidateUncertainty;
  }>;
}

/** Stage 4 — bounded, invariant-preserving candidate evolution. */
export interface EvolutionStageRecord extends StageRecordBase {
  stage: 'EVOLUTION';
  search: {
    engine: string;
    final_altitude: RetrievalAltitude | null;
    ladder: LadderStep[];
    candidate_count: number;
    families: string[];
  };
  pareto: {
    fronts: number;
    front_zero: string[];
    axes: ObjectiveAxis[];
  };
  repertoire: {
    dimensions: Array<{ axis: string; edges: number[] }>;
    cells: number;
    families: string[];
  };
  selected_candidate_id: string;
  selected_package_id: string;
  selected_family: string;
  selection_rule: string;
  local_candidate: LocalCandidate;
  bounded: { nodes: string[]; edges: EdgeKey[] };
  replacement: EvolutionOperation[];
  applied: {
    node_count: number;
    edge_count: number;
    diff_size: number;
    diff: GraphDiff;
  };
  invariant_results: Array<{ invariant: Invariant; status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE' }>;
  candidate_state_id: string;
  candidate_architecture_id: string;
  carried_uncertainty: CarriedUncertainty;
}

/** Stage 5 — assurance case evaluation (objections retained; invalid blocks). */
export interface AssuranceStageRecord extends StageRecordBase {
  stage: 'ASSURANCE';
  assurance_case_id: string;
  verdict: AssuranceEvaluation['verdict'];
  invalidations: AssuranceEvaluation['invalidations'];
  /** Objections RETAINED in the case (open and resolved — never dropped). */
  objections: Array<{ id: string; status: 'OPEN' | 'RESOLVED' }>;
  monitor: {
    monitor_id: string;
    verdict: 'SATISFIED' | 'VIOLATED' | 'INCONCLUSIVE';
    evidence_id: string;
  };
  /** The promotion-gate fixture view of the case (W8 verdict -> W9 surface). */
  promotion_fixture: {
    id: string;
    claims: Array<{ id: string; statement: string }>;
    verdict: AssuranceVerdict;
    validity: AssuranceValidity;
  };
  /** True iff the verdict is INVALID — an invalid case BLOCKS promotion. */
  blocks: boolean;
}

/** Stage 6 — deterministic SIMULATED experiment (never intervention evidence). */
export interface ExperimentStageRecord extends StageRecordBase {
  stage: 'EXPERIMENT';
  experiment_id: string;
  result_id: string;
  /** ALWAYS true in this loop — simulated outcomes are marked, never hidden. */
  simulated: true;
  seed: number;
  samples_per_arm: number;
  lifecycle: Array<{ phase: 'SHADOW' | 'CANARY' | 'CONTROLLED_EXPERIMENT'; exposure_percent: number }>;
  overall_availability: EvidenceTruthState;
  guardrails: Array<{ metric_id: string; arm_id: string; status: 'SATISFIED' | 'BREACHED' | 'NOT_ESTABLISHED' }>;
  rollback_triggers: TriggerRecord[];
  stopping_triggers: TriggerRecord[];
}

/** Stage 7 — evidence-gated promotion/rollback with bounded recovery. */
export interface PromotionStageRecord extends StageRecordBase {
  stage: 'PROMOTION';
  decision: DecisionAction;
  reasons: string[];
  decision_artifact_id: string;
  authority_grant_id: string;
  guardrails_tripped: boolean;
  /** The bounded recovery declaration (recovery-control shape). REQUIRED on ROLLBACK. */
  recovery: BoundedRecoveryDeclaration | null;
}

/** Stage 8 — implementation vs declared drift reconciliation. */
export interface ReconciliationStageRecord extends StageRecordBase {
  stage: 'RECONCILIATION';
  declared_architecture_id: string;
  implementation_model_id: string;
  /** Zero-filled counts for ALL 7 frozen conformance classes. */
  classifications: Record<ConformanceClass, number>;
  findings: Array<{ classification: ConformanceClass; subject: string; reason: string }>;
  drift_evidence_ids: string[];
}

/** Stage 9 — package learning (transfer evidence, decay signals, failure memory). */
export interface LearningStageRecord extends StageRecordBase {
  stage: 'LEARNING';
  outcome_evidence_id: string;
  outcome_availability: EvidenceTruthState;
  decision: DecisionAction;
  memory_artifact_id: string;
  memory_entries: Array<{ id: string; entry_kind: string }>;
  transfer_record_id: string;
  transfer_outcome: 'TRANSFER_SUCCESS' | 'TRANSFER_FAILURE' | 'TRANSFER_INCONCLUSIVE';
  transfer_source_ref: string;
  decay_signal_ids: string[];
  decay_kinds: string[];
  /** The package ids whose ecology was updated (chain endpoints). */
  ecology_package_ids: string[];
}

/** The typed per-stage records of one brownfield loop run. */
export interface BrownfieldStageRecords {
  ingestion: IngestionStageRecord;
  recovery: RecoveryStageRecord;
  retrieval: RetrievalStageRecord;
  evolution: EvolutionStageRecord;
  assurance: AssuranceStageRecord;
  experiment: ExperimentStageRecord;
  promotion: PromotionStageRecord;
  reconciliation: ReconciliationStageRecord;
  learning: LearningStageRecord;
}
