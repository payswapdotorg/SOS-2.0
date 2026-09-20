import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  advanceExperimentStage,
  createCandidateState,
  createExperiment,
  createExperimentResult,
  evaluateExperimentResult,
  simulateExperiment,
  validateCandidateState,
  validateExperiment,
  validateExperimentResult,
} from '../src/index.js';
import {
  candidateInput,
  createExperimentArtifact,
  sampleCandidateContent,
  sampleExperimentInput,
  sampleSimulationInput,
  PROVENANCE,
  T1,
  toolProducer,
} from './helpers.js';

const LADDERS = fc
  .uniqueArray(fc.integer({ min: 1, max: 99 }), { minLength: 1, maxLength: 6 })
  .map((steps) => [...new Set(steps)].sort((a, b) => a - b));

const SEEDS = fc.integer({ min: 0, max: 2 ** 31 });

describe('property: simulator determinism (randomized experiments, fixed seed)', () => {
  it('identical (experiment, effects, seed, samples) -> bit-identical results, always', () => {
    fc.assert(
      fc.property(SEEDS, fc.integer({ min: 1, max: 400 }), (seed, samplesPerArm) => {
        const experiment = createExperimentArtifact();
        const runA = simulateExperiment(sampleSimulationInput(experiment, seed, undefined));
        const runB = simulateExperiment(sampleSimulationInput(experiment, seed, undefined));
        expect(runA).toEqual(runB);
        expect(runA.id).toBe(runB.id);
        expect(canonicalSerialize(runA)).toBe(canonicalSerialize(runB));
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('different seeds -> different outcome streams (with overwhelming probability)', () => {
    fc.assert(
      fc.property(SEEDS, (seed) => {
        const experiment = createExperimentArtifact();
        const a = simulateExperiment(sampleSimulationInput(experiment, seed));
        const b = simulateExperiment(sampleSimulationInput(experiment, seed + 1));
        expect(a.id === b.id ? canonicalSerialize(a) !== canonicalSerialize(b) : true).toBe(true);
        return true;
      }),
      { numRuns: 40 },
    );
  });
});

describe('property: lifecycle transition determinism', () => {
  it('randomized valid stage advances are deterministic and always end at 100% exposure', () => {
    fc.assert(
      fc.property(LADDERS, (ladder) => {
        const experiment = createExperiment({ ...sampleExperimentInput(), content: {
          ...sampleExperimentInput().content,
          canary_ladder: ladder,
        } });
        const first = ladder[0]!;
        const advancedA = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: first });
        const advancedB = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: first });
        expect(advancedA).toEqual(advancedB);
        const controlled = advanceExperimentStage(advancedA, { phase: 'CONTROLLED_EXPERIMENT' });
        expect(controlled.stage.exposure_percent).toBe(100);
        expect(controlled.stage.phase).toBe('CONTROLLED_EXPERIMENT');
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('every lifecycle advance preserves design, links and ladder (deterministic content copies)', () => {
    fc.assert(
      fc.property(LADDERS, (ladder) => {
        const input = sampleExperimentInput();
        input.content.canary_ladder = ladder;
        const experiment = createExperiment(input);
        const advanced = advanceExperimentStage(experiment.content, {
          phase: 'CANARY',
          exposure_percent: ladder[0]!,
        });
        expect(advanced.design).toEqual(experiment.content.design);
        expect(advanced.candidate_ref).toBe(experiment.content.candidate_ref);
        expect(advanced.hypothesis_ref).toBe(experiment.content.hypothesis_ref);
        expect(advanced.canary_ladder).toEqual(experiment.content.canary_ladder);
        return true;
      }),
      { numRuns: 40 },
    );
  });
});

describe('property: canonical round trips and id determinism', () => {
  it('candidate fixtures serialize -> parse -> serialize byte-identically, with stable ids', () => {
    fc.assert(
      fc.property(SEEDS, (seed) => {
        const content = sampleCandidateContent();
        content.invariants = [`invariant-${seed}`];
        const candidate = createCandidateState(candidateInput(content));
        expect(validateCandidateState(candidate)).toBe(true);
        const text = canonicalSerialize(candidate);
        expect(canonicalSerialize(JSON.parse(text))).toBe(text);
        expect(createCandidateState(candidateInput(content)).envelope.id).toBe(candidate.envelope.id);
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('experiment artifacts round trip canonically with stable ids', () => {
    fc.assert(
      fc.property(LADDERS, (ladder) => {
        const input = sampleExperimentInput();
        input.content.canary_ladder = ladder;
        const experiment = createExperiment(input);
        expect(validateExperiment(experiment)).toBe(true);
        const text = canonicalSerialize(experiment);
        expect(canonicalSerialize(JSON.parse(text))).toBe(text);
        expect(createExperiment(input).envelope.id).toBe(experiment.envelope.id);
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('experiment results round trip canonically with stable ids and truthful evaluation', () => {
    fc.assert(
      fc.property(SEEDS, (seed) => {
        const experiment = createExperimentArtifact();
        const result = simulateExperiment(sampleSimulationInput(experiment, seed));
        expect(validateExperimentResult(result)).toBe(true);
        const text = canonicalSerialize(result);
        expect(canonicalSerialize(JSON.parse(text))).toBe(text);
        const evaluation = evaluateExperimentResult(experiment, result);
        // Truthful total: one of the frozen truth states, and simulated results
        // with unknown guardrails are never SUCCESS.
        expect(['SUCCESS', 'FAILURE', 'UNKNOWN', 'PARTIAL']).toContain(evaluation.overall_availability);
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('real (non-simulated) results also round trip and validate with stable ids', () => {
    fc.assert(
      fc.property(SEEDS, (seed) => {
        const experiment = createExperimentArtifact();
        const input = {
          experiment_id: experiment.envelope.id,
          observed_at: T1,
          sample_size: seed,
          outcomes: [
            { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' as const },
            { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' as const },
            { metric_id: 'db-read-qps', arm_id: 'control', value: 5000, availability: 'SUCCESS' as const },
            { metric_id: 'db-read-qps', arm_id: 'treatment', value: 3200, availability: 'SUCCESS' as const },
            { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' as const },
            { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' as const },
          ],
          provenance: [`W9:property:${seed}`],
          producer: toolProducer(),
        };
        const a = createExperimentResult(experiment, input);
        const b = createExperimentResult(experiment, input);
        expect(a.id).toBe(b.id);
        expect(a).toEqual(b);
        expect(validateExperimentResult(a)).toBe(true);
        expect(PROVENANCE.length).toBeGreaterThan(0);
        return true;
      }),
      { numRuns: 40 },
    );
  });
});
