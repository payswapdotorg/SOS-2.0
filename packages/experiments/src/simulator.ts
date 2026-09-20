/**
 * The deterministic experiment SIMULATOR (Work Order W9; layer-6 evaluation
 * infrastructure per docs/implementation/TESTING-AND-EVIDENCE.md:
 * "replay, simulation, shadow, canary, experiment and rollback").
 *
 * WHAT THIS IS: an in-memory experiment simulator that produces typed
 * outcome records from DECLARED effect parameters using a FIXED-SEED PRNG.
 * It exists so the experimentation plane's evaluation logic (guardrails,
 * stopping/rollback triggers, promotion gating) can be exercised
 * deterministically against simulated runs — in tests, in replay and in
 * sandboxed evaluation.
 *
 * WHAT THIS IS NOT: evidence fabrication. Every simulated record carries
 * provenance — simulated: true, the simulator version and the exact seed —
 * and simulated records are NEVER presented as intervention evidence. The
 * promotion gate (@sos-2/promotion) rejects them loudly: simulation is
 * EVALUATION infrastructure, not intervention evidence (docs/
 * implementation/TESTING-AND-EVIDENCE.md layer-6 semantics; pinned by
 * tests in both packages).
 *
 * DETERMINISM CONTRACT (pinned by property tests):
 *   - the PRNG is a documented 32-bit mulberry32 seeded with the exact
 *     input seed (no ambient entropy, no hidden clocks);
 *   - the PRNG stream is consumed in a FIXED order: arms in design order,
 *     metrics in design order, samples in index order;
 *   - identical input (experiment + effects + seed + sample count) yields
 *     BIT-IDENTICAL results across runs, processes and platforms (IEEE-754
 *     double arithmetic with a fixed operation order);
 *   - normal samples use the Box-Muller transform over two PRNG draws per
 *     sample.
 *
 * The simulator honors availability OVERRIDES per metric (to exercise the
 * truth-state discipline: UNKNOWN, UNAVAILABLE, ... outcomes), and every
 * outcome obeys the result-record contract (valueless states carry null
 * values).
 */

import { ExperimentError } from './errors.js';
import type { ExperimentArtifact } from './artifact.js';
import { createExperimentResult } from './results.js';
import type { CreateExperimentResultInput, MetricOutcome } from './results.js';
import type { Producer } from '@sos-2/provenance';
import { isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';

/** The simulator identity (recorded in every simulated record's provenance). */
export const SIMULATOR_VERSION = '@sos-2/experiments:simulator@1';

/**
 * A declared effect parameter: the true mean and observation noise for one
 * (arm, metric) pair. Declared parameters are the simulation's ground
 * truth — the evaluation layer never sees them.
 */
export interface ArmMetricEffect {
  arm_id: string;
  metric_id: string;
  /** The true mean under the declared effect. */
  true_mean: number;
  /** Observation noise standard deviation (>= 0). */
  noise_std: number;
}

export interface SimulateExperimentInput {
  /** The experiment whose design is simulated. */
  experiment: ExperimentArtifact;
  /** Declared effect parameters — EXACTLY one per (arm, metric) pair of the design. */
  effects: ArmMetricEffect[];
  /** The fixed seed (non-negative integer). Identical seed + input -> bit-identical results. */
  seed: number;
  /** How many allocation units to simulate per arm (positive integer). */
  samples_per_arm: number;
  /** RFC3339 observation instant (caller-supplied; no hidden clocks). */
  observed_at: string;
  /** Provenance entries for the simulated result (non-empty). */
  provenance: string[];
  /** WHO/WHAT ran the simulation. */
  producer: Producer;
  /**
   * Per-metric availability overrides (metric id -> truth state), to
   * exercise the truth-state discipline. Overriding a metric to
   * UNKNOWN/UNAVAILABLE/UNSUPPORTED yields valueless outcomes.
   */
  availability_overrides?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// The PRNG (mulberry32 — documented, public-domain, fixed behavior)
// ---------------------------------------------------------------------------

/**
 * mulberry32: a 32-bit seeded PRNG returning floats in [0, 1). Chosen for
 * determinism, speed and a documented, platform-independent definition.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const SMALLEST_POSITIVE = 2 ** -32;

/** One normal(0, 1) sample via Box-Muller over two PRNG draws. */
function standardNormal(rng: () => number): number {
  let u1 = rng();
  if (u1 === 0) {
    u1 = SMALLEST_POSITIVE; // ln(0) is undefined; clamp deterministically
  }
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---------------------------------------------------------------------------
// Validation of simulation input
// ---------------------------------------------------------------------------

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

/** Validate the simulation input (throws ExperimentError). */
export function assertValidSimulationInput(value: SimulateExperimentInput): void {
  if (!isPlainObject(value)) {
    throw new ExperimentError('simulation input must be an object');
  }
  if (value.experiment === undefined || value.experiment === null) {
    throw new ExperimentError('simulation input requires an experiment');
  }
  if (!Array.isArray(value.effects) || value.effects.length === 0) {
    throw new ExperimentError('effects must be a non-empty array of declared effect parameters');
  }
  const arms = value.experiment.content.design.allocation.arms;
  const metrics = value.experiment.content.design.metrics;
  const expectedPairs = arms.length * metrics.length;
  if (value.effects.length !== expectedPairs) {
    throw new ExperimentError(
      `effects must contain EXACTLY one entry per (arm, metric) pair of the design ` +
        `(${arms.length} arms x ${metrics.length} metrics = ${expectedPairs}), received: ${value.effects.length}`,
    );
  }
  const seen = new Set<string>();
  for (const effect of value.effects) {
    if (!isPlainObject(effect) || Object.keys(effect).length !== 4) {
      throw new ExperimentError('effect parameters must have the exact field set { arm_id, metric_id, true_mean, noise_std }');
    }
    if (typeof effect.arm_id !== 'string' || typeof effect.metric_id !== 'string') {
      throw new ExperimentError('effect arm_id and metric_id must be strings');
    }
    if (!arms.some((arm) => arm.id === effect.arm_id)) {
      throw new ExperimentError(`effect references unknown arm: ${JSON.stringify(effect.arm_id)}`);
    }
    if (!metrics.some((metric) => metric.id === effect.metric_id)) {
      throw new ExperimentError(`effect references unknown metric: ${JSON.stringify(effect.metric_id)}`);
    }
    const key = `${effect.arm_id}\u0000${effect.metric_id}`;
    if (seen.has(key)) {
      throw new ExperimentError(`duplicate effect for (arm ${effect.arm_id}, metric ${effect.metric_id}) rejected`);
    }
    seen.add(key);
    if (!isFiniteNumber(effect.true_mean)) {
      throw new ExperimentError(`true_mean must be a finite number, received: ${JSON.stringify(effect.true_mean)}`);
    }
    if (typeof effect.noise_std !== 'number' || !Number.isFinite(effect.noise_std) || effect.noise_std < 0) {
      throw new ExperimentError(`noise_std must be a finite number >= 0, received: ${JSON.stringify(effect.noise_std)}`);
    }
  }
  if (!isNonNegativeInteger(value.seed)) {
    throw new ExperimentError(`seed must be a non-negative integer, received: ${JSON.stringify(value.seed)}`);
  }
  if (!isPositiveInteger(value.samples_per_arm)) {
    throw new ExperimentError(
      `samples_per_arm must be a positive integer, received: ${JSON.stringify(value.samples_per_arm)}`,
    );
  }
  if (!isNonEmptyStringArray(value.provenance)) {
    throw new ExperimentError('provenance must be a non-empty array of non-empty strings');
  }
  if (value.availability_overrides !== undefined) {
    if (!isPlainObject(value.availability_overrides)) {
      throw new ExperimentError('availability_overrides must be an object metric_id -> truth state');
    }
    for (const [metricId, availability] of Object.entries(value.availability_overrides)) {
      if (!metrics.some((metric) => metric.id === metricId)) {
        throw new ExperimentError(`availability override references unknown metric: ${JSON.stringify(metricId)}`);
      }
      if (!isEvidenceTruthState(availability)) {
        throw new ExperimentError(
          `availability override must be one of the 6 truth states, received: ${JSON.stringify(availability)}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The simulator
// ---------------------------------------------------------------------------

/**
 * Run a deterministic simulation of an experiment.
 *
 * The PRNG stream is consumed in a FIXED order: arms in design order,
 * metrics in design order, samples in index order (two PRNG draws per
 * sample via Box-Muller). The observed value of each (arm, metric) is the
 * arithmetic mean of the per-sample observations.
 *
 * The produced record is marked simulated: true with the simulator version
 * and the exact seed — evaluation infrastructure, never intervention
 * evidence.
 */
export function simulateExperiment(input: SimulateExperimentInput): ReturnType<typeof createSimulatedResult> {
  return createSimulatedResult(input);
}

/** Alias documenting the return type of the simulator. */
export type SimulatedResult = ReturnType<typeof simulateExperiment>;

function createSimulatedResult(input: SimulateExperimentInput) {
  assertValidSimulationInput(input);
  const rng = mulberry32(input.seed);
  const arms = input.experiment.content.design.allocation.arms;
  const metrics = input.experiment.content.design.metrics;
  const overrides = input.availability_overrides ?? {};

  const outcomes: MetricOutcome[] = [];
  for (const arm of arms) {
    for (const metric of metrics) {
      const effect = input.effects.find(
        (entry) => entry.arm_id === arm.id && entry.metric_id === metric.id,
      )!;
      let sum = 0;
      for (let i = 0; i < input.samples_per_arm; i += 1) {
        sum += effect.true_mean + effect.noise_std * standardNormal(rng);
      }
      const mean = sum / input.samples_per_arm;
      const override = overrides[metric.id];
      let availability: EvidenceTruthState = 'SUCCESS';
      if (override !== undefined && isEvidenceTruthState(override)) {
        availability = override;
      }
      const valueless =
        availability === 'UNKNOWN' || availability === 'UNAVAILABLE' || availability === 'UNSUPPORTED';
      outcomes.push({
        metric_id: metric.id,
        arm_id: arm.id,
        value: valueless ? null : mean,
        availability,
      });
    }
  }

  const resultInput: CreateExperimentResultInput = {
    experiment_id: input.experiment.envelope.id,
    observed_at: input.observed_at,
    sample_size: input.samples_per_arm * arms.length,
    outcomes,
    provenance: [...input.provenance],
    producer: { ...input.producer },
    simulator: { version: SIMULATOR_VERSION, seed: input.seed },
  };
  return createExperimentResult(input.experiment, resultInput);
}
