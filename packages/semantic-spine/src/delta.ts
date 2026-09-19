/**
 * Architecture Delta builder/validator.
 *
 * Layering (documented):
 *   - contracts layer: schema-faithful shape (architecture-delta.schema.json).
 *   - spine layer (this module): an Architecture Delta must actually affect
 *     something and preserve something — `affected_artifacts` and
 *     `preserved_invariants` must be present AND non-empty, and every entry
 *     must be a non-empty string. Optional arrays (added/removed/modified/
 *     boundary_changes) may be empty when present.
 */

import { isArchitectureDelta } from '@sos-2/contracts';
import type { ArchitectureDelta } from '@sos-2/contracts';
import { ArchitectureDeltaError } from './errors.js';

export interface BuildArchitectureDeltaInput {
  affected_artifacts: string[];
  preserved_invariants: string[];
  added?: string[];
  removed?: string[];
  modified?: string[];
  boundary_changes?: string[];
  rationale_ref?: string | null;
  work_order?: string;
}

function requireNonEmptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ArchitectureDeltaError(`${field} must be a non-empty array (a delta without ${field} is rejected)`);
  }
  if (!value.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    throw new ArchitectureDeltaError(`${field} entries must be non-empty strings`);
  }
  return [...value];
}

function optionalNonEmptyStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    throw new ArchitectureDeltaError(`${field} must be an array of non-empty strings`);
  }
  return [...value];
}

/** Build a valid ArchitectureDelta. Rejects deltas without affected artifacts or preserved invariants. */
export function buildArchitectureDelta(input: BuildArchitectureDeltaInput): ArchitectureDelta {
  if (typeof input !== 'object' || input === null) {
    throw new ArchitectureDeltaError('architecture delta input must be an object');
  }
  const delta: ArchitectureDelta = {
    affected_artifacts: requireNonEmptyStringArray(input.affected_artifacts, 'affected_artifacts'),
    preserved_invariants: requireNonEmptyStringArray(input.preserved_invariants, 'preserved_invariants'),
  };
  const added = optionalNonEmptyStringArray(input.added, 'added');
  if (added !== undefined) {
    delta.added = added;
  }
  const removed = optionalNonEmptyStringArray(input.removed, 'removed');
  if (removed !== undefined) {
    delta.removed = removed;
  }
  const modified = optionalNonEmptyStringArray(input.modified, 'modified');
  if (modified !== undefined) {
    delta.modified = modified;
  }
  const boundaryChanges = optionalNonEmptyStringArray(input.boundary_changes, 'boundary_changes');
  if (boundaryChanges !== undefined) {
    delta.boundary_changes = boundaryChanges;
  }
  if (input.rationale_ref !== undefined) {
    if (input.rationale_ref !== null && (typeof input.rationale_ref !== 'string' || input.rationale_ref.length === 0)) {
      throw new ArchitectureDeltaError('rationale_ref must be a non-empty string or null');
    }
    delta.rationale_ref = input.rationale_ref;
  }
  if (input.work_order !== undefined) {
    if (typeof input.work_order !== 'string' || input.work_order.length === 0) {
      throw new ArchitectureDeltaError('work_order must be a non-empty string');
    }
    delta.work_order = input.work_order;
  }
  assertValidArchitectureDelta(delta);
  return delta;
}

/** Full semantic validation with a specific error message (throws ArchitectureDeltaError). */
export function assertValidArchitectureDelta(value: unknown): asserts value is ArchitectureDelta {
  if (!isArchitectureDelta(value)) {
    throw new ArchitectureDeltaError(
      'value does not match the architecture delta contract (spec/contracts/architecture-delta.schema.json; additional properties are forbidden)',
    );
  }
  if (value.affected_artifacts.length === 0) {
    throw new ArchitectureDeltaError('architecture delta requires at least one affected artifact');
  }
  if (value.preserved_invariants.length === 0) {
    throw new ArchitectureDeltaError('architecture delta requires at least one preserved invariant');
  }
  for (const field of [
    'affected_artifacts',
    'added',
    'removed',
    'modified',
    'preserved_invariants',
    'boundary_changes',
  ] as const) {
    const list = value[field];
    if (list !== undefined && !list.every((entry) => entry.length > 0)) {
      throw new ArchitectureDeltaError(`${field} entries must be non-empty strings`);
    }
  }
}

/** Predicate form of assertValidArchitectureDelta. */
export function validateArchitectureDelta(value: unknown): value is ArchitectureDelta {
  try {
    assertValidArchitectureDelta(value);
    return true;
  } catch {
    return false;
  }
}
