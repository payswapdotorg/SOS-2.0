/**
 * The deterministic deployment SIMULATOR (Work Order W12; the W9 simulator
 * discipline — @sos-2/experiments' simulator is the precedent).
 *
 * WHAT THIS IS: an in-memory deployment executor that produces typed step
 * outcomes from DECLARED scenario parameters using a FIXED-SEED PRNG. It
 * exists so deployment evaluation logic (lifecycle discipline, truth-state
 * aggregation, intervention-evidence refusal) can be exercised
 * deterministically — in tests, in replay and in sandboxed evaluation.
 *
 * WHAT THIS IS NOT: evidence fabrication, and NEVER intervention evidence.
 * Every simulated run carries its provenance — simulated: true, the
 * simulator version and the exact seed — the store refuses to record
 * simulated outcomes as real deployment status, and
 * asInterventionEvidenceInput rejects them loudly (pinned by tests).
 *
 * DETERMINISM CONTRACT (pinned by property tests):
 *   - the PRNG is the mulberry32 CONSUMED from @sos-2/experiments (the
 *     documented, platform-independent 32-bit PRNG — no re-implementation,
 *     no ambient entropy, no hidden clocks);
 *   - the stream is consumed in a FIXED order: steps in declaration order,
 *     EXACTLY three draws per step (unavailability, unknownness, success),
 *     always drawn — preserving stream alignment regardless of
 *     probabilities;
 *   - identical input (deployment + steps + seed + observed_at) yields
 *     BIT-IDENTICAL runs across runs, processes and platforms.
 *
 * STEP OUTCOME RULES (documented, deterministic):
 *   d1 < unavailable_probability -> UNAVAILABLE (a gap — no data exists)
 *   else d2 < unknown_probability -> UNKNOWN (ran, outcome undetermined)
 *   else d3 < success_probability -> SUCCESS, else FAILURE
 *
 * The overall availability is the max-severity aggregation
 * (aggregateAvailability) over the step outcomes — a run with any UNKNOWN
 * step is UNKNOWN overall, never SUCCESS or FAILURE.
 */

import { mulberry32 } from '@sos-2/experiments';
import { isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { assertValidProducer } from '@sos-2/provenance';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { DeploymentSimulationError } from './errors.js';
import { assertValidDeployment } from './record.js';
import type { DeploymentRecord } from './record.js';
import { aggregateAvailability } from './outcome.js';

/** The simulator identity (recorded in every simulated run's provenance). */
export const DEPLOYMENT_SIMULATOR_VERSION = '@sos-2/deployment:simulator@1';

/** A declared scenario step: the ground truth the evaluator never sees. */
export interface SimulatedDeploymentStep {
  /** Step name (non-empty; unique within the scenario). */
  name: string;
  /** Probability the step succeeds when it runs and is determinable ([0, 1]). */
  success_probability: number;
  /** Probability the step outcome is UNKNOWN — ran but undetermined ([0, 1]). */
  unknown_probability?: number;
  /** Probability NO DATA exists for the step (a gap; [0, 1]). */
  unavailable_probability?: number;
}

export interface SimulateDeploymentInput {
  /** The deployment being simulated. */
  deployment: DeploymentRecord;
  /** The declared scenario steps (non-empty; ground truth). */
  steps: SimulatedDeploymentStep[];
  /** The fixed seed (non-negative integer). Identical seed + input -> bit-identical run. */
  seed: number;
  /** RFC3339 observation instant (caller-supplied; no hidden clocks). */
  observed_at: string;
  /** WHO/WHAT ran the simulation. */
  producer: Producer;
}

/** One simulated step outcome. */
export interface SimulatedStepOutcome {
  /** The step's name. */
  name: string;
  /** The step's truthful availability (frozen 6 states). */
  availability: EvidenceTruthState;
}

/** A simulated deployment run — marked simulated, deterministic, never intervention evidence. */
export interface SimulatedDeploymentRun {
  /** The DeploymentRecord spine id. */
  deployment_ref: string;
  /** The exact seed used. */
  seed: number;
  /** The simulator version. */
  simulator_version: string;
  /** Step outcomes in declaration order. */
  steps: SimulatedStepOutcome[];
  /** The max-severity aggregation over the steps. */
  overall_availability: EvidenceTruthState;
  /** Degenerate window at the observation instant. */
  window: TimeWindow;
  /** Provenance: simulated:true + simulator version + seed. */
  provenance: string[];
  /** ALWAYS true — a simulated run is never intervention evidence. */
  simulated: true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function assertValidSteps(steps: SimulatedDeploymentStep[]): void {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new DeploymentSimulationError('simulated deployment steps must be a non-empty array');
  }
  const names = new Set<string>();
  for (const step of steps) {
    if (!isPlainObject(step)) {
      throw new DeploymentSimulationError('each simulated step must be an object { name, success_probability, ... }');
    }
    if (typeof step.name !== 'string' || step.name.length === 0 || names.has(step.name)) {
      throw new DeploymentSimulationError(
        `simulated step names must be non-empty and unique, received: ${JSON.stringify(step.name)}`,
      );
    }
    names.add(step.name);
    if (!isProbability(step.success_probability)) {
      throw new DeploymentSimulationError(
        `simulated step "${step.name}" success_probability must be in [0, 1], received: ${JSON.stringify(step.success_probability)}`,
      );
    }
    if (step.unknown_probability !== undefined && !isProbability(step.unknown_probability)) {
      throw new DeploymentSimulationError(
        `simulated step "${step.name}" unknown_probability must be in [0, 1] when present`,
      );
    }
    if (step.unavailable_probability !== undefined && !isProbability(step.unavailable_probability)) {
      throw new DeploymentSimulationError(
        `simulated step "${step.name}" unavailable_probability must be in [0, 1] when present`,
      );
    }
  }
}

/**
 * Simulate a deployment deterministically. The returned run is marked
 * simulated (simulated: true, simulator version + seed in provenance) and
 * is NEVER intervention evidence.
 */
export function simulateDeployment(input: SimulateDeploymentInput): SimulatedDeploymentRun {
  if (!isPlainObject(input)) {
    throw new DeploymentSimulationError('simulation input must be an object');
  }
  assertValidDeployment(input.deployment);
  assertValidSteps(input.steps);
  if (typeof input.seed !== 'number' || !Number.isInteger(input.seed) || input.seed < 0) {
    throw new DeploymentSimulationError(
      `simulation seed must be a non-negative integer, received: ${JSON.stringify(input.seed)}`,
    );
  }
  if (typeof input.observed_at !== 'string' || input.observed_at.length === 0) {
    throw new DeploymentSimulationError('simulation observed_at must be an RFC3339 timestamp (caller-supplied)');
  }
  try {
    assertValidProducer(input.producer);
  } catch (cause) {
    throw new DeploymentSimulationError(`simulation producer is invalid: ${(cause as Error).message}`);
  }

  const rng = mulberry32(input.seed);
  const steps: SimulatedStepOutcome[] = [];
  for (const step of input.steps) {
    // FIXED consumption order: three draws per step, always drawn.
    const dUnavailable = rng();
    const dUnknown = rng();
    const dSuccess = rng();
    const unavailableProbability = step.unavailable_probability ?? 0;
    const unknownProbability = step.unknown_probability ?? 0;
    let availability: EvidenceTruthState;
    if (dUnavailable < unavailableProbability) {
      availability = 'UNAVAILABLE';
    } else if (dUnknown < unknownProbability) {
      availability = 'UNKNOWN';
    } else {
      availability = dSuccess < step.success_probability ? 'SUCCESS' : 'FAILURE';
    }
    steps.push({ name: step.name, availability });
  }

  return {
    deployment_ref: input.deployment.envelope.id,
    seed: input.seed,
    simulator_version: DEPLOYMENT_SIMULATOR_VERSION,
    steps,
    overall_availability: aggregateAvailability(steps.map((step) => step.availability)),
    window: { start: input.observed_at, end: input.observed_at },
    provenance: [
      'simulated:true',
      `simulator:${DEPLOYMENT_SIMULATOR_VERSION}`,
      `seed:${input.seed}`,
      `deployment:${input.deployment.envelope.id}`,
    ],
    simulated: true,
  };
}

/** True iff this run was produced by the deterministic simulator. */
export function isSimulatedRun(value: unknown): boolean {
  return isPlainObject(value) && value['simulated'] === true && typeof value['simulator_version'] === 'string';
}

/**
 * Materialize a simulated run's step outcomes as SIMULATED DeploymentOutcome
 * records — for inspection and evaluation ONLY. Every outcome carries
 * simulated: true; the store refuses them as real status, and the
 * intervention-evidence bridge refuses them loudly.
 */
export function simulatedRunOutcomes(
  run: SimulatedDeploymentRun,
  producer: Producer,
): import('./outcome.js').DeploymentOutcome[] {
  if (!isSimulatedRun(run)) {
    throw new DeploymentSimulationError('not a simulated deployment run');
  }
  try {
    assertValidProducer(producer);
  } catch (cause) {
    throw new DeploymentSimulationError(`producer is invalid: ${(cause as Error).message}`);
  }
  return run.steps.map((step) => ({
    deployment_ref: run.deployment_ref,
    availability: step.availability,
    detail: { step: step.name, simulated_run: true },
    window: { ...run.window },
    producer: { ...producer },
    simulated: true,
  }));
}

/** Guard re-export for callers: availability values on simulated runs are always frozen states. */
export function assertSimulatedRunAvailability(value: string): asserts value is EvidenceTruthState {
  if (!isEvidenceTruthState(value)) {
    throw new DeploymentSimulationError(`simulated run carries a non-frozen availability: ${JSON.stringify(value)}`);
  }
}
