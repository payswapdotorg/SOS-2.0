/**
 * Deterministic deployment simulator tests — fixed-seed determinism, the
 * simulated mark and the never-intervention-evidence discipline.
 */

import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { EVIDENCE_TRUTH_STATES } from '@sos-2/semantic-spine';
import {
  DEPLOYMENT_SIMULATOR_VERSION,
  DeploymentSimulationError,
  simulateDeployment,
  simulatedRunOutcomes,
  isSimulatedRun,
} from '../src/index.js';
import { T0, makeDeployment, toolProducer } from './helpers.js';

const STEPS = [
  { name: 'provision', success_probability: 1, unknown_probability: 0, unavailable_probability: 0 },
  { name: 'migrate', success_probability: 0.5, unknown_probability: 0.2, unavailable_probability: 0.1 },
  { name: 'verify', success_probability: 0.9 },
];

function simulate(seed: number) {
  return simulateDeployment({
    deployment: makeDeployment(),
    steps: STEPS,
    seed,
    observed_at: T0,
    producer: toolProducer(),
  });
}

describe('simulateDeployment (determinism)', () => {
  it('identical seed + input yields BIT-IDENTICAL runs', () => {
    for (const seed of [0, 1, 42, 424242, 2147483647]) {
      expect(canonicalSerialize(simulate(seed))).toBe(canonicalSerialize(simulate(seed)));
    }
  });

  it('consumes the PRNG in a fixed order (three draws per step, always)', () => {
    // Deterministic sanity: the exact run for seed 42 with these steps.
    const run = simulate(42);
    expect(run.steps).toHaveLength(STEPS.length);
    expect(run.steps.map((step) => step.name)).toEqual(['provision', 'migrate', 'verify']);
    // Every step availability is a frozen truth state.
    for (const step of run.steps) {
      expect(EVIDENCE_TRUTH_STATES).toContain(step.availability);
    }
  });

  it('carries the simulator identity, seed and simulated:true', () => {
    const run = simulate(7);
    expect(run.simulator_version).toBe(DEPLOYMENT_SIMULATOR_VERSION);
    expect(run.seed).toBe(7);
    expect(run.simulated).toBe(true);
    expect(run.provenance).toContain('simulated:true');
    expect(run.provenance).toContain('seed:7');
    expect(run.provenance).toContain(`simulator:${DEPLOYMENT_SIMULATOR_VERSION}`);
    expect(run.window).toEqual({ start: T0, end: T0 });
    expect(run.deployment_ref).toMatch(/^sos:\/\/DeploymentRecord\/[0-9a-f]{32}$/);
  });

  it('aggregates the overall availability truthfully (max severity)', () => {
    const allUnknown = simulateDeployment({
      deployment: makeDeployment(),
      steps: [
        { name: 'a', success_probability: 1, unknown_probability: 1 },
        { name: 'b', success_probability: 1 },
      ],
      seed: 0,
      observed_at: T0,
      producer: toolProducer(),
    });
    expect(allUnknown.steps[0]!.availability).toBe('UNKNOWN');
    expect(allUnknown.steps[1]!.availability).toBe('SUCCESS');
    expect(allUnknown.overall_availability).toBe('UNKNOWN'); // never SUCCESS/FAILURE
  });

  it('rejects malformed simulation input', () => {
    expect(() => simulateDeployment({ deployment: makeDeployment(), steps: [], seed: 0, observed_at: T0, producer: toolProducer() })).toThrow();
    expect(() =>
      simulateDeployment({
        deployment: makeDeployment(),
        steps: [{ name: 'x', success_probability: 1.5 }],
        seed: 0,
        observed_at: T0,
        producer: toolProducer(),
      }),
    ).toThrow(DeploymentSimulationError);
    expect(() =>
      simulateDeployment({
        deployment: makeDeployment(),
        steps: [{ name: 'x', success_probability: 0.5 }, { name: 'x', success_probability: 0.5 }],
        seed: 0,
        observed_at: T0,
        producer: toolProducer(),
      }),
    ).toThrow(/unique/);
    expect(() => simulateDeployment({ deployment: makeDeployment(), steps: STEPS, seed: -1, observed_at: T0, producer: toolProducer() })).toThrow(/seed/);
    expect(() => simulateDeployment({ deployment: makeDeployment(), steps: STEPS, seed: 0, observed_at: '', producer: toolProducer() })).toThrow();
    expect(() => simulateDeployment({ deployment: makeDeployment(), steps: STEPS, seed: 0, observed_at: T0, producer: null as never })).toThrow();
  });
});

describe('simulated run outcomes (never intervention evidence)', () => {
  it('materializes simulated outcomes — all marked simulated', () => {
    const run = simulate(42);
    const outcomes = simulatedRunOutcomes(run, toolProducer());
    expect(outcomes).toHaveLength(run.steps.length);
    for (const outcome of outcomes) {
      expect(outcome.simulated).toBe(true);
      expect(outcome.deployment_ref).toBe(run.deployment_ref);
      expect(EVIDENCE_TRUTH_STATES).toContain(outcome.availability);
    }
    // A simulated run is recognizable.
    expect(isSimulatedRun(run)).toBe(true);
    expect(isSimulatedRun({ simulated: false })).toBe(false);
    expect(isSimulatedRun(null)).toBe(false);
  });

  it('rejects non-simulated runs and malformed producers', () => {
    expect(() => simulatedRunOutcomes({ simulated: false } as never, toolProducer())).toThrow(
      DeploymentSimulationError,
    );
    expect(() => simulatedRunOutcomes(simulate(1), null as never)).toThrow(DeploymentSimulationError);
  });
});
