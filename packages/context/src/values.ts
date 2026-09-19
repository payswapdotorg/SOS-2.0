/**
 * Dimension value validation — every context dimension is TYPED and every
 * value is machine-checked against its dimension spec.
 *
 *   text        : non-empty string
 *   number      : finite number
 *   boolean     : boolean
 *   enum        : exactly one of the dimension's (unique, non-empty) enumValues
 *   string-list : non-empty array of unique non-empty strings
 */

import { ContextError } from './errors.js';
import type { ContextDimensionSpec } from './dimensions.js';

/** Validate a value against a dimension spec (throws ContextError). */
export function validateDimensionValue(spec: ContextDimensionSpec, value: unknown): void {
  switch (spec.valueType) {
    case 'text': {
      if (typeof value !== 'string' || value.length === 0) {
        throw new ContextError(`context dimension "${spec.name}" expects a non-empty text value, received: ${JSON.stringify(value)}`);
      }
      return;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ContextError(`context dimension "${spec.name}" expects a finite number, received: ${JSON.stringify(value)}`);
      }
      return;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new ContextError(`context dimension "${spec.name}" expects a boolean, received: ${JSON.stringify(value)}`);
      }
      return;
    }
    case 'enum': {
      const allowed = spec.enumValues ?? [];
      if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new ContextError(
          `context dimension "${spec.name}" expects one of [${allowed.join(', ')}], received: ${JSON.stringify(value)}`,
        );
      }
      return;
    }
    case 'string-list': {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every((entry) => typeof entry === 'string' && entry.length > 0) ||
        new Set(value as string[]).size !== (value as string[]).length
      ) {
        throw new ContextError(
          `context dimension "${spec.name}" expects a non-empty list of unique non-empty strings, received: ${JSON.stringify(value)}`,
        );
      }
      return;
    }
    default: {
      throw new ContextError(`unknown value type on dimension "${spec.name}": ${JSON.stringify((spec as ContextDimensionSpec).valueType)}`);
    }
  }
}

/** Predicate form of validateDimensionValue. */
export function isValidDimensionValue(spec: ContextDimensionSpec, value: unknown): boolean {
  try {
    validateDimensionValue(spec, value);
    return true;
  } catch {
    return false;
  }
}
