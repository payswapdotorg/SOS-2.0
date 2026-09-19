/**
 * Internal structural helpers shared by the contract guards.
 *
 * Deliberately dependency-free and total (never throw on unknown input).
 * These helpers are NOT part of the public package surface.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Every actual key is contained in the allowlist (no unknown properties). */
export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key));
}

/** All required keys are own properties of the object. */
export function hasAllKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** The key set is exactly the given key set (no more, no less). */
export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) {
    return false;
  }
  const expected = new Set(keys);
  return actual.every((key) => expected.has(key));
}

/**
 * Optional-property check that treats an explicit `undefined` value the same
 * way JSON Schema treats an absent property (so guards and ajv agree on
 * `{ foo: undefined }`, which serializes to an absent property).
 */
export function isOptionalOr(
  value: unknown,
  check: (v: unknown) => boolean,
): boolean {
  return value === undefined || check(value);
}
