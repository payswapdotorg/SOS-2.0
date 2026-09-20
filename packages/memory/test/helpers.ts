/**
 * Shared test fixtures for @sos-2/memory tests.
 *
 * - The Constitution anchor id is CONSUMED from the W0.5 golden contract
 *   fixtures (packages/semantic-spine/fixtures) — downstream workers never
 *   invent core identifiers.
 * - Subject ids are minted deterministically through the spine's exported
 *   minters (never invented by hand).
 * - Evidence records are minted through @sos-2/evidence's createEvidence
 *   (deterministic, content-addressed); their ids are the sanctioned
 *   evidence references for memory entries.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { createEvidence } from '@sos-2/evidence';
import type { Confidence, CreateEvidenceInput, EvidenceRecordW3 } from '@sos-2/evidence';
import type { Producer } from '@sos-2/provenance';
import type {
  ArchitectureMemoryContent,
  FailureEntry,
  LearnedRuleEntry,
  LiabilityEntry,
  MemoryEntry,
  ObservationEntry,
  OutcomeEntry,
  PredictionEntry,
  RollbackEntry,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Constitution anchor id from the W0.5 golden fixture artifact-envelope.json. */
export const CONSTITUTION_ANCHOR_ID: string = (
  JSON.parse(readFileSync(join(here, '../../semantic-spine/fixtures/artifact-envelope.json'), 'utf8')) as {
    authority_ref: string;
  }
).authority_ref;

export const PROVENANCE = ['W5:test'];
export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-05T00:00:00.000Z';
export const T3 = '2025-01-10T00:00:00.000Z';
export const W0 = { start: T0, end: T1 };

/** Deterministic System State subject id (the remembered system). */
export const SYSTEM_STATE_R1 = deriveDeterministicArtifactId('SystemState', {
  note: 'w5 memory test subject',
  revision: 'r1',
});

/** Deterministic CausalHypothesis artifact id (prediction provenance). */
export const CAUSAL_HYPOTHESIS_R1 = deriveDeterministicArtifactId('CausalHypothesis', {
  note: 'w5 memory test hypothesis',
  revision: 'h1',
});

/** Deterministic calibration Evaluation artifact id. */
export const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'w5 memory test calibration',
  producer: 'historical-bench-v1',
  brier_score: 0.11,
});

export function toolProducer(): Producer {
  return {
    tool: 'sos-memory-recorder',
    tool_version: '0.1.0',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:local',
  };
}

export function llmProducer(): Producer {
  return {
    tool: 'analysis-assistant',
    tool_version: null,
    model: 'glm-4.5',
    model_version: '2025.1',
    command: null,
    environment: null,
  };
}

export function unquantifiedConfidence(): Confidence {
  return { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' };
}

export function moderateConfidence(): Confidence {
  return { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' };
}

export function calibratedConfidence(value = 0.7): Confidence {
  return { kind: 'CALIBRATED', value, calibration_ref: CALIBRATION };
}

/** A deterministic OBSERVATIONAL evidence record (unique per `seed`). */
export function evidenceRecord(seed: string, availability: CreateEvidenceInput['availability'] = 'SUCCESS'): EvidenceRecordW3 {
  return createEvidence({
    kind: 'telemetry',
    subject_ref: SYSTEM_STATE_R1,
    availability,
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['observation:sha256:' + seed.padEnd(64, '0').slice(0, 64)],
    source_revision: 'git:219cb9c8e329b0435f2deea37ec2d5003b264931',
    deployment_revision: null,
    window: W0,
    subject_revision: 'r1',
    confidence: unquantifiedConfidence(),
    producer: toolProducer(),
  });
}

/** The canonical sample entries (one of each of the seven kinds). */
export interface SampleEntries {
  prediction: PredictionEntry;
  observation: ObservationEntry;
  outcome: OutcomeEntry;
  failure: FailureEntry;
  liability: LiabilityEntry;
  rollback: RollbackEntry;
  learnedRule: LearnedRuleEntry;
}

export function sampleEntries(): SampleEntries {
  const prediction: PredictionEntry = {
    entry_kind: 'PREDICTION',
    id: 'pred-p99-drop',
    recorded_at: T0,
    statement: 'p99 read latency will fall below 200ms after the cache rollout.',
    subject_ref: SYSTEM_STATE_R1,
    hypothesis_ref: CAUSAL_HYPOTHESIS_R1,
    context: { environment: 'production', service: 'checkout' },
  };
  const observation: ObservationEntry = {
    entry_kind: 'OBSERVATION',
    id: 'obs-p99-baseline',
    recorded_at: T0,
    statement: 'p99 read latency is 480ms before the rollout.',
    evidence_refs: [evidenceRecord('obs-baseline').id],
    context: { environment: 'production' },
  };
  const outcome: OutcomeEntry = {
    entry_kind: 'OUTCOME',
    id: 'outcome-p99-after-rollout',
    recorded_at: T2,
    statement: 'p99 read latency is 160ms one week after the cache rollout.',
    prediction_refs: ['pred-p99-drop'],
    realized: 'REALIZED',
    evidence_refs: [evidenceRecord('obs-after-rollout').id],
    context: { environment: 'production' },
  };
  const failure: FailureEntry = {
    entry_kind: 'FAILURE',
    id: 'fail-cache-stampede',
    recorded_at: T1,
    statement: 'A cache stampede on cold start raised error rates for 9 minutes.',
    evidence_refs: [evidenceRecord('fail-stampede', 'FAILURE').id],
    context: { environment: 'production', region: 'eu-1', deploy: 'cache-v1' },
  };
  const liability: LiabilityEntry = {
    entry_kind: 'LIABILITY',
    id: 'liab-cache-invalidation',
    recorded_at: T1,
    statement: 'Cache invalidation is manual and undocumented; stale reads are possible.',
    severity: 'HIGH',
    owner_kind: 'TEAM',
    resolution: { state: 'OPEN', note: null, resolved_at: null, resolution_evidence_refs: [] },
    context: { environment: 'production', component: 'cache' },
  };
  const rollback: RollbackEntry = {
    entry_kind: 'ROLLBACK',
    id: 'rb-cache-v2',
    recorded_at: T3,
    statement: 'Rolled back cache-v2 after elevated 5xx rates.',
    from_revision: 'oci:sha256:' + 'c'.repeat(64),
    to_revision: 'oci:sha256:' + 'd'.repeat(64),
    reason: 'Elevated 5xx rates on the write path after the v2 rollout.',
    evidence_refs: [evidenceRecord('rb-5xx', 'FAILURE').id],
    context: { environment: 'production' },
  };
  const learnedRule: LearnedRuleEntry = {
    entry_kind: 'LEARNED_RULE',
    id: 'rule-warm-cache-rollout',
    recorded_at: T2,
    statement: 'Warm the cache before shifting production traffic after any cache-layer change.',
    applicability: { change_kind: 'cache-layer', environment: 'production' },
    evidence_refs: [evidenceRecord('rule-evidence').id],
    uncertainty: moderateConfidence(),
  };
  return { prediction, observation, outcome, failure, liability, rollback, learnedRule };
}

/** All seven sample entries as one array (the documented golden sample input). */
export function sampleEntryList(): MemoryEntry[] {
  const s = sampleEntries();
  return [s.prediction, s.observation, s.outcome, s.failure, s.liability, s.rollback, s.learnedRule];
}

/** The documented golden sample memory content. */
export function sampleMemoryContent(): ArchitectureMemoryContent {
  return {
    entries: sampleEntryList(),
    update: {
      producer: toolProducer(),
      evidence_refs: [evidenceRecord('update-basis').id],
    },
  };
}
