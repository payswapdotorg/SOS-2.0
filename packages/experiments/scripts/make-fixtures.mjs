/**
 * One-off fixture generator for @sos-2/experiments golden fixtures.
 * Run AFTER `pnpm run build`: node scripts/make-fixtures.mjs
 * This script is NOT part of the test suite; its output is committed and
 * pinned by test/fixtures.test.ts (ids reproduce bit-exactly).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createCandidateState, createExperiment, createExperimentResult } from '../dist/index.js';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';

const T0 = '2025-01-01T00:00:00.000Z';
const T1 = '2025-01-02T00:00:00.000Z';
const PROVENANCE = ['W9:test'];
const CONSTITUTION_ANCHOR_ID = JSON.parse(
  readFileSync(new URL('../../semantic-spine/fixtures/artifact-envelope.json', import.meta.url), 'utf8'),
).authority_ref;

const HYPOTHESIS_ID = deriveDeterministicArtifactId('CausalHypothesis', {
  note: 'w9 experiments test hypothesis',
  claim: 'write-through cache drops p99',
});

const candidateContent = {
  invariants: ['p99 read latency stays below 500ms', 'no data loss on cache eviction'],
  predicted_effects: ['p99 read latency drops below 200ms', 'primary datastore read QPS falls'],
  causal_claim: true,
  confidence: null,
  base_subject_revision: 'system-state:r1',
  hypothesis_ref: HYPOTHESIS_ID,
  bounded_subgraph_ref: null,
  context: { environment: 'production', service: 'checkout' },
};

const candidate = createCandidateState({
  content: candidateContent,
  provenance: PROVENANCE,
  created_at: T0,
  authority_ref: CONSTITUTION_ANCHOR_ID,
});

const design = {
  kind: 'TREATMENT_CONTROL',
  population: {
    description: 'Checkout read traffic in the production region.',
    unit: 'REQUEST',
    context: { environment: 'production', service: 'checkout' },
  },
  allocation: {
    unit: 'REQUEST',
    assignment: 'RANDOM',
    arms: [
      { id: 'control', role: 'CONTROL', candidate_ref: null },
      { id: 'treatment', role: 'TREATMENT', candidate_ref: candidate.envelope.id },
    ],
    ratios: [1, 1],
  },
  metrics: [
    { id: 'p99-latency', role: 'PRIMARY', description: 'p99 read latency (ms).', direction: 'DECREASE' },
    { id: 'db-read-qps', role: 'SECONDARY', description: 'Primary datastore read QPS.', direction: 'DECREASE' },
    { id: 'error-rate', role: 'GUARDRAIL', description: 'Read error rate (fraction) — lower is safer.', direction: 'DECREASE', guardrail_threshold: 0.01 },
  ],
  stopping_criteria: [
    { kind: 'MAX_SAMPLES', max_samples: 10000 },
    { kind: 'MAX_DURATION_SECONDS', max_duration_seconds: 86400 },
    { kind: 'EARLY_SUCCESS', description: 'Stop when the primary metric is satisfied and guardrails hold.' },
    { kind: 'SAFETY', description: 'Stop for safety when any guardrail is breached or not established.' },
  ],
  rollback_criteria: [
    {
      id: 'error-budget',
      guardrail_metric_ids: ['error-rate'],
      description: 'Roll back when the error-rate guardrail is breached or cannot be established.',
    },
  ],
};

const producer = {
  tool: 'sos-experiments',
  tool_version: '0.1.0',
  model: null,
  model_version: null,
  command: 'pnpm -r test',
  environment: 'ci:local',
};

const experiment = createExperiment({
  content: {
    design,
    stage: { phase: 'SHADOW', exposure_percent: 0 },
    canary_ladder: [1, 5, 25, 50],
    candidate_ref: candidate.envelope.id,
    hypothesis_ref: HYPOTHESIS_ID,
    producer,
  },
  provenance: PROVENANCE,
  created_at: T0,
});

const result = createExperimentResult(experiment, {
  experiment_id: experiment.envelope.id,
  observed_at: T1,
  sample_size: 10000,
  outcomes: [
    { metric_id: 'p99-latency', arm_id: 'control', value: 240.4, availability: 'SUCCESS' },
    { metric_id: 'p99-latency', arm_id: 'treatment', value: 180.2, availability: 'SUCCESS' },
    { metric_id: 'db-read-qps', arm_id: 'control', value: 5012.5, availability: 'SUCCESS' },
    { metric_id: 'db-read-qps', arm_id: 'treatment', value: 3201.3, availability: 'SUCCESS' },
    { metric_id: 'error-rate', arm_id: 'control', value: 0.0051, availability: 'SUCCESS' },
    { metric_id: 'error-rate', arm_id: 'treatment', value: 0.0063, availability: 'SUCCESS' },
  ],
  provenance: PROVENANCE,
  producer,
});

writeFileSync(new URL('../fixtures/experiment.json', import.meta.url).pathname, JSON.stringify(experiment, null, 2) + '\n');
writeFileSync(new URL('../fixtures/experiment-result.json', import.meta.url).pathname, JSON.stringify(result, null, 2) + '\n');
writeFileSync(new URL('../fixtures/candidate-state.json', import.meta.url).pathname, JSON.stringify(candidate, null, 2) + '\n');
console.log('fixtures written:');
console.log('  experiment id:', experiment.envelope.id);
console.log('  result id:', result.id);
console.log('  candidate id:', candidate.envelope.id);
