/**
 * Shared test fixtures for @sos-2/optimization tests.
 */

import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { CarriedUncertainty } from '../src/index.js';
import type { EliteCandidate, MapElitesSpec, ParetoCandidate, TypedObjective } from '../src/index.js';

export function candidateId(seed: string): string {
  return deriveDeterministicArtifactId('CandidateState', { note: 'w7 optimization test candidate', seed });
}

/** A qualitative (uncalibrated) carried-uncertainty payload. */
export function qualitativeUncertainty(sampleSize = 3): CarriedUncertainty {
  return { uncertainty_class: 'MODERATE', sample_size: sampleSize };
}

/** A calibrated carried-uncertainty payload (numeric + calibration ref, §12 discipline). */
export function calibratedUncertainty(probability: number, sampleSize: number): CarriedUncertainty {
  return {
    uncertainty_class: 'MODERATE',
    sample_size: sampleSize,
    calibrated_probability: probability,
    calibration_ref: deriveDeterministicArtifactId('Evaluation', {
      note: 'w7 optimization test calibration',
      brier_score: 0.09,
    }),
  };
}

/** The standard two-axis objective set: COST (min) x LATENCY (min). */
export function costLatency(cost: number, latency: number): TypedObjective[] {
  return [
    { axis: 'COST', direction: 'MINIMIZE', value: cost },
    { axis: 'LATENCY', direction: 'MINIMIZE', value: latency },
  ];
}

/** The resilience trade-off objective set: COST (min) x RESILIENCE (max). */
export function costResilience(cost: number, resilience: number): TypedObjective[] {
  return [
    { axis: 'COST', direction: 'MINIMIZE', value: cost },
    { axis: 'RESILIENCE', direction: 'MAXIMIZE', value: resilience },
  ];
}

export function paretoCandidate(
  seed: string,
  family: string,
  objectives: TypedObjective[],
  uncertainty: CarriedUncertainty = qualitativeUncertainty(),
): ParetoCandidate {
  return { id: candidateId(seed), family, objectives, uncertainty };
}

/** A two-axis behavior spec: latency (ms edges) x cost (USD edges). */
export const TWO_AXIS_SPEC: MapElitesSpec = {
  dimensions: [
    { axis: 'latency_ms', edges: [50, 100] },
    { axis: 'monthly_cost', edges: [100, 500] },
  ],
};

export function elite(
  seed: string,
  family: string,
  fitness: number,
  behavior: Record<string, number>,
  uncertainty: CarriedUncertainty = qualitativeUncertainty(),
): EliteCandidate {
  return { id: candidateId(seed), family, fitness, behavior, uncertainty };
}
