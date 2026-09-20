/**
 * Meta-evolution stage records — the TYPED, pure-JSON record of every stage
 * of the loop (W16). Each record carries its stage kind, its input/output
 * spine artifact refs and the typed trace links it minted: every stage
 * handoff is a typed trace link, and the records are the queryable
 * projection of the loop. All vocabularies (trace types, truth states,
 * decision actions, altitudes, guard codes...) are imported from their
 * merged authorities — never redefined here.
 */

import type { TraceLink, EvidenceTruthState } from '@sos-2/semantic-spine';
import type { RetrievalAltitude } from '@sos-2/registry';
import type { ObjectiveAxis } from '@sos-2/optimization';
import type { DecisionAction } from '@sos-2/authority';
import type { GuardrailStatus, TriggerRecord } from '@sos-2/experiments';
import type { BoundedRecoveryDeclaration } from '@sos-2/promotion';
import type { GuardRejection, GuardVerdict } from './guard.js';
import type { RoutingRejection, RoutingVerdict } from './routing.js';
import type { MetaProcessParameters } from './parameters.js';

/** The seven meta-evolution stages, in canonical pipeline order. */
export const META_EVOLUTION_STAGES = [
  'SEPARATION',
  'PROPOSAL',
  'GUARD',
  'EFFECTIVENESS',
  'DECISION',
  'ROLLBACK',
  'LIABILITY',
] as const;

export type MetaEvolutionStage = (typeof META_EVOLUTION_STAGES)[number];

/** Fields shared by every stage record. */
export interface MetaStageRecordBase {
  stage: MetaEvolutionStage;
  /** Spine artifact ids consumed by the stage. */
  input_refs: string[];
  /** Spine artifact ids produced by the stage. */
  output_refs: string[];
  /** Typed trace links minted by the stage (the stage handoffs). */
  links: TraceLink[];
}

/** Stage 1 — OBJECT/META SEPARATION (the structural invariant). */
export interface SeparationStageRecord extends MetaStageRecordBase {
  stage: 'SEPARATION';
  /** The OBJECT loop probe over the golden W15 fixtures (real brownfield run). */
  object_probe: {
    variant: string;
    system_name: string;
    implementation_model_id: string;
    candidate_state_id: string;
    decision: string;
    chain_complete: boolean;
    trace_links: number;
  };
  /** The META anchor (the initial MetaProcess revision id). */
  meta_anchor: string;
  /** The constraining Mission artifact id. */
  mission_id: string;
  /** The object-system health evidence (telemetry-ingested, OBSERVES the ImplementationModel). */
  object_evidence_id: string;
  /** Lane probes: each direction of the object/meta conflation check, retained verbatim. */
  lane_probes: Array<{
    lane: 'OBJECT' | 'META';
    artifact_id: string;
    accepted: boolean;
    rejection: RoutingRejection | null;
  }>;
  /** Counts of typed conflation rejections (both directions demonstrated). */
  conflation_rejections: number;
}

/** Stage 2 — META-PROPOSAL (registry-driven, Pareto + quality-diversity ranked). */
export interface ProposalStageRecord extends MetaStageRecordBase {
  stage: 'PROPOSAL';
  retrieval: {
    candidate_count: number;
    families: string[];
    altitudes_present: RetrievalAltitude[];
    matched_count: number;
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
  /** One entry per proposal (ranked; penalty-scaled by R19 failure memory). */
  proposals: Array<{
    change_id: string;
    package_id: string;
    family: string;
    key: string;
    pareto_rank: number;
    cell: number[];
    failure_count: number;
    weight: number;
    proposal_probability: number;
  }>;
}

/** Stage 3 — GOVERNANCE GUARD (non-disableable). */
export interface GuardStageRecord extends MetaStageRecordBase {
  stage: 'GUARD';
  verdicts: Array<{
    change_id: string;
    passed: boolean;
    rejection: GuardRejection | null;
  }>;
  passed_count: number;
  rejected_count: number;
  /** The guard rejection evidence ids (one FAILURE record per rejection, OBSERVES the change). */
  rejection_evidence_ids: string[];
}

/** Stage 4 — ADAPTATION EFFECTIVENESS (simulated before/after on the §11 axes). */
export interface EffectivenessStageRecord extends MetaStageRecordBase {
  stage: 'EFFECTIVENESS';
  measurements: Array<{
    change_id: string;
    candidate_id: string;
    trial_revision_id: string;
    experiment_id: string;
    result_id: string;
    /** ALWAYS true — simulated outcomes are marked, never intervention evidence. */
    simulated: true;
    seed: number;
    /** Before = control (current process), after = treatment (trial parameters). */
    before: Record<string, number>;
    after: Record<string, number>;
    deltas: Record<string, number>;
    guardrails: Array<{ metric_id: string; arm_id: string; status: GuardrailStatus }>;
    rollback_triggers_fired: number;
    overall_availability: EvidenceTruthState;
    /** True iff no rollback trigger fired and the overall availability is SUCCESS/PARTIAL-clean. */
    effective: boolean;
  }>;
}

/** Stage 5 — DECISION + PROMOTION (authority-aware; ASK first-class). */
export interface DecisionStageRecord extends MetaStageRecordBase {
  stage: 'DECISION';
  entries: Array<{
    change_id: string;
    candidate_id: string;
    engine_decision: DecisionAction;
    engine_record_id: string;
    escalation_code: string | null;
    promotion_decision: DecisionAction | null;
    promotion_record_id: string | null;
    authority_grant_id: string | null;
    recovery: BoundedRecoveryDeclaration | null;
    ask_id: string | null;
    ask_queue_pending: boolean;
    applied_revision_id: string | null;
  }>;
  promote_count: number;
  rollback_count: number;
  ask_count: number;
}

/** Stage 6 — ROLLBACK (recovery declaration + EXACT restore). */
export interface RollbackStageRecord extends MetaStageRecordBase {
  stage: 'ROLLBACK';
  rollbacks: Array<{
    change_id: string;
    trial_revision_id: string;
    restore_revision_id: string;
    from_revision: string;
    to_revision: string;
    recovery: BoundedRecoveryDeclaration;
    restored_parameters: MetaProcessParameters;
    restored_to_digest: string;
    restore_exact: true;
  }>;
}

/** Stage 7 — LIABILITY MEMORY (failures retained forever; R19 penalty). */
export interface LiabilityStageRecord extends MetaStageRecordBase {
  stage: 'LIABILITY';
  failures: Array<{
    change_id: string;
    package_id: string;
    memory_artifact_id: string;
    memory_entry_ids: string[];
    transfer_outcome: 'TRANSFER_FAILURE';
    transfer_record_id: string;
    decay_signal_id: string;
    failure_count: number;
    weight_before: number;
    weight_after: number;
    probability_before: number;
    probability_after: number;
  }>;
  /** The retained memory entry kinds (FAILURE/ROLLBACK/LIABILITY/LEARNED_RULE — never deleted). */
  memory_entry_kinds: string[];
}

/** The typed per-stage records of one meta-evolution loop run. */
export interface MetaEvolutionStageRecords {
  separation: SeparationStageRecord;
  proposal: ProposalStageRecord;
  guard: GuardStageRecord;
  effectiveness: EffectivenessStageRecord;
  decision: DecisionStageRecord;
  rollback: RollbackStageRecord;
  liability: LiabilityStageRecord;
}

/** Re-exported for the record types above (typed verdict use in tests). */
export type { GuardVerdict, RoutingVerdict };
