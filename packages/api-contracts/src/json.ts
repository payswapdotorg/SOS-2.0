/**
 * JSON value vocabulary for the API boundary (Work Order P2).
 *
 * This package has ZERO runtime dependencies, so it carries its own
 * structural JsonValue type (structurally identical to the spine's — a
 * plain JSON value; the canonical SERIALIZATION authority remains
 * @sos-2/semantic-spine, consumed by @sos-2/live-store, never redefined
 * here). The guard below is a boundary-level structural check: it accepts
 * exactly the values the spine's canonicalizer would accept (finite
 * numbers, plain objects, no undefined), so a payload that passes here can
 * never surprise the canonical layer later.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isJsonValueImpl(value: unknown, depth: number): value is JsonValue {
  if (depth > 64) {
    return false;
  }
  if (value === null) {
    return true;
  }
  const type = typeof value;
  if (type === 'boolean' || type === 'string') {
    return true;
  }
  if (type === 'number') {
    return Number.isFinite(value);
  }
  if (type === 'object') {
    if (Array.isArray(value)) {
      return value.every((entry) => isJsonValueImpl(entry, depth + 1));
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return false;
    }
    return Object.entries(value as Record<string, unknown>).every(
      ([key, entry]) => key.length > 0 && entry !== undefined && isJsonValueImpl(entry, depth + 1),
    );
  }
  return false;
}

/**
 * Structural check: a plain JSON value (null/boolean/finite number/string/
 * array/plain object, recursively — no undefined, no class instances, no
 * non-finite numbers, no symbol/function/bigint).
 */
export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueImpl(value, 0);
}

/** Structural check for a plain JSON object (non-array, non-null). */
export function isJsonObject(value: unknown): value is { [key: string]: JsonValue } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return isJsonValueImpl(value, 0);
}
