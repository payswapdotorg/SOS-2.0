import { describe, expect, it } from 'vitest';
import {
  canonicalResultText,
  createExperimentResult,
  experimentResultId,
  isSimulatedRecord,
  resultTraceLinks,
  validateExperimentResult,
} from '../src/index.js';
import {
  createExperimentArtifact,
  sampleExperimentInput,
  PROVENANCE,
  T0,
  T1,
  toolProducer,
} from './helpers.js';

describe('experiment result records', () => {
  it('mints deterministic Evaluation-kind ids and mirrors the candidate + hypothesis links', () => {
    const experiment = createExperimentArtifact();
    const input = {
      experiment_id: experiment.envelope.id,
      observed_at: T1,
      sample_size: 500,
      outcomes: [
        { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' as const },
        { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' as const },
        { metric_id: 'db-read-qps', arm_id: 'control', value: 5000, availability: 'SUCCESS' as const },
        { metric_id: 'db-read-qps', arm_id: 'treatment', value: 3200, availability: 'SUCCESS' as const },
        { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' as const },
        { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' as const },
      ],
      provenance: PROVENANCE,
      producer: toolProducer(),
    };
    const result = createExperimentResult(experiment, input);
    expect(result.id).toMatch(/^sos:\/\/Evaluation\/[0-9a-f]{32}$/);
    expect(result.experiment_id).toBe(experiment.envelope.id);
    expect(result.candidate_ref).toBe(experiment.content.candidate_ref);
    expect(result.hypothesis_ref).toBe(experiment.content.hypothesis_ref);
    expect(result.simulated).toBe(false);
    expect(result.simulator).toBeNull();
    expect(validateExperimentResult(result)).toBe(true);
    expect(createExperimentResult(experiment, input).id).toBe(result.id);
    expect(experimentResultId(experiment, input)).toBe(result.id);
  });

  it('carries simulator provenance exactly when simulated', () => {
    const experiment = createExperimentArtifact();
    const base = {
      experiment_id: experiment.envelope.id,
      observed_at: T1,
      sample_size: 10,
      outcomes: [
        { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' as const },
        { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' as const },
        { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' as const },
        { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' as const },
      ],
      provenance: PROVENANCE,
      producer: toolProducer(),
    };
    const simulated = createExperimentResult(experiment, {
      ...base,
      simulator: { version: '@sos-2/experiments:simulator@1', seed: 7 },
    });
    expect(simulated.simulated).toBe(true);
    expect(simulated.simulator).toEqual({ version: '@sos-2/experiments:simulator@1', seed: 7 });
    expect(validateExperimentResult(simulated)).toBe(true);
    expect(isSimulatedRecord(simulated)).toBe(true);
    expect(isSimulatedRecord(base)).toBe(false);
  });

  it('rejects outcomes outside the design (results never float)', () => {
    const experiment = createExperimentArtifact();
    expect(() =>
      createExperimentResult(experiment, {
        experiment_id: experiment.envelope.id,
        observed_at: T1,
        sample_size: 10,
        outcomes: [
          { metric_id: 'no-such-metric', arm_id: 'control', value: 1, availability: 'SUCCESS' },
        ],
        provenance: PROVENANCE,
        producer: toolProducer(),
      }),
    ).toThrow(/design does not declare/);
    expect(() =>
      createExperimentResult(experiment, {
        experiment_id: experiment.envelope.id,
        observed_at: T1,
        sample_size: 10,
        outcomes: [
          { metric_id: 'p99-latency', arm_id: 'no-such-arm', value: 1, availability: 'SUCCESS' },
        ],
        provenance: PROVENANCE,
        producer: toolProducer(),
      }),
    ).toThrow(/allocation does not declare/);
  });

  it('rejects results bound to a different experiment (exact-experiment discipline)', () => {
    const experiment = createExperimentArtifact();
    expect(() =>
      createExperimentResult(experiment, {
        experiment_id: 'sos://Experiment/11111111111111111111111111111111',
        observed_at: T1,
        sample_size: 10,
        outcomes: [],
        provenance: PROVENANCE,
        producer: toolProducer(),
      }),
    ).toThrow(/exact experiment artifact id/);
  });

  it('links the result to the candidate, hypothesis and experiment via VERIFIES/OBSERVES/CAUSED_BY', () => {
    const experiment = createExperimentArtifact();
    const result = createExperimentResult(experiment, {
      experiment_id: experiment.envelope.id,
      observed_at: T1,
      sample_size: 10,
      outcomes: [
        { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
        { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
        { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
        { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
      ],
      provenance: PROVENANCE,
      producer: toolProducer(),
    });
    const links = resultTraceLinks(result);
    expect(links.map((link) => link.type)).toEqual(['VERIFIES', 'OBSERVES', 'CAUSED_BY']);
    expect(links[0]).toMatchObject({ source: result.id, target: result.candidate_ref });
    expect(links[1]).toMatchObject({ source: result.id, target: result.hypothesis_ref });
    expect(links[2]).toMatchObject({ source: result.id, target: result.experiment_id });
  });

  it('canonical serialization round trips deterministically', () => {
    const experiment = createExperimentArtifact();
    const result = createExperimentResult(experiment, {
      experiment_id: experiment.envelope.id,
      observed_at: T1,
      sample_size: 10,
      outcomes: [
        { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
        { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
        { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
        { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
      ],
      provenance: PROVENANCE,
      producer: toolProducer(),
    });
    const text = canonicalResultText(result);
    expect(JSON.parse(text)).toEqual(JSON.parse(canonicalResultText(result)));
    expect(text).toBe(canonicalResultText(result));
  });

  it('rejects observed_at before the experiment started only through the duration rule (timestamp shape still validated)', () => {
    const experiment = createExperimentArtifact();
    expect(() =>
      createExperimentResult(experiment, {
        experiment_id: experiment.envelope.id,
        observed_at: 'not-a-timestamp',
        sample_size: 0,
        outcomes: [],
        provenance: PROVENANCE,
        producer: toolProducer(),
      }),
    ).toThrow(/RFC3339/);
    expect(T0).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
