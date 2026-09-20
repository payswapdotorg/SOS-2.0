/**
 * Shared test fixtures for @sos-2/experiments tests.
 *
 * - The Constitution anchor id is CONSUMED from the W0.5 golden contract
 *   fixtures (packages/semantic-spine/fixtures) — downstream workers never
 *   invent core identifiers.
 * - Candidate, hypothesis and system-state ids are minted deterministically
 *   through the spine's exported minters (never invented by hand).
 * - Evidence-shaped records for cross-gate tests are minted through
 *   @sos-2/evidence's createEvidence (deterministic, content-addressed).
 * - The W2 LocalCandidate sample adapts through this package's bridge
 *   (candidateStateFromLocalCandidate) — the merged-W2 compatibility path.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { LocalCandidate } from '@sos-2/architecture';
import { createCandidateState, createExperiment } from '../src/index.js';
import type {
  ArmMetricEffect,
  CandidateStateFixture,
  CreateCandidateStateInput,
  ExperimentArtifact,
  ExperimentContent,
  SimulateExperimentInput,
  StageExposure,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Constitution anchor id from the W0.5 golden fixture artifact-envelope.json. */
export const CONSTITUTION_ANCHOR_ID: string = (
  JSON.parse(readFileSync(join(here, '../../semantic-spine/fixtures/artifact-envelope.json'), 'utf8')) as {
    authority_ref: string;
  }
).authority_ref;

export const PROVENANCE = ['W9:test'];
export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-05T00:00:00.000Z';
export const T3 = '2025-01-10T00:00:00.000Z';

/** Deterministic CausalHypothesis id (experiments test CAUSAL hypotheses). */
export const HYPOTHESIS_ID = deriveDeterministicArtifactId('CausalHypothesis', {
  note: 'w9 experiments test hypothesis',
  claim: 'write-through cache drops p99',
});

/** Deterministic SystemState revision token the candidate is based on. */
export const BASE_REVISION = 'system-state:r1';

export function toolProducer() {
  return {
    tool: 'sos-experiments',
    tool_version: '0.1.0',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:local',
  };
}

export function llmProducer() {
  return {
    tool: 'experiment-designer-assistant',
    tool_version: null,
    model: 'glm-4.5',
    model_version: '2025.1',
    command: null,
    environment: null,
  };
}

/** The golden sample candidate content (the documented sample input). */
export function sampleCandidateContent() {
  return {
    invariants: ['p99 read latency stays below 500ms', 'no data loss on cache eviction'],
    predicted_effects: ['p99 read latency drops below 200ms', 'primary datastore read QPS falls'],
    causal_claim: true,
    confidence: null,
    base_subject_revision: BASE_REVISION,
    hypothesis_ref: HYPOTHESIS_ID,
    bounded_subgraph_ref: null,
    context: { environment: 'production', service: 'checkout' },
  };
}

export function sampleCandidate(status: 'DRAFT' | 'ACTIVE' = 'DRAFT'): CandidateStateFixture {
  return createCandidateState({
    content: sampleCandidateContent(),
    provenance: PROVENANCE,
    created_at: T0,
    authority_ref: CONSTITUTION_ANCHOR_ID,
    status,
  });
}

/** A deterministic CANDIDATE_STATE id (minted, not invented). */
export function candidateId(content: ReturnType<typeof sampleCandidateContent>): string {
  return deriveDeterministicArtifactId('CandidateState', {
    kind: 'CandidateState',
    version: 1,
    status: 'DRAFT',
    authority_ref: CONSTITUTION_ANCHOR_ID,
    provenance: PROVENANCE,
    created_at: T0,
    supersedes: null,
    content,
  });
}

/** A deterministic TREATMENT candidate id for standalone design tests (minted, not invented). */
export const DESIGN_CANDIDATE_REF = deriveDeterministicArtifactId('CandidateState', {
  note: 'w9 design test treatment candidate',
});

/** The golden sample TREATMENT_CONTROL design. */
export function sampleDesign(candidateRef: string = DESIGN_CANDIDATE_REF) {
  return {
    kind: 'TREATMENT_CONTROL' as const,
    population: {
      description: 'Checkout read traffic in the production region.',
      unit: 'REQUEST' as const,
      context: { environment: 'production', service: 'checkout' },
    },
    allocation: {
      unit: 'REQUEST' as const,
      assignment: 'RANDOM' as const,
      arms: [
        { id: 'control', role: 'CONTROL' as const, candidate_ref: null },
        { id: 'treatment', role: 'TREATMENT' as const, candidate_ref: candidateRef },
      ],
      ratios: [1, 1],
    },
    metrics: [
      {
        id: 'p99-latency',
        role: 'PRIMARY' as const,
        description: 'p99 read latency (ms).',
        direction: 'DECREASE' as const,
      },
      {
        id: 'db-read-qps',
        role: 'SECONDARY' as const,
        description: 'Primary datastore read QPS.',
        direction: 'DECREASE' as const,
      },
      {
        id: 'error-rate',
        role: 'GUARDRAIL' as const,
        description: 'Read error rate (fraction) — lower is safer.',
        direction: 'DECREASE' as const,
        guardrail_threshold: 0.01,
      },
    ],
    stopping_criteria: [
      { kind: 'MAX_SAMPLES' as const, max_samples: 10_000 },
      { kind: 'MAX_DURATION_SECONDS' as const, max_duration_seconds: 86_400 },
      { kind: 'EARLY_SUCCESS' as const, description: 'Stop when the primary metric is satisfied and guardrails hold.' },
      { kind: 'SAFETY' as const, description: 'Stop for safety when any guardrail is breached or not established.' },
    ],
    rollback_criteria: [
      {
        id: 'error-budget',
        guardrail_metric_ids: ['error-rate'],
        description: 'Roll back when the error-rate guardrail is breached or cannot be established.',
      },
    ],
  };
}

/** The golden sample experiment content (SHADOW stage at creation). */
export function sampleExperimentContent(
  candidate: CandidateStateFixture = sampleCandidate(),
): ExperimentContent {
  const design = sampleDesign(candidate.envelope.id);
  return {
    design,
    stage: { phase: 'SHADOW', exposure_percent: 0 } satisfies StageExposure,
    canary_ladder: [1, 5, 25, 50],
    candidate_ref: candidate.envelope.id,
    hypothesis_ref: HYPOTHESIS_ID,
    producer: toolProducer(),
  };
}

export interface ExperimentVariants {
  designKind?: 'TREATMENT_CONTROL' | 'ALTERNATIVES';
  stage?: StageExposure;
  canaryLadder?: number[];
}

/** A fully valid experiment over the sample design (deterministic id). */
export function sampleExperimentInput(variants: ExperimentVariants = {}): {
  content: ExperimentContent;
  provenance: string[];
  created_at: string;
} {
  const candidate = sampleCandidate();
  const content = sampleExperimentContent(candidate);
  if (variants.designKind === 'ALTERNATIVES') {
    content.design = alternativesDesign(candidate.envelope.id);
  }
  if (variants.stage !== undefined) {
    content.stage = variants.stage;
  }
  if (variants.canaryLadder !== undefined) {
    content.canary_ladder = variants.canaryLadder;
  }
  return { content, provenance: PROVENANCE, created_at: T0 };
}

/** An ALTERNATIVES design: cache-A vs cache-B vs no-cache baseline candidate. */
export function alternativesDesign(candidateRef: string, otherCandidateRefs: string[] = []) {
  const others = otherCandidateRefs.length > 0 ? otherCandidateRefs : [
    deriveDeterministicArtifactId('CandidateState', { note: 'w9 alternative candidate B' }),
    deriveDeterministicArtifactId('CandidateState', { note: 'w9 alternative candidate C' }),
  ];
  return {
    kind: 'ALTERNATIVES' as const,
    population: {
      description: 'Checkout read traffic in the production region.',
      unit: 'USER' as const,
      context: { environment: 'production', service: 'checkout' },
    },
    allocation: {
      unit: 'USER' as const,
      assignment: 'DETERMINISTIC_HASH' as const,
      arms: [
        { id: 'arm-a', role: 'ALTERNATIVE' as const, candidate_ref: candidateRef },
        ...others.map((ref, i) => ({ id: `arm-${String.fromCharCode(98 + i)}`, role: 'ALTERNATIVE' as const, candidate_ref: ref })),
      ],
      ratios: [1, 1, 1],
    },
    metrics: [
      { id: 'p99-latency', role: 'PRIMARY' as const, description: 'p99 read latency (ms).', direction: 'DECREASE' as const },
      {
        id: 'error-rate',
        role: 'GUARDRAIL' as const,
        description: 'Read error rate (fraction) — lower is safer.',
        direction: 'DECREASE' as const,
        guardrail_threshold: 0.01,
      },
    ],
    stopping_criteria: [
      { kind: 'EARLY_SUCCESS' as const, description: 'Stop when the primary metric is satisfied and guardrails hold.' },
    ],
    rollback_criteria: [
      { id: 'error-budget', guardrail_metric_ids: ['error-rate'], description: 'Roll back on error-budget breach.' },
    ],
  };
}

/** Effects for the golden design: strong treatment effect, safe guardrail. */
export function sampleEffects(design: ReturnType<typeof sampleDesign>): ArmMetricEffect[] {
  const effects: ArmMetricEffect[] = [];
  for (const arm of design.allocation.arms) {
    for (const metric of design.metrics) {
      const trueMean =
        metric.id === 'p99-latency'
          ? arm.role === 'CONTROL'
            ? 240
            : 180
          : metric.id === 'db-read-qps'
            ? arm.role === 'CONTROL'
              ? 5000
              : 3200
            : arm.role === 'CONTROL'
              ? 0.005
              : 0.006;
      effects.push({ arm_id: arm.id, metric_id: metric.id, true_mean: trueMean, noise_std: 1 });
    }
  }
  return effects;
}

/** A canonical simulation input over a created experiment artifact. */
export function sampleSimulationInput(
  experiment: ReturnType<typeof createExperimentArtifact>,
  seed = 424242,
  overrides?: Record<string, string>,
): SimulateExperimentInput {
  return {
    experiment,
    effects: sampleEffects(experiment.content.design as ReturnType<typeof sampleDesign>),
    seed,
    samples_per_arm: 200,
    observed_at: T1,
    provenance: PROVENANCE,
    producer: toolProducer(),
    availability_overrides: overrides,
  };
}

/** The W2 LocalCandidate sample (for the compatibility bridge). */
export function sampleLocalCandidate(): LocalCandidate {
  return {
    baseGraphRef: {
      graph_id: deriveDeterministicArtifactId('ArchitectureGraph', { note: 'w9 test graph' }),
      version: 3,
    },
    boundedSubgraph: {
      nodes: ['cache-layer'],
      edges: [],
    },
    replacement: [
      {
        op: 'ADD_COMPONENT',
        node: { id: 'write-through-cache', kind: 'Component', criticality: 'critical', attributes: { tier: 'edge' } },
      },
    ],
    invariants: ['p99 read latency stays below 500ms'],
    predictedEffects: ['p99 read latency drops below 200ms'],
  };
}

export function candidateInput(content: ReturnType<typeof sampleCandidateContent>): CreateCandidateStateInput {
  return { content, provenance: PROVENANCE, created_at: T0, authority_ref: CONSTITUTION_ANCHOR_ID };
}

/** Create the golden experiment artifact. */
export function createExperimentArtifact(variants: ExperimentVariants = {}): ExperimentArtifact {
  return createExperiment(sampleExperimentInput(variants));
}
