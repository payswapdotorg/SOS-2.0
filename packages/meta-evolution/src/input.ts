/**
 * The meta-evolution loop input contract (W16): everything the deterministic
 * loop needs — the OBJECT side (the W15 brownfield golden fixture + variant
 * the separation stage probes), the META side (the mission, the initial
 * MetaProcess parameters, the meta-strategy package population in THE
 * injected registry, the typed change specs), the shared effectiveness
 * experiment spec (the frozen §11 axes), the authority specs (decision +
 * promotion grants), the learning stores the loop feeds, and the single
 * caller-supplied instant.
 *
 * The loop is PURE with respect to this input: identical input (fresh
 * stores) -> byte-identical result. No clocks, no network, no randomness
 * outside the fixed simulator seed.
 */

import type { BrownfieldFixtureJson, BrownfieldVariant } from '@sos-2/brownfield';
import type { MissionContent } from '@sos-2/mission';
import type { PackageRegistry } from '@sos-2/registry';
import type { ContextCondition } from '@sos-2/packages';
import type { TransferStore } from '@sos-2/transfer';
import type { MaturityReviewQueue } from '@sos-2/ecology';
import type { ArchitectureMemoryStore } from '@sos-2/memory';
import type { ArmMetricEffect, ExperimentMetric, RollbackCriterion, StoppingCriterion } from '@sos-2/experiments';
import type { DecaySignalKind } from '@sos-2/ecology';
import type { Producer } from '@sos-2/provenance';
import type { BlastRadius, ReversibilityClass } from '@sos-2/autonomy';
import type { AskRiskSeverity, UncertaintyStatement } from '@sos-2/authority';
import type { ImpactClass } from '@sos-2/decision';
import type { ObjectiveAxis } from '@sos-2/optimization';
import type { MetaProcessParameters, MetaProcessPatch } from './parameters.js';
import { MetaEvolutionError } from './errors.js';

/** One prior-evidence seed (subject binding done by the loop). */
export interface EvidenceSpec {
  kind: string;
  availability: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL';
  evidence_class: 'OBSERVATIONAL' | 'INTERVENTIONAL';
  method: string;
  provenance: string[];
}

/** One typed meta-change specification (the golden scenario's proposals). */
export interface MetaChangeSpec {
  /** Fixture-local key (stable, human-readable). */
  key: string;
  /** The meta-strategy package id this proposal derives from (resolved by the fixture builder). */
  package_id: string;
  /** The typed parameter patch (may carry foreign keys — the guard rejects them with typed records). */
  patch: MetaProcessPatch;
  /** Why the change is proposed (non-empty). */
  intent: string;
  /** Predicted effects (>= 1). */
  predicted_effects: string[];
  /** The causal hypothesis statement (drives the minted CausalHypothesis id). */
  hypothesis_statement: string;
  /** Autonomy/decision dimensions (frozen vocabularies from the merged authorities). */
  blast_radius: BlastRadius;
  impact: ImpactClass;
  risk: AskRiskSeverity;
  reversibility: ReversibilityClass;
  uncertainty: UncertaintyStatement;
  /** Predicted §11-axis values (the Pareto objectives; predictions, never observations). */
  predicted_estimates: Record<string, number>;
  /** Behavior descriptors for the quality-diversity repertoire (§11 axes). */
  behavior: Record<string, number>;
  /** Base proposal priority (finite; penalty-scaled by R19 failure memory). */
  fitness: number;
  /** Prior evidence about the PROCESS for the decision engine (subject = MetaProcess id). */
  decision_evidence: EvidenceSpec[];
  /** Prior evidence about the CANDIDATE for the promotion gate (subject = CandidateState id). */
  promotion_evidence: EvidenceSpec[];
  /** Effectiveness simulator effects (EXACTLY one per (arm, metric) pair). */
  effects: ArmMetricEffect[];
}

/** The shared effectiveness experiment spec (the frozen §11-axis measurement). */
export interface EffectivenessSpec {
  population_description: string;
  unit: 'REQUEST' | 'SESSION' | 'USER' | 'SERVICE_INSTANCE' | 'DEPLOYMENT';
  canary_ladder: number[];
  canary_exposure_percent: number;
  /** The §11-axis metrics (>= 1 PRIMARY, >= 1 GUARDRAIL). */
  metrics: ExperimentMetric[];
  stopping_criteria: StoppingCriterion[];
  rollback_criteria: RollbackCriterion[];
  seed: number;
  samples_per_arm: number;
  /** The Pareto objective axes (frozen §11 directions). */
  objective_axes: Array<{ axis: ObjectiveAxis; direction: 'MINIMIZE' | 'MAXIMIZE' }>;
  /** The quality-diversity behavior axes (>= 1 edge each). */
  repertoire_edges: Record<string, number[]>;
}

/** The authority specs (grants minted by the loop through @sos-2/authority). */
export interface MetaAuthoritySpec {
  /** The REVISE grant over the MetaProcess kind (the decision lane). */
  decision: { grantee: string; permissions: string[]; expires_at: string };
  /** The PROMOTE grant over the CandidateState kind (the promotion lane). */
  promotion: { grantee: string; permissions: string[]; expires_at: string };
}

/** The liability-memory spec. */
export interface MetaLearningSpec {
  transfer_target_context: ContextCondition;
  decay_signal: { kind: DecaySignalKind; note: string };
  failure_rule: string;
  rollback_rule: string;
}

/** The injected learning stores (fresh per run). */
export interface MetaLearningStores {
  transfer: TransferStore;
  reviewQueue: MaturityReviewQueue;
  memory: ArchitectureMemoryStore;
}

/** The complete, deterministic meta-evolution loop input. */
export interface MetaEvolutionInput {
  /** The OBJECT side: the W15 brownfield golden fixture + probe variant. */
  object: { fixture: BrownfieldFixtureJson; variant: BrownfieldVariant };
  /** The META side: the self-improvement mission content. */
  mission: { content: MissionContent };
  /** The initial MetaProcess parameters + note. */
  process: { parameters: MetaProcessParameters; notes: string };
  /** The context conditioning meta-strategy package retrieval (R26). */
  meta_context: ContextCondition;
  /** THE injected package registry (meta-strategy packages seeded by the fixture builder). */
  registry: PackageRegistry;
  /** The typed meta-change specifications (fixture order = processing order). */
  changes: MetaChangeSpec[];
  /** The shared effectiveness experiment spec. */
  effectiveness: EffectivenessSpec;
  /** The authority specs. */
  authority: MetaAuthoritySpec;
  /** The liability-memory spec. */
  learning: MetaLearningSpec;
  /** The injected learning stores (fresh per run). */
  stores: MetaLearningStores;
  /** The single RFC3339 instant stamped on every artifact of the loop. */
  now: string;
  /** The loop producer (WHO/WHAT ran the loop; non-LLM for calibrated paths). */
  producer: Producer;
  /** Loop provenance prefix (non-empty; stamped on every minted artifact). */
  provenance: string[];
  /** Optional authority anchor stamped on minted envelopes (or null). */
  authority_ref: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the loop input (throws MetaEvolutionError). */
export function assertValidMetaEvolutionInput(value: unknown): asserts value is MetaEvolutionInput {
  if (!isPlainObject(value)) {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'loop input must be an object');
  }
  const input = value as Record<string, unknown>;
  const required = [
    'object',
    'mission',
    'process',
    'meta_context',
    'registry',
    'changes',
    'effectiveness',
    'authority',
    'learning',
    'stores',
    'now',
    'producer',
    'provenance',
  ] as const;
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      throw new MetaEvolutionError('INVALID_META_INPUT', `loop input is missing the required field "${field}"`);
    }
  }
  if (!Array.isArray(input['changes']) || (input['changes'] as unknown[]).length === 0) {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'loop input changes must be a non-empty array');
  }
  if (!Array.isArray(input['provenance']) || (input['provenance'] as string[]).length === 0) {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'loop input provenance must be a non-empty array');
  }
  if (typeof input['now'] !== 'string' || input['now'].length === 0) {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'loop input now must be a non-empty RFC3339 timestamp');
  }
  const effectiveness = input['effectiveness'];
  if (!isPlainObject(effectiveness) || typeof (effectiveness as Record<string, unknown>)['seed'] !== 'number') {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'loop input effectiveness must carry a fixed simulator seed');
  }
}
