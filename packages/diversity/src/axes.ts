/**
 * The nine §11 behavior axes of the diversity archive (Work Order W13;
 * spec/architecture.md §11: "Maintain high-performing alternatives across
 * meaningful behavioral dimensions such as cost, latency, resilience,
 * privacy, resource footprint, topology, operational complexity,
 * customization and human comprehensibility").
 *
 * The DIMENSION vocabulary is IMPORTED from @sos-2/packages
 * (DIVERSITY_DIMENSIONS — the frozen §11 vocabulary, W6 authority); this
 * module derives the canonical lowercase AXIS NAMES the archive's MAP-Elites
 * spec uses, plus a documented DEFAULT binning. Nothing here redefines the
 * §11 vocabulary — it projects it onto the QD archive's axis model
 * (@sos-2/optimization BehaviorAxisSpec, imported).
 *
 * A diversity spec may cover ANY NON-EMPTY SUBSET of the nine axes: the nine
 * are the meaningful vocabulary, and a sub-space archive is legitimate when
 * only some axes are measured — but an axis OUTSIDE the nine is REJECTED
 * (an undocumented behavioral dimension is not a diversity axis; adding one
 * is an architecture change, not an implementation choice).
 */

import { DIVERSITY_DIMENSIONS } from '@sos-2/packages';
import type { DiversityDimension } from '@sos-2/packages';
import { assertValidMapElitesSpec } from '@sos-2/optimization';
import type { MapElitesSpec } from '@sos-2/optimization';
import { DiversityError } from './errors.js';

/** The canonical lowercase axis names of the nine §11 dimensions (derived from the frozen W6 vocabulary). */
export const DIVERSITY_AXES: readonly string[] = DIVERSITY_DIMENSIONS.map((dimension) => axisOfDimension(dimension));

const DIVERSITY_AXIS_SET: ReadonlySet<string> = new Set(DIVERSITY_AXES);

/** Project a frozen §11 dimension onto its canonical archive axis name. */
export function axisOfDimension(dimension: DiversityDimension): string {
  return dimension.toLowerCase();
}

/** The frozen §11 dimension a canonical archive axis name projects back to. */
export function dimensionOfAxis(axis: string): DiversityDimension {
  const dimension = axis.toUpperCase() as DiversityDimension;
  if (!(DIVERSITY_DIMENSIONS as readonly string[]).includes(dimension)) {
    throw new DiversityError(
      `unknown diversity axis: ${JSON.stringify(axis)} (the meaningful behavioral dimensions are the nine frozen ` +
        `§11 dimensions: ${DIVERSITY_DIMENSIONS.join(', ')})`,
    );
  }
  return dimension;
}

/** Structural check: is this one of the nine canonical §11 axis names? */
export function isDiversityAxis(value: unknown): value is string {
  return typeof value === 'string' && DIVERSITY_AXIS_SET.has(value);
}

/**
 * The documented DEFAULT binning over all nine §11 axes (caller-replaceable
 * edge-for-edge; the axis vocabulary itself is not replaceable):
 *
 *   cost                     monthly USD            edges [100, 1000]
 *   latency                  p99 milliseconds       edges [50, 200]
 *   resilience               0-5 resilience score   edges [2, 4]
 *   privacy                  0-5 posture score      edges [2, 4]
 *   resource_footprint       0-5 footprint score    edges [2, 4]
 *   topology                 distinct node count    edges [5, 20]
 *   operational_complexity   0-5 complexity score   edges [2, 4]
 *   customization            0-5 customization score edges [2, 4]
 *   human_comprehensibility  0-5 comprehensibility  edges [2, 4]
 */
export function defaultDiversitySpec(): MapElitesSpec {
  return {
    dimensions: [
      { axis: 'cost', edges: [100, 1000] },
      { axis: 'latency', edges: [50, 200] },
      { axis: 'resilience', edges: [2, 4] },
      { axis: 'privacy', edges: [2, 4] },
      { axis: 'resource_footprint', edges: [2, 4] },
      { axis: 'topology', edges: [5, 20] },
      { axis: 'operational_complexity', edges: [2, 4] },
      { axis: 'customization', edges: [2, 4] },
      { axis: 'human_comprehensibility', edges: [2, 4] },
    ],
  };
}

/**
 * Validate a diversity spec: a structurally valid MAP-Elites spec
 * (delegated to @sos-2/optimization) whose axes are EXACTLY a non-empty
 * subset of the nine canonical §11 axis names.
 */
export function assertValidDiversitySpec(value: unknown): asserts value is MapElitesSpec {
  assertValidMapElitesSpec(value);
  const spec = value as MapElitesSpec;
  if (spec.dimensions.some((dimension) => !isDiversityAxis(dimension.axis))) {
    const unknown = spec.dimensions.filter((dimension) => !isDiversityAxis(dimension.axis)).map((d) => d.axis);
    throw new DiversityError(
      `diversity spec axes must be among the nine frozen §11 dimensions (${DIVERSITY_AXES.join(', ')}); ` +
        `unknown axes rejected: ${unknown.map((axis) => JSON.stringify(axis)).join(', ')} ` +
        '(adding a behavioral dimension is an architecture change, not an implementation choice)',
    );
  }
}

/** Predicate form of assertValidDiversitySpec. */
export function isValidDiversitySpec(value: unknown): value is MapElitesSpec {
  try {
    assertValidDiversitySpec(value);
    return true;
  } catch {
    return false;
  }
}
