/**
 * Meta-evolution fixture builder (W16) — the typed JSON contract of a golden
 * self-evolution scenario and its deterministic construction into a complete
 * MetaEvolutionInput (meta-strategy registry population included).
 *
 * The HARNESS (apps/self-evolution-harness) owns the golden scenario DATA;
 * this builder owns the mechanical construction: it mints the package
 * evaluation evidence (@sos-2/evidence), creates the meta-strategy package
 * artifacts (@sos-2/packages), registers + evidence-gate-promotes them into
 * a FRESH PackageRegistry (@sos-2/registry — THE registry authority; R24:
 * SOS internals consume the same package mechanism), remaps package-key
 * references to content-addressed package ids and wires fresh learning
 * stores (@sos-2/transfer, @sos-2/ecology, @sos-2/memory).
 *
 * Everything is deterministic: the same scenario JSON + object fixture
 * produces a byte-identical loop input (fresh stores) — pinned by tests.
 */

import { PackageRegistry } from '@sos-2/registry';
import { createPackageArtifact } from '@sos-2/packages';
import type { ApplicabilityEstimate, AssuranceObligation, ContextCondition, DiversityProfile } from '@sos-2/packages';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { ArmMetricEffect, ExperimentMetric, RollbackCriterion, StoppingCriterion } from '@sos-2/experiments';
import type { ObjectiveAxis } from '@sos-2/optimization';
import type { DecaySignalKind } from '@sos-2/ecology';
import { TransferStore } from '@sos-2/transfer';
import { MaturityReviewQueue } from '@sos-2/ecology';
import { ArchitectureMemoryStore } from '@sos-2/memory';
import type { Producer } from '@sos-2/provenance';
import type { MissionContent } from '@sos-2/mission';
import type { BrownfieldFixtureJson, BrownfieldVariant } from '@sos-2/brownfield';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { BlastRadius, ReversibilityClass } from '@sos-2/autonomy';
import type { AskRiskSeverity, UncertaintyStatement } from '@sos-2/authority';
import type { ImpactClass } from '@sos-2/decision';
import { MetaEvolutionError } from './errors.js';
import type { EvidenceSpec, EffectivenessSpec, MetaChangeSpec, MetaEvolutionInput } from './input.js';
import type { MetaProcessParameters, MetaProcessPatch } from './parameters.js';

/** One meta-strategy package seed (JSON; evidence/realizations bound by the builder). */
export interface MetaPackageSeedJson {
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
  evidence: Array<{
    kind: string;
    availability: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL';
    evidence_class: 'OBSERVATIONAL' | 'INTERVENTIONAL';
    method: string;
    provenance: string[];
  }>;
  target_maturity: 'DISCOVERED' | 'FORMING' | 'VALIDATED';
}

/** One meta-change specification (package-key referenced; ids resolved by the builder). */
export interface MetaChangeSpecJson {
  key: string;
  package_key: string;
  patch: MetaProcessPatch;
  intent: string;
  predicted_effects: string[];
  hypothesis_statement: string;
  blast_radius: BlastRadius;
  impact: ImpactClass;
  risk: AskRiskSeverity;
  reversibility: ReversibilityClass;
  uncertainty: UncertaintyStatement;
  predicted_estimates: Record<string, number>;
  behavior: Record<string, number>;
  fitness: number;
  decision_evidence: EvidenceSpec[];
  promotion_evidence: EvidenceSpec[];
  effects: ArmMetricEffect[];
}

/** The golden self-evolution scenario fixture (pure JSON). */
export interface MetaScenarioJson {
  now: string;
  producer: Producer;
  provenance: string[];
  authority_ref: string | null;
  mission: { content: MissionContent };
  process: { parameters: MetaProcessParameters; notes: string };
  object: { variant: BrownfieldVariant };
  meta_context: ContextCondition;
  packages: MetaPackageSeedJson[];
  changes: MetaChangeSpecJson[];
  effectiveness: {
    population_description: string;
    unit: 'REQUEST' | 'SESSION' | 'USER' | 'SERVICE_INSTANCE' | 'DEPLOYMENT';
    canary_ladder: number[];
    canary_exposure_percent: number;
    metrics: ExperimentMetric[];
    stopping_criteria: StoppingCriterion[];
    rollback_criteria: RollbackCriterion[];
    seed: number;
    samples_per_arm: number;
    objective_axes: Array<{ axis: ObjectiveAxis; direction: 'MINIMIZE' | 'MAXIMIZE' }>;
    repertoire_edges: Record<string, number[]>;
  };
  authority: {
    decision: { grantee: string; permissions: string[]; expires_at: string };
    promotion: { grantee: string; permissions: string[]; expires_at: string };
  };
  learning: {
    transfer_target_context: ContextCondition;
    decay_signal: { kind: DecaySignalKind; note: string };
    failure_rule: string;
    rollback_rule: string;
  };
}

/** What the fixture builder returns. */
export interface BuiltMetaEvolutionInput {
  input: MetaEvolutionInput;
  /** Fixture package key -> registered package id. */
  packageIds: Record<string, string>;
  registry: PackageRegistry;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the scenario JSON (throws MetaEvolutionError; constructors validate deeply). */
export function assertValidMetaScenario(value: unknown): asserts value is MetaScenarioJson {
  if (!isPlainObject(value)) {
    throw new MetaEvolutionError('INVALID_SCENARIO', 'scenario must be a plain JSON object');
  }
  const scenario = value as Record<string, unknown>;
  for (const field of [
    'now',
    'producer',
    'provenance',
    'mission',
    'process',
    'object',
    'meta_context',
    'packages',
    'changes',
    'effectiveness',
    'authority',
    'learning',
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(scenario, field)) {
      throw new MetaEvolutionError('INVALID_SCENARIO', `scenario is missing the required field "${field}"`);
    }
  }
  if (!Array.isArray(scenario['packages']) || (scenario['packages'] as unknown[]).length === 0) {
    throw new MetaEvolutionError('INVALID_SCENARIO', 'scenario.packages must be a non-empty array');
  }
  if (!Array.isArray(scenario['changes']) || (scenario['changes'] as unknown[]).length === 0) {
    throw new MetaEvolutionError('INVALID_SCENARIO', 'scenario.changes must be a non-empty array');
  }
  if (!Array.isArray(scenario['provenance']) || (scenario['provenance'] as string[]).length === 0) {
    throw new MetaEvolutionError('INVALID_SCENARIO', 'scenario.provenance must be a non-empty array');
  }
}

/**
 * Build a complete, deterministic loop input from a scenario JSON and the
 * object-side fixture (fresh registry + fresh learning stores on every call).
 */
export function buildMetaEvolutionInput(scenario: MetaScenarioJson, objectFixture: BrownfieldFixtureJson): BuiltMetaEvolutionInput {
  assertValidMetaScenario(scenario);

  // 1. The meta-strategy package population (R24: the same mechanism).
  const registry = new PackageRegistry();
  const packageIds: Record<string, string> = {};
  for (const seed of scenario.packages) {
    const evaluationSubject = deriveDeterministicArtifactId('Evaluation', {
      note: 'w16 meta-evolution package evaluation subject',
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
        provenance: [...scenario.provenance, ...evidenceSpec.provenance],
        window: { start: scenario.now, end: scenario.now },
        producer: scenario.producer,
      }),
    );
    if (evidenceRecords.length === 0) {
      throw new MetaEvolutionError('INVALID_SCENARIO', `package seed "${seed.key}" declares no evidence (packages require evidence)`);
    }
    const firstEvidence = evidenceRecords[0];
    if (firstEvidence === undefined) {
      throw new MetaEvolutionError('INVALID_SCENARIO', 'unreachable: evidence records checked non-empty');
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
      provenance: [...scenario.provenance, `meta-evolution:package-seed:${seed.key}`],
      created_at: scenario.now,
      authority_ref: scenario.authority_ref,
      status: 'ACTIVE',
    });
    registry.putPackage(artifact, evidenceRecords);
    let headId = artifact.envelope.id;

    if (seed.target_maturity === 'FORMING' || seed.target_maturity === 'VALIDATED') {
      const { promoted } = registry.promote({
        id: headId,
        target: 'FORMING',
        evidence: evidenceRecords,
        provenance: [...scenario.provenance, `meta-evolution:package-forming:${seed.key}`],
        created_at: scenario.now,
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
          { ref: firstEvidence.id, revision: 'meta-scenario-v1', note: `realization of ${seed.key} in the reference evaluation` },
        ],
        provenance: [...scenario.provenance, `meta-evolution:package-validated:${seed.key}`],
        created_at: scenario.now,
        changes: `validated through the reference evaluation evidence (${evidenceRecords.length} records)`,
      });
      headId = promoted.artifact.envelope.id;
    }
    packageIds[seed.key] = headId;
  }

  // 2. Change specs (package keys resolved to registered package ids).
  const changes: MetaChangeSpec[] = scenario.changes.map((spec) => {
    const packageId = packageIds[spec.package_key];
    if (packageId === undefined) {
      throw new MetaEvolutionError('INVALID_SCENARIO', `change spec "${spec.key}" references unknown package key "${spec.package_key}"`);
    }
    return {
      key: spec.key,
      package_id: packageId,
      patch: structuredClone(spec.patch),
      intent: spec.intent,
      predicted_effects: [...spec.predicted_effects],
      hypothesis_statement: spec.hypothesis_statement,
      blast_radius: spec.blast_radius,
      impact: spec.impact,
      risk: spec.risk,
      reversibility: spec.reversibility,
      uncertainty: { ...spec.uncertainty },
      predicted_estimates: { ...spec.predicted_estimates },
      behavior: { ...spec.behavior },
      fitness: spec.fitness,
      decision_evidence: spec.decision_evidence.map((evidence) => ({ ...evidence, provenance: [...evidence.provenance] })),
      promotion_evidence: spec.promotion_evidence.map((evidence) => ({ ...evidence, provenance: [...evidence.provenance] })),
      effects: spec.effects.map((effect) => ({ ...effect })),
    };
  });

  // 3. The effectiveness spec (frozen §11 axes).
  const effectiveness: EffectivenessSpec = {
    population_description: scenario.effectiveness.population_description,
    unit: scenario.effectiveness.unit,
    canary_ladder: [...scenario.effectiveness.canary_ladder],
    canary_exposure_percent: scenario.effectiveness.canary_exposure_percent,
    metrics: scenario.effectiveness.metrics.map((metric) => structuredClone(metric)),
    stopping_criteria: scenario.effectiveness.stopping_criteria.map((criterion) => structuredClone(criterion)),
    rollback_criteria: scenario.effectiveness.rollback_criteria.map((criterion) => structuredClone(criterion)),
    seed: scenario.effectiveness.seed,
    samples_per_arm: scenario.effectiveness.samples_per_arm,
    objective_axes: scenario.effectiveness.objective_axes.map((axis) => ({ ...axis })),
    repertoire_edges: Object.fromEntries(
      Object.entries(scenario.effectiveness.repertoire_edges).map(([axis, edges]) => [axis, [...edges]]),
    ),
  };

  // 4. Fresh learning stores.
  const stores = {
    transfer: new TransferStore(),
    reviewQueue: new MaturityReviewQueue(),
    memory: new ArchitectureMemoryStore(),
  };

  const input: MetaEvolutionInput = {
    object: { fixture: structuredClone(objectFixture), variant: scenario.object.variant },
    mission: { content: structuredClone(scenario.mission.content) },
    process: { parameters: structuredClone(scenario.process.parameters), notes: scenario.process.notes },
    meta_context: { ...scenario.meta_context },
    registry,
    changes,
    effectiveness,
    authority: {
      decision: { ...scenario.authority.decision, permissions: [...scenario.authority.decision.permissions] },
      promotion: { ...scenario.authority.promotion, permissions: [...scenario.authority.promotion.permissions] },
    },
    learning: {
      transfer_target_context: { ...scenario.learning.transfer_target_context },
      decay_signal: { ...scenario.learning.decay_signal },
      failure_rule: scenario.learning.failure_rule,
      rollback_rule: scenario.learning.rollback_rule,
    },
    stores,
    now: scenario.now,
    producer: { ...scenario.producer },
    provenance: [...scenario.provenance],
    authority_ref: scenario.authority_ref,
  };

  return { input, packageIds, registry };
}
