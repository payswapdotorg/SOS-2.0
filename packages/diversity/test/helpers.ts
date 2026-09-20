/**
 * Shared test fixtures for @sos-2/diversity tests.
 *
 * All spine identities are minted deterministically through the sanctioned
 * minters (never invented by hand).
 */

import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { CarriedUncertainty } from '@sos-2/optimization';
import type { DiversityEntry, MapElitesSpec } from '../src/index.js';

/** Deterministic package ids for the population (never invented by hand). */
export function packageId(seed: string): string {
  return deriveDeterministicArtifactId('Package', { note: 'w13 diversity test package', seed });
}

/** Deterministic composition ids for the population. */
export function compositionId(seed: string): string {
  return deriveDeterministicArtifactId('PackageComposition', { note: 'w13 diversity test composition', seed });
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
      note: 'w13 diversity test calibration',
      brier_score: 0.11,
    }),
  };
}

/** A cost x latency sub-space spec (two of the nine §11 axes). */
export const COST_LATENCY_SPEC: MapElitesSpec = {
  dimensions: [
    { axis: 'cost', edges: [100, 1000] },
    { axis: 'latency', edges: [50, 200] },
  ],
};

/** A behavior record over the cost x latency spec. */
export function costLatencyBehavior(cost: number, latency: number): Record<string, number> {
  return { cost, latency };
}

/** A population entry builder (package population by default). */
export function entry(
  seed: string,
  family: string,
  fitness: number,
  behavior: Record<string, number>,
  uncertainty: CarriedUncertainty = qualitativeUncertainty(),
  kind: 'Package' | 'PackageComposition' = 'Package',
): DiversityEntry {
  return {
    id: kind === 'Package' ? packageId(seed) : compositionId(seed),
    family,
    fitness,
    behavior,
    uncertainty,
  };
}
