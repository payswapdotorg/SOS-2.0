/**
 * One-off fixture generator for @sos-2/promotion golden fixtures.
 * Run AFTER `pnpm run build`: node scripts/make-fixtures.mjs
 * Its output is committed and pinned by test/fixtures.test.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { createGrant } from '@sos-2/authority';
import { createEvidence } from '@sos-2/evidence';
import {
  createCandidateState,
  createExperiment,
  createExperimentResult,
  evaluateExperimentResult,
} from '@sos-2/experiments';
import { evaluatePromotion } from '../dist/index.js';

const T0 = '2025-01-01T00:00:00.000Z';
const T1 = '2025-01-02T00:00:00.000Z';
const T2 = '2025-01-05T00:00:00.000Z';
const PROVENANCE = ['W9:promotion-test'];
const CONSTITUTION_ANCHOR_ID = JSON.parse(
  readFileSync(new URL('../../semantic-spine/fixtures/artifact-envelope.json', import.meta.url), 'utf8'),
).authority_ref;
const HYPOTHESIS_ID = deriveDeterministicArtifactId('CausalHypothesis', {
  note: 'w9 promotion test hypothesis',
  claim: 'write-through cache drops p99',
});

const producer = {
  tool: 'sos-promotion',
  tool_version: '0.1.0',
  model: null,
  model_version: null,
  command: 'pnpm -r test',
  environment: 'ci:local',
};

const candidate = createCandidateState({
  content: {
    invariants: ['p99 read latency stays below 500ms', 'no data loss on cache eviction'],
    predicted_effects: ['p99 read latency drops below 200ms', 'primary datastore read QPS falls'],
    causal_claim: true,
    confidence: null,
    base_subject_revision: 'system-state:r1',
    hypothesis_ref: HYPOTHESIS_ID,
    bounded_subgraph_ref: null,
    context: { environment: 'production', service: 'checkout' },
  },
  provenance: PROVENANCE,
  created_at: T0,
  authority_ref: CONSTITUTION_ANCHOR_ID,
});

const experiment = createExperiment({
  content: {
    design: {
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
        {
          id: 'error-rate',
          role: 'GUARDRAIL',
          description: 'Read error rate (fraction) — lower is safer.',
          direction: 'DECREASE',
          guardrail_threshold: 0.01,
        },
      ],
      stopping_criteria: [
        { kind: 'EARLY_SUCCESS', description: 'Stop when the primary metric is satisfied and guardrails hold.' },
      ],
      rollback_criteria: [
        {
          id: 'error-budget',
          guardrail_metric_ids: ['error-rate'],
          description: 'Roll back when the error-rate guardrail is breached or cannot be established.',
        },
      ],
    },
    stage: { phase: 'CONTROLLED_EXPERIMENT', exposure_percent: 100 },
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
  sample_size: 5000,
  outcomes: [
    { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
    { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
    { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
    { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
  ],
  provenance: PROVENANCE,
  producer,
});

const triggers = evaluateExperimentResult(experiment, result).rollback;

const grant = createGrant({
  grantee: 'w9-promotion-gate',
  scope: { kind: 'KIND', artifact_kind: 'CandidateState' },
  permissions: ['READ', 'PROMOTE'],
  expiry: { kind: 'TIME', at: T2 },
  provenance: PROVENANCE,
  created_at: T0,
  status: 'ACTIVE',
});

const assurance = {
  id: deriveDeterministicArtifactId('AssuranceCase', {
    note: 'w9 promotion test assurance case',
    claims: 2,
  }),
  claims: [
    { id: 'latency-safety', statement: 'The cache layer preserves the p99 latency safety invariant under load.' },
    { id: 'data-durability', statement: 'No data is lost on cache eviction (write-through discipline).' },
  ],
  verdict: 'SATISFIED',
  validity: {
    status: 'CURRENT',
    expires_at: T2,
    reason: 'assurance case revalidated against the current implementation, dependencies and environment',
  },
};

const evidence = createEvidence({
  kind: 'experiment',
  subject_ref: candidate.envelope.id,
  availability: 'SUCCESS',
  evidence_class: 'INTERVENTIONAL',
  method: 'experiment:controlled-experiment-result',
  provenance: ['experiment:sha256:' + '9'.repeat(64)],
  source_revision: 'git:f2f20663d84b55da7dcd7ac34125b2b7ce896e34',
  deployment_revision: null,
  window: { start: T0, end: T2 },
  subject_revision: 'candidate:v1',
  confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
  producer,
});

const evaluation = evaluatePromotion(candidate, {
  authority: { grant, now: T1 },
  assurance,
  evidence: [evidence],
  liveTriggers: triggers,
  systemState: { revision: 'system-state:r1' },
  recovery: {
    mechanism: 'Feature-flag kill switch reverting to the direct-read path; stateless components, no data migration.',
    max_recovery_seconds: 30,
    containment_exception: null,
    rollback_triggers: triggers.map((trigger) => ({ experiment_id: experiment.envelope.id, trigger })),
    authority_ref: null,
  },
  provenance: PROVENANCE,
  created_at: T1,
});

if (evaluation.decision !== 'ACT') {
  console.error('golden fixture must be an ACT decision; got', evaluation.decision);
  process.exit(1);
}
writeFileSync(
  new URL('../fixtures/promotion-decision.json', import.meta.url).pathname,
  JSON.stringify(evaluation.record, null, 2) + '\n',
);
console.log('fixture written:');
console.log('  decision id:', evaluation.record.envelope.id);
console.log('  action:', evaluation.record.content.action);
