import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCandidateState, createExperiment, createExperimentResult, validateExperiment, validateExperimentResult, validateCandidateState } from '../src/index.js';
import {
  candidateInput,
  PROVENANCE,
  sampleCandidateContent,
  sampleExperimentInput,
  T1,
  toolProducer,
} from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '../fixtures');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

describe('golden fixtures (W9 experiments contract test data)', () => {
  it('candidate-state.json reproduces bit-exactly from the documented sample input', () => {
    const fixture = readFixture('candidate-state.json');
    const reproduced = createCandidateState(candidateInput(sampleCandidateContent()));
    expect(reproduced).toEqual(fixture);
    expect(validateCandidateState(fixture)).toBe(true);
    expect(reproduced.envelope.id).toBe((fixture as { envelope: { id: string } }).envelope.id);
  });

  it('experiment.json reproduces bit-exactly from the documented sample input', () => {
    const fixture = readFixture('experiment.json');
    const reproduced = createExperiment(sampleExperimentInput());
    expect(reproduced).toEqual(fixture);
    expect(validateExperiment(fixture)).toBe(true);
  });

  it('experiment-result.json reproduces bit-exactly from the documented sample input', () => {
    const fixture = readFixture('experiment-result.json') as {
      id: string;
      experiment_id: string;
      outcomes: Array<{ metric_id: string; arm_id: string; value: number | null; availability: string }>;
    };
    const experiment = createExperiment(sampleExperimentInput());
    const reproduced = createExperimentResult(experiment, {
      experiment_id: experiment.envelope.id,
      observed_at: T1,
      sample_size: 10_000,
      outcomes: fixture.outcomes.map((outcome) => ({
        metric_id: outcome.metric_id,
        arm_id: outcome.arm_id,
        value: outcome.value,
        availability: outcome.availability as 'SUCCESS',
      })),
      provenance: PROVENANCE,
      producer: toolProducer(),
    });
    expect(reproduced).toEqual(fixture);
    expect(validateExperimentResult(fixture)).toBe(true);
    expect(reproduced.id).toBe(fixture.id);
  });

  it('fixtures are internally cross-referenced (experiment -> candidate, result -> experiment)', () => {
    const candidate = readFixture('candidate-state.json') as { envelope: { id: string } };
    const experiment = readFixture('experiment.json') as {
      envelope: { id: string };
      content: { candidate_ref: string };
    };
    const result = readFixture('experiment-result.json') as {
      experiment_id: string;
      candidate_ref: string;
    };
    expect(experiment.content.candidate_ref).toBe(candidate.envelope.id);
    expect(result.experiment_id).toBe(experiment.envelope.id);
    expect(result.candidate_ref).toBe(candidate.envelope.id);
  });
});
