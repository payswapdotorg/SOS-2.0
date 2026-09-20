/**
 * Typed objectives over the §11 behavioral dimensions
 * (spec/architecture.md §11: "Maintain high-performing alternatives across
 * meaningful behavioral dimensions such as cost, latency, resilience,
 * privacy, resource footprint, topology, operational complexity,
 * customization and human comprehensibility").
 *
 * AXIS VOCABULARY (consumed, never duplicated): the objective axes are the
 * NINE §11 dimensions exported by @sos-2/packages (DIVERSITY_DIMENSIONS).
 * This package adds NO new axis names.
 *
 * SIX CORE SCALAR AXES with FROZEN natural directions (the W7 brief's
 * objective list): COST (MINIMIZE), LATENCY (MINIMIZE), RESILIENCE
 * (MAXIMIZE), PRIVACY (MAXIMIZE), RESOURCE_FOOTPRINT (MINIMIZE),
 * HUMAN_COMPREHENSIBILITY (MAXIMIZE). A TypedObjective on one of these axes
 * MUST use the frozen direction — flipping it is rejected.
 *
 * The remaining §11 dimensions (TOPOLOGY, OPERATIONAL_COMPLEXITY,
 * CUSTOMIZATION) have no scalar direction frozen by the architecture; a
 * caller MAY optimize over them by declaring the direction explicitly per
 * objective (documented extension point — the caller owns that semantics).
 */

import { isDiversityDimension, DIVERSITY_DIMENSIONS } from '@sos-2/packages';
import type { DiversityDimension } from '@sos-2/packages';
import { OptimizationError } from './errors.js';

/** Objective direction: MINIMIZE (lower is better) or MAXIMIZE (higher is better). */
export const OBJECTIVE_DIRECTIONS = ['MINIMIZE', 'MAXIMIZE'] as const;

export type ObjectiveDirection = (typeof OBJECTIVE_DIRECTIONS)[number];

const DIRECTION_SET: ReadonlySet<string> = new Set(OBJECTIVE_DIRECTIONS);

export function isObjectiveDirection(value: unknown): value is ObjectiveDirection {
  return typeof value === 'string' && DIRECTION_SET.has(value);
}

/** The objective axes are the §11 dimension vocabulary (imported from @sos-2/packages). */
export type ObjectiveAxis = DiversityDimension;

/** The six core scalar optimization axes with frozen natural directions (see module doc). */
export const CORE_OPTIMIZATION_AXES = [
  'COST',
  'LATENCY',
  'RESILIENCE',
  'PRIVACY',
  'RESOURCE_FOOTPRINT',
  'HUMAN_COMPREHENSIBILITY',
] as const;

export type CoreOptimizationAxis = (typeof CORE_OPTIMIZATION_AXES)[number];

/**
 * The frozen directions of the six core axes (spec/architecture.md §11
 * natural readings; the W7 brief's objective list). Immutable.
 */
export const FROZEN_OBJECTIVE_DIRECTIONS: Readonly<Record<CoreOptimizationAxis, ObjectiveDirection>> =
  Object.freeze({
    COST: 'MINIMIZE',
    LATENCY: 'MINIMIZE',
    RESILIENCE: 'MAXIMIZE',
    PRIVACY: 'MAXIMIZE',
    RESOURCE_FOOTPRINT: 'MINIMIZE',
    HUMAN_COMPREHENSIBILITY: 'MAXIMIZE',
  });

const CORE_AXIS_SET: ReadonlySet<string> = new Set(CORE_OPTIMIZATION_AXES);

/** Is this one of the six core axes with a frozen direction? */
export function isCoreOptimizationAxis(axis: string): axis is CoreOptimizationAxis {
  return CORE_AXIS_SET.has(axis);
}

/** One typed objective: a value on a §11 axis with an explicit direction. */
export interface TypedObjective {
  /** A §11 behavioral dimension (vocabulary from @sos-2/packages). */
  axis: ObjectiveAxis;
  /** MINIMIZE or MAXIMIZE (must match the frozen direction on core axes). */
  direction: ObjectiveDirection;
  /** The estimated/measured value on the axis (finite). */
  value: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate one typed objective (throws OptimizationError). */
export function assertValidTypedObjective(value: unknown): asserts value is TypedObjective {
  if (!isPlainObject(value)) {
    throw new OptimizationError(`typed objective must be an object { axis, direction, value }, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !('axis' in record) || !('direction' in record) || !('value' in record)) {
    throw new OptimizationError('typed objective must have the exact field set { axis, direction, value }');
  }
  if (!isDiversityDimension(record['axis'])) {
    throw new OptimizationError(
      `objective axis must be one of the §11 dimensions (${DIVERSITY_DIMENSIONS.join(', ')}, imported from ` +
        `@sos-2/packages), received: ${JSON.stringify(record['axis'])}`,
    );
  }
  if (!isObjectiveDirection(record['direction'])) {
    throw new OptimizationError(
      `objective direction must be MINIMIZE or MAXIMIZE, received: ${JSON.stringify(record['direction'])}`,
    );
  }
  const axis = record['axis'];
  const direction = record['direction'];
  const objectiveValue = record['value'];
  if (isCoreOptimizationAxis(axis)) {
    const frozen = FROZEN_OBJECTIVE_DIRECTIONS[axis];
    if (direction !== frozen) {
      throw new OptimizationError(
        `objective axis ${axis} has the frozen direction ${frozen} (spec/architecture.md §11); ` +
          `flipping it to ${JSON.stringify(direction)} is rejected`,
      );
    }
  }
  if (typeof objectiveValue !== 'number' || !Number.isFinite(objectiveValue)) {
    throw new OptimizationError(`objective value must be a finite number, received: ${JSON.stringify(objectiveValue)}`);
  }
}

/** Predicate form of assertValidTypedObjective. */
export function isValidTypedObjective(value: unknown): value is TypedObjective {
  try {
    assertValidTypedObjective(value);
    return true;
  } catch {
    return false;
  }
}

/** Is value `a` at least as good as `b` on one objective (direction-aware)? */
export function atLeastAsGood(a: TypedObjective, b: TypedObjective): boolean {
  assertComparableAxes(a, b);
  return a.direction === 'MINIMIZE' ? a.value <= b.value : a.value >= b.value;
}

/** Is value `a` STRICTLY better than `b` on one objective (direction-aware)? */
export function strictlyBetter(a: TypedObjective, b: TypedObjective): boolean {
  assertComparableAxes(a, b);
  return a.direction === 'MINIMIZE' ? a.value < b.value : a.value > b.value;
}

function assertComparableAxes(a: TypedObjective, b: TypedObjective): void {
  if (a.axis !== b.axis || a.direction !== b.direction) {
    throw new OptimizationError(
      `objectives are comparable only on the same axis AND direction, received ${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
    );
  }
}
