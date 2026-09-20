/**
 * Brownfield loop input contract (W15). Everything the deterministic loop
 * needs: the existing-system snapshot, the declared architecture (the
 * "as-documented" legacy architecture), executable invariants, the injected
 * package population (@sos-2/registry — THE registry, never duplicated),
 * the optimization goal, the fixed-seed experiment specification, the
 * authority specification, and the learning stores the loop feeds
 * (@sos-2/transfer / @sos-2/ecology / @sos-2/memory).
 *
 * The loop is PURE with respect to this input: identical input (fresh
 * stores) -> byte-identical result. No clocks (single caller-supplied
 * `now`), no network, no randomness outside the fixed seed.
 */

import type { BuildEdgeInput, BuildNodeInput } from '@sos-2/architecture';
import type { HardConstraintView } from '@sos-2/search';
import type { Invariant } from '@sos-2/conformance';
import type { ObjectiveAxis } from '@sos-2/optimization';
import type { PackageRegistry } from '@sos-2/registry';
import type { ContextCondition } from '@sos-2/packages';

import type { Producer } from '@sos-2/provenance';
import type { ArmMetricEffect } from '@sos-2/experiments';
import type { ExperimentMetric, RollbackCriterion, StoppingCriterion } from '@sos-2/experiments';
import type { DecaySignalKind } from '@sos-2/ecology';
import type { TransferStore } from '@sos-2/transfer';
import type { MaturityReviewQueue } from '@sos-2/ecology';
import type { ArchitectureMemoryStore } from '@sos-2/memory';
import type { BrownfieldSnapshot } from './snapshot.js';
import { BrownfieldError } from './errors.js';

/** The declared architecture of the legacy system (the "as-documented" view). */
export interface BrownfieldDeclaredArchitecture {
  nodes: BuildNodeInput[];
  edges: BuildEdgeInput[];
  provenance: string[];
  created_at: string;
}

/** One objective axis of the multi-objective candidate evaluation. */
export interface BrownfieldObjective {
  axis: ObjectiveAxis;
  direction: 'MINIMIZE' | 'MAXIMIZE';
}

/** The optimization goal: what the brownfield loop evolves TOWARD. */
export interface BrownfieldGoal {
  /** Retrieval capability query (the reusable capability sought). */
  capability: string;
  /** Query context conditioning retrieval (R26). */
  query_context: ContextCondition;
  /** Mission-shaped hard constraint views (bounded ones machine-checked). */
  constraints: HardConstraintView[];
  /** Non-empty mission view source id for the constraint set. */
  mission_ref: string;
  /** Objective axes for the Pareto/quality-diversity evaluation. */
  objective_axes: BrownfieldObjective[];
  /**
   * Caller-declared PREDICTED estimates per candidate/package id
   * (axis -> finite value) — predictions, never observations.
   */
  predicted_estimates: Record<string, Record<string, number>>;
  /** MAP-Elites behavior-descriptor edges per axis (>= 1 edge each). */
  repertoire_edges: Record<string, number[]>;
  /** The axis used for per-cell elite fitness (with its direction). */
  fitness_axis: BrownfieldObjective;
  /** The component of the recovered hypothesis to be replaced. */
  target_component: string;
  /** The id of the replacement component (must be NEW in the hypothesis). */
  replacement_id: string;
  /** The node kind of the replacement component. */
  replacement_kind: string;
  /** The causal hypothesis statement (drives the minted hypothesis id). */
  hypothesis_statement: string;
  /** Predicted effects of the replacement (>= 1 — the candidate is causal). */
  predicted_effects: string[];
}

/** The fixed-seed experiment specification (deterministic simulation). */
export interface BrownfieldExperimentSpec {
  /** Population description. */
  population_description: string;
  /** Allocation unit (REQUEST/SESSION/...). */
  unit: 'REQUEST' | 'SESSION' | 'USER' | 'SERVICE_INSTANCE' | 'DEPLOYMENT';
  /** Canary exposure ladder (ints strictly in (0,100), increasing). */
  canary_ladder: number[];
  /** The canary exposure percent to advance through. */
  canary_exposure_percent: number;
  /** Metrics (>= 1 PRIMARY, >= 1 GUARDRAIL). */
  metrics: ExperimentMetric[];
  /** Stopping criteria (>= 1). */
  stopping_criteria: StoppingCriterion[];
  /** Rollback criteria wired to guardrail metric ids (>= 1). */
  rollback_criteria: RollbackCriterion[];
  /** The fixed simulator seed (identical seed + input -> bit-identical results). */
  seed: number;
  /** Simulated allocation units per arm (positive integer). */
  samples_per_arm: number;
  /** Declared effect parameters — EXACTLY one per (arm, metric) pair. */
  effects: ArmMetricEffect[];
}

/** The authority specification (the promotion grant minted by the loop). */
export interface BrownfieldAuthoritySpec {
  /** Who is granted promotion authority for the candidate kind. */
  grantee: string;
  /** Grant permissions (must include PROMOTE for the gate to pass). */
  permissions: string[];
  /** RFC3339 expiry instant of the TIME-bound grant (must be > loop `now`). */
  expires_at: string;
}

/** Which package a learning update anchors to. */
export interface BrownfieldDecaySignalSpec {
  /** 'selected' (the package the candidate was derived from) or a fixture package key. */
  package_key: string;
  /** The decay signal kind (closed vocabulary from @sos-2/ecology). */
  kind: DecaySignalKind;
  /** Why the signal is recorded (non-empty). */
  note: string;
}

/** The package-learning specification. */
export interface BrownfieldLearningSpec {
  /** The target context of the transfer (the brownfield system context). */
  transfer_target_context: ContextCondition;
  /** Decay/obsolescence signals feeding the maturity review queue. */
  decay_signals: BrownfieldDecaySignalSpec[];
  /** Fixture package keys -> registered package ids (anchors for learning). */
  package_ids: Record<string, string>;
  /** The LEARNED_RULE statement recorded on a nominal outcome. */
  nominal_rule: string;
  /** The LEARNED_RULE statement recorded on a rollback outcome. */
  rollback_rule: string;
}

/** The injected learning stores the loop feeds (fresh per run). */
export interface BrownfieldLearningStores {
  transfer: TransferStore;
  reviewQueue: MaturityReviewQueue;
  memory: ArchitectureMemoryStore;
}

/** The complete, deterministic brownfield loop input. */
export interface BrownfieldLoopInput {
  snapshot: BrownfieldSnapshot;
  declared: BrownfieldDeclaredArchitecture;
  invariants: Invariant[];
  registry: PackageRegistry;
  goal: BrownfieldGoal;
  experiment: BrownfieldExperimentSpec;
  authority: BrownfieldAuthoritySpec;
  learning: BrownfieldLearningSpec;
  stores: BrownfieldLearningStores;
  /** The single RFC3339 instant stamped on every artifact of the loop. */
  now: string;
  /** The loop producer (WHO/WHAT ran the loop; non-LLM for calibrated paths). */
  producer: Producer;
  /** Loop provenance prefix (non-empty; stamped on every minted artifact). */
  provenance: string[];
  /** Optional authority anchor stamped on minted envelopes (or null). */
  authority_ref: string | null;
}

/** Local error alias so this module's validation reads uniformly. */
class BrownfieldLoopInputError extends BrownfieldError {
  constructor(message: string) {
    super('INVALID_LOOP_INPUT', message);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the loop input (throws BrownfieldError; deep validation is delegated to the stage packages). */
export function assertValidBrownfieldLoopInput(value: unknown): asserts value is BrownfieldLoopInput {
  if (!isPlainObject(value)) {
    throw new BrownfieldLoopInputError('loop input must be an object');
  }
  const input = value as Record<string, unknown>;
  const required = [
    'snapshot',
    'declared',
    'invariants',
    'registry',
    'goal',
    'experiment',
    'authority',
    'learning',
    'stores',
    'now',
    'producer',
    'provenance',
  ] as const;
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      throw new BrownfieldLoopInputError(`loop input is missing the required field "${field}"`);
    }
  }
  if (!Array.isArray(input['provenance']) || (input['provenance'] as string[]).length === 0) {
    throw new BrownfieldLoopInputError('loop input provenance must be a non-empty array');
  }
  if (typeof input['now'] !== 'string' || input['now'].length === 0) {
    throw new BrownfieldLoopInputError('loop input now must be a non-empty RFC3339 timestamp');
  }
  if (typeof input['goal'] !== 'object' || input['goal'] === null) {
    throw new BrownfieldLoopInputError('loop input goal must be an object');
  }
  const goal = input['goal'] as Record<string, unknown>;
  if (typeof goal['target_component'] !== 'string' || (goal['target_component'] as string).length === 0) {
    throw new BrownfieldLoopInputError('goal.target_component must be a non-empty string');
  }
  if (typeof goal['capability'] !== 'string' || (goal['capability'] as string).length === 0) {
    throw new BrownfieldLoopInputError('goal.capability must be a non-empty string');
  }
  if (typeof input['experiment'] !== 'object' || input['experiment'] === null) {
    throw new BrownfieldLoopInputError('loop input experiment must be an object');
  }
  const experiment = input['experiment'] as Record<string, unknown>;
  if (typeof experiment['seed'] !== 'number' || !Number.isInteger(experiment['seed']) || (experiment['seed'] as number) < 0) {
    throw new BrownfieldLoopInputError('experiment.seed must be a non-negative integer');
  }
  if (typeof input['authority'] !== 'object' || input['authority'] === null) {
    throw new BrownfieldLoopInputError('loop input authority must be an object');
  }
}
