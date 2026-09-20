/**
 * Shared test fixtures for @sos-2/causal tests.
 *
 * - The Constitution anchor id is CONSUMED from the W0.5 golden contract
 *   fixtures (packages/semantic-spine/fixtures) — downstream workers never
 *   invent core identifiers.
 * - Subject and calibration ids are minted deterministically through the
 *   spine's exported minters (never invented by hand).
 * - Evidence records are minted through @sos-2/evidence's createEvidence
 *   (deterministic, content-addressed) and referenced through this
 *   package's class-typed reference builders.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { createEvidence } from '@sos-2/evidence';
import type { Confidence, CreateEvidenceInput, EvidenceRecordW3 } from '@sos-2/evidence';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import {
  interventionalEvidenceRef,
  observationalEvidenceRef,
} from '../src/index.js';
import type {
  CausalGraph,
  CausalHypothesisContent,
  ClaimStrength,
  CorrelationRecordContent,
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
export const W0: TimeWindow = { start: T0, end: T1 };

/** Deterministic System State subject id (the intervened system). */
export const SYSTEM_STATE_R1 = deriveDeterministicArtifactId('SystemState', {
  note: 'w5 causal test subject',
  revision: 'r1',
});

/** Deterministic calibration Evaluation artifact id. */
export const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'w5 causal test calibration',
  producer: 'historical-bench-v1',
  brier_score: 0.08,
});

export function toolProducer(): Producer {
  return {
    tool: 'sos-causal-analyst',
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

export function qualitativeConfidence(): Confidence {
  return { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' };
}

export function unquantifiedConfidence(): Confidence {
  return { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' };
}

export function calibratedConfidence(value = 0.8): Confidence {
  return { kind: 'CALIBRATED', value, calibration_ref: CALIBRATION };
}

/** A deterministic OBSERVATIONAL evidence record (unique per `seed`). */
export function observationalRecord(seed: string, availability: CreateEvidenceInput['availability'] = 'SUCCESS'): EvidenceRecordW3 {
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

/** A deterministic INTERVENTIONAL evidence record (unique per `seed`). */
export function interventionalRecord(seed: string, availability: CreateEvidenceInput['availability'] = 'SUCCESS'): EvidenceRecordW3 {
  return createEvidence({
    kind: 'experiment',
    subject_ref: SYSTEM_STATE_R1,
    availability,
    evidence_class: 'INTERVENTIONAL',
    method: 'experiment:ab-test-result',
    provenance: ['experiment:sha256:' + seed.padEnd(64, '0').slice(0, 64)],
    source_revision: 'git:219cb9c8e329b0435f2deea37ec2d5003b264931',
    deployment_revision: null,
    window: W0,
    subject_revision: 'r1',
    confidence: unquantifiedConfidence(),
    producer: toolProducer(),
  });
}

/** The canonical sample causal graph (3 factors, 2 contributes-to edges, 1 confounds relation). */
export function sampleGraph(): CausalGraph {
  return {
    factors: [
      { id: 'cache-enabled', description: 'Write-through cache layer is enabled.' },
      { id: 'p99-latency', description: 'p99 read latency.' },
      { id: 'traffic-volume', description: 'Request traffic volume.' },
    ],
    edges: [
      { type: 'CONTRIBUTES_TO', cause: 'cache-enabled', effect: 'p99-latency' },
      { type: 'CONTRIBUTES_TO', cause: 'traffic-volume', effect: 'p99-latency' },
      { type: 'CONFOUNDS', confounder: 'traffic-volume', cause: 'cache-enabled', effect: 'p99-latency' },
    ],
  };
}

export interface SampleHypothesisOptions {
  claimStrength?: ClaimStrength;
  /** How many observational SUCCESS references to include (default 1). */
  observational?: number;
  /** How many interventional SUCCESS references to include (default 1). */
  interventionalSuccess?: number;
  /** How many interventional non-SUCCESS references to include (default 0). */
  interventionalOther?: number;
  producer?: Producer;
  uncertainty?: Confidence;
}

/**
 * A complete, valid causal hypothesis content. The DEFAULTS (CAUSAL, 1
 * observational, 1 interventional SUCCESS) are the documented golden sample
 * input — `fixtures/causal-hypothesis.json` reproduces bit-exactly from it.
 */
export function sampleHypothesisContent(options: SampleHypothesisOptions = {}): CausalHypothesisContent {
  const observationalCount = options.observational ?? 1;
  const interventionalSuccess = options.interventionalSuccess ?? 1;
  const interventionalOther = options.interventionalOther ?? 0;
  const observational_evidence = Array.from({ length: observationalCount }, (_, i) =>
    observationalEvidenceRef(observationalRecord(`obs-${i}-${observationalCount}`)),
  );
  const interventional_evidence = [
    ...Array.from({ length: interventionalSuccess }, (_, i) =>
      interventionalEvidenceRef(interventionalRecord(`int-s-${i}-${interventionalSuccess}`)),
    ),
    ...Array.from({ length: interventionalOther }, (_, i) =>
      interventionalEvidenceRef(interventionalRecord(`int-f-${i}-${interventionalOther}`, 'FAILURE')),
    ),
  ];
  return {
    statement: 'Enabling the write-through cache caused p99 read latency to drop.',
    claim_strength: options.claimStrength ?? 'CAUSAL',
    intervention: {
      description: 'Enable the write-through cache layer on the read path.',
      target_ref: SYSTEM_STATE_R1,
    },
    mechanism: 'Cache hits bypass the primary datastore round-trip, so tail read latency falls with the hit rate.',
    predicted_outcomes: [
      {
        id: 'p99-drop',
        description: 'p99 read latency falls below 200ms.',
        metric: 'p99-latency',
        direction: 'DECREASE',
      },
      {
        id: 'db-qps-drop',
        description: 'Primary datastore read QPS falls.',
        metric: 'db-read-qps',
        direction: 'DECREASE',
      },
    ],
    assumptions: [
      { id: 'traffic-stable', statement: 'Traffic volume is comparable across the compared windows.' },
      { id: 'telemetry-trust', statement: 'Latency telemetry is available and trustworthy.' },
    ],
    context: { environment: 'production', service: 'checkout' },
    alternatives: [
      { id: 'traffic-shift', explanation: 'A traffic-volume shift reduced tail latency independently of the cache.' },
      { id: 'deploy-coincidence', explanation: 'A concurrent deployment changed the latency profile.' },
    ],
    refutations: [
      {
        id: 'latency-flat',
        description: 'p99 read latency is unchanged when the cache is enabled under comparable traffic.',
      },
    ],
    graph: sampleGraph(),
    observational_evidence,
    interventional_evidence,
    uncertainty: options.uncertainty ?? qualitativeConfidence(),
    producer: options.producer ?? toolProducer(),
    correlation_origin: null,
  };
}

/** A complete, valid correlation record content (the documented golden sample input). */
export function sampleCorrelationContent(): CorrelationRecordContent {
  return {
    statement: 'Cache hit rate correlates with p99 read latency.',
    variables: [
      { id: 'cache-hit-rate', description: 'Fraction of reads served from the cache.' },
      { id: 'p99-latency', description: 'p99 read latency.' },
    ],
    direction: 'NEGATIVE',
    context: { environment: 'production', service: 'checkout' },
    observational_evidence: [observationalEvidenceRef(observationalRecord('corr-obs-1'))],
    interventional_evidence: [],
    uncertainty: unquantifiedConfidence(),
    producer: toolProducer(),
  };
}
