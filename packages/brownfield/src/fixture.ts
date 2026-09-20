/**
 * Brownfield fixture builder (W15) — the typed JSON contract of a golden
 * brownfield scenario and its deterministic construction into a complete
 * BrownfieldLoopInput (registry population included).
 *
 * The HARNESS (apps/brownfield-harness) owns the golden scenario DATA; this
 * builder owns the mechanical construction: it mints the package evaluation
 * evidence (@sos-2/evidence), creates the package artifacts
 * (@sos-2/packages), registers + evidence-gate-promotes them into a FRESH
 * PackageRegistry (@sos-2/registry — THE registry authority), remaps
 * package-key references to content-addressed package ids, resolves the
 * experiment variant (nominal/degraded effect sets) and wires fresh
 * learning stores (@sos-2/transfer, @sos-2/ecology, @sos-2/memory).
 *
 * Everything is deterministic: the same fixture JSON + variant produces a
 * byte-identical loop input (fresh stores) — pinned by tests.
 */

import { PackageRegistry } from '@sos-2/registry';
import { createPackageArtifact } from '@sos-2/packages';
import type { ApplicabilityEstimate, AssuranceObligation, ContextCondition, DiversityProfile } from '@sos-2/packages';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { ArmMetricEffect, ExperimentMetric, RollbackCriterion, StoppingCriterion } from '@sos-2/experiments';
import type { Invariant } from '@sos-2/conformance';
import type { HardConstraintView } from '@sos-2/search';
import type { DecaySignalKind } from '@sos-2/ecology';
import { TransferStore } from '@sos-2/transfer';
import { MaturityReviewQueue } from '@sos-2/ecology';
import { ArchitectureMemoryStore } from '@sos-2/memory';
import type { Producer } from '@sos-2/provenance';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { BrownfieldError } from './errors.js';
import type {
  BrownfieldLoopInput,
  BrownfieldDeclaredArchitecture,
  BrownfieldGoal,
  BrownfieldExperimentSpec,
  BrownfieldAuthoritySpec,
  BrownfieldLearningSpec,
} from './input.js';
import type { BrownfieldSnapshot } from './snapshot.js';
import type { BrownfieldObjective } from './input.js';

/** The two golden experiment worlds. */
export type BrownfieldVariant = 'nominal' | 'degraded';

/** One evidence seed backing a package (subject bound by the builder). */
export interface PackageEvidenceSpec {
  kind: string;
  availability: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL';
  evidence_class: 'OBSERVATIONAL' | 'INTERVENTIONAL';
  method: string;
  provenance: string[];
}

/** One package population seed (JSON; evidence/realizations bound by the builder). */
export interface BrownfieldPackageSeedJson {
  key: string;
  content: {
    semantic_capability: string;
    contracts: string[];
    preconditions: string[];
    postconditions: string[];
    applicability: ApplicabilityEstimate[];
    assurance_obligations: AssuranceObligation[];
    context: ContextCondition;
    learned_limitations: string[];
    diversity_profile: DiversityProfile;
    changes: string;
  };
  evidence: PackageEvidenceSpec[];
  target_maturity: 'DISCOVERED' | 'FORMING' | 'VALIDATED';
}

/** The experiment fixture (variant-resolved effect sets). */
export interface BrownfieldExperimentFixture {
  population_description: string;
  unit: 'REQUEST' | 'SESSION' | 'USER' | 'SERVICE_INSTANCE' | 'DEPLOYMENT';
  canary_ladder: number[];
  canary_exposure_percent: number;
  metrics: ExperimentMetric[];
  stopping_criteria: StoppingCriterion[];
  rollback_criteria: RollbackCriterion[];
  seed: number;
  samples_per_arm: number;
  nominal_effects: ArmMetricEffect[];
  degraded_effects: ArmMetricEffect[];
}

/** The golden brownfield scenario fixture (pure JSON). */
export interface BrownfieldFixtureJson {
  snapshot: BrownfieldSnapshot;
  declared: BrownfieldDeclaredArchitecture;
  invariants: Invariant[];
  packages: BrownfieldPackageSeedJson[];
  goal: {
    capability: string;
    query_context: ContextCondition;
    constraints: HardConstraintView[];
    mission_ref: string;
    objective_axes: BrownfieldObjective[];
    predicted_estimates_by_key: Record<string, Record<string, number>>;
    repertoire_edges: Record<string, number[]>;
    fitness_axis: BrownfieldObjective;
    target_component: string;
    replacement_id: string;
    replacement_kind: string;
    hypothesis_statement: string;
    predicted_effects: string[];
  };
  experiment: BrownfieldExperimentFixture;
  authority: BrownfieldAuthoritySpec;
  learning: {
    transfer_target_context: ContextCondition;
    decay_signals: Array<{ package_key: string; kind: DecaySignalKind; note: string }>;
    nominal_rule: string;
    rollback_rule: string;
  };
  now: string;
  producer: Producer;
  provenance: string[];
  authority_ref: string | null;
}

/** What the fixture builder returns. */
export interface BuiltBrownfieldLoopInput {
  input: BrownfieldLoopInput;
  /** Fixture package key -> registered package id. */
  packageIds: Record<string, string>;
  registry: PackageRegistry;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the fixture JSON (throws BrownfieldError; constructors validate deeply). */
export function assertValidBrownfieldFixture(value: unknown): asserts value is BrownfieldFixtureJson {
  if (!isPlainObject(value)) {
    throw new BrownfieldError('INVALID_FIXTURE', 'fixture must be a plain JSON object');
  }
  const fixture = value as Record<string, unknown>;
  for (const field of ['snapshot', 'declared', 'invariants', 'packages', 'goal', 'experiment', 'authority', 'learning', 'now', 'producer', 'provenance'] as const) {
    if (!Object.prototype.hasOwnProperty.call(fixture, field)) {
      throw new BrownfieldError('INVALID_FIXTURE', `fixture is missing the required field "${field}"`);
    }
  }
  if (!Array.isArray(fixture['packages']) || (fixture['packages'] as unknown[]).length === 0) {
    throw new BrownfieldError('INVALID_FIXTURE', 'fixture.packages must be a non-empty array');
  }
  if (!Array.isArray(fixture['provenance']) || (fixture['provenance'] as string[]).length === 0) {
    throw new BrownfieldError('INVALID_FIXTURE', 'fixture.provenance must be a non-empty array');
  }
}

/**
 * Build a complete, deterministic loop input from a fixture JSON and a
 * variant (fresh registry + fresh learning stores on every call).
 */
export function buildBrownfieldLoopInput(fixture: BrownfieldFixtureJson, variant: BrownfieldVariant): BuiltBrownfieldLoopInput {
  assertValidBrownfieldFixture(fixture);

  // 1. Package population: evidence -> artifacts -> registry (+ gates).
  const registry = new PackageRegistry();
  const packageIds: Record<string, string> = {};
  for (const seed of fixture.packages) {
    const evaluationSubject = deriveDeterministicArtifactId('Evaluation', {
      note: 'w15 brownfield package evaluation subject',
      package: seed.key,
      capability: seed.content.semantic_capability,
    });
    const evidenceRecords: EvidenceRecordW3[] = seed.evidence.map((evidenceSpec) =>
      createEvidence({
        kind: evidenceSpec.kind,
        subject_ref: evaluationSubject,
        availability: evidenceSpec.availability,
        evidence_class: evidenceSpec.evidence_class,
        method: evidenceSpec.method,
        provenance: [...fixture.provenance, ...evidenceSpec.provenance],
        window: { start: fixture.now, end: fixture.now },
        producer: fixture.producer,
      }),
    );
    if (evidenceRecords.length === 0) {
      throw new BrownfieldError('INVALID_FIXTURE', `package seed "${seed.key}" declares no evidence (packages require evidence)`);
    }
    const firstEvidence = evidenceRecords[0];
    if (firstEvidence === undefined) {
      throw new BrownfieldError('INVALID_FIXTURE', 'unreachable: evidence records checked non-empty');
    }
    const artifact = createPackageArtifact({
      content: {
        semantic_capability: seed.content.semantic_capability,
        contracts: [...seed.content.contracts],
        preconditions: [...seed.content.preconditions],
        postconditions: [...seed.content.postconditions],
        realizations: [],
        applicability: seed.content.applicability.map((estimate) => structuredClone(estimate)),
        evidence_refs: evidenceRecords.map((record) => record.id),
        failure_refs: [],
        compatibility_refs: [],
        composition_refs: [],
        assurance_obligations: seed.content.assurance_obligations.map((obligation) => structuredClone(obligation)),
        context: { ...seed.content.context },
        learned_limitations: [...seed.content.learned_limitations],
        diversity_profile: structuredClone(seed.content.diversity_profile),
        maturity: 'DISCOVERED',
        changes: seed.content.changes,
        superseded_by: null,
      },
      provenance: [...fixture.provenance, `brownfield:package-seed:${seed.key}`],
      created_at: fixture.now,
      authority_ref: fixture.authority_ref,
      status: 'ACTIVE',
    });
    registry.putPackage(artifact, evidenceRecords);
    let headId = artifact.envelope.id;

    // Evidence-gated maturity promotion (never one lucky success). Each
    // promote targets the CURRENT head; the chain head id (what retrieval
    // returns) becomes the fixture's package id reference.
    if (seed.target_maturity === 'FORMING' || seed.target_maturity === 'VALIDATED') {
      const { promoted } = registry.promote({
        id: headId,
        target: 'FORMING',
        evidence: evidenceRecords,
        provenance: [...fixture.provenance, `brownfield:package-forming:${seed.key}`],
        created_at: fixture.now,
        changes: `forming evaluation of ${seed.key}`,
      });
      headId = promoted.artifact.envelope.id;
    }
    if (seed.target_maturity === 'VALIDATED') {
      const { promoted } = registry.promote({
        id: headId,
        target: 'VALIDATED',
        evidence: evidenceRecords,
        additional_realizations: [
          { ref: firstEvidence.id, revision: fixture.snapshot.revision, note: `realization of ${seed.key} in the reference evaluation` },
        ],
        provenance: [...fixture.provenance, `brownfield:package-validated:${seed.key}`],
        created_at: fixture.now,
        changes: `validated through the reference evaluation evidence (${evidenceRecords.length} records)`,
      });
      headId = promoted.artifact.envelope.id;
    }
    packageIds[seed.key] = headId;
  }

  // 2. Goal: remap package-key estimates to package ids.
  const predicted_estimates: Record<string, Record<string, number>> = {};
  for (const [key, estimates] of Object.entries(fixture.goal.predicted_estimates_by_key)) {
    const packageId = packageIds[key];
    if (packageId === undefined) {
      throw new BrownfieldError('INVALID_FIXTURE', `goal.predicted_estimates_by_key references unknown package key "${key}"`);
    }
    predicted_estimates[packageId] = { ...estimates };
  }
  const goal: BrownfieldGoal = {
    capability: fixture.goal.capability,
    query_context: { ...fixture.goal.query_context },
    constraints: fixture.goal.constraints.map((constraint) => structuredClone(constraint)),
    mission_ref: fixture.goal.mission_ref,
    objective_axes: fixture.goal.objective_axes.map((objective) => ({ ...objective })),
    predicted_estimates,
    repertoire_edges: Object.fromEntries(Object.entries(fixture.goal.repertoire_edges).map(([axis, edges]) => [axis, [...edges]])),
    fitness_axis: { ...fixture.goal.fitness_axis },
    target_component: fixture.goal.target_component,
    replacement_id: fixture.goal.replacement_id,
    replacement_kind: fixture.goal.replacement_kind,
    hypothesis_statement: fixture.goal.hypothesis_statement,
    predicted_effects: [...fixture.goal.predicted_effects],
  };

  // 3. Experiment variant resolution.
  const effects = variant === 'nominal' ? fixture.experiment.nominal_effects : fixture.experiment.degraded_effects;
  const experiment: BrownfieldExperimentSpec = {
    population_description: fixture.experiment.population_description,
    unit: fixture.experiment.unit,
    canary_ladder: [...fixture.experiment.canary_ladder],
    canary_exposure_percent: fixture.experiment.canary_exposure_percent,
    metrics: fixture.experiment.metrics.map((metric) => structuredClone(metric)),
    stopping_criteria: fixture.experiment.stopping_criteria.map((criterion) => structuredClone(criterion)),
    rollback_criteria: fixture.experiment.rollback_criteria.map((criterion) => structuredClone(criterion)),
    seed: fixture.experiment.seed,
    samples_per_arm: fixture.experiment.samples_per_arm,
    effects: effects.map((effect) => ({ ...effect })),
  };

  // 4. Learning spec (package ids resolved) + fresh stores.
  const learning: BrownfieldLearningSpec = {
    transfer_target_context: { ...fixture.learning.transfer_target_context },
    decay_signals: fixture.learning.decay_signals.map((signal) => ({ ...signal })),
    package_ids: { ...packageIds },
    nominal_rule: fixture.learning.nominal_rule,
    rollback_rule: fixture.learning.rollback_rule,
  };
  const stores = {
    transfer: new TransferStore(),
    reviewQueue: new MaturityReviewQueue(),
    memory: new ArchitectureMemoryStore(),
  };

  const input: BrownfieldLoopInput = {
    snapshot: structuredClone(fixture.snapshot),
    declared: {
      nodes: fixture.declared.nodes.map((node) => structuredClone(node)),
      edges: fixture.declared.edges.map((edge) => structuredClone(edge)),
      provenance: [...fixture.declared.provenance],
      created_at: fixture.declared.created_at,
    },
    invariants: fixture.invariants.map((invariant) => structuredClone(invariant)),
    registry,
    goal,
    experiment,
    authority: { ...fixture.authority },
    learning,
    stores,
    now: fixture.now,
    producer: { ...fixture.producer },
    provenance: [...fixture.provenance],
    authority_ref: fixture.authority_ref,
  };

  return { input, packageIds, registry };
}
