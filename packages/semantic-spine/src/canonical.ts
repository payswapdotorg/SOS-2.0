/**
 * Canonical JSON serialization.
 *
 * Canonical form (documented, deterministic):
 *   - object keys sorted recursively (UTF-16 code-unit order, ascending)
 *   - no insignificant whitespace
 *   - UTF-8 encoding for byte-level operations
 *   - only plain JSON values: null, booleans, finite numbers, strings,
 *     arrays, plain objects. Functions, symbols, bigints, undefined,
 *     non-finite numbers and class instances are rejected.
 *
 * BEHAVIOR ON NON-CANONICAL INPUT (documented choice: NORMALIZE):
 *   The canonicalizer accepts any JSON value and deterministically emits the
 *   canonical form. Non-canonical JSON *text* (unsorted keys, extra
 *   whitespace, equivalent number spellings) is normalized through
 *   parse -> serialize. It is NOT rejected; it is deterministically
 *   normalized. `isCanonicalText` checks whether a given text is already in
 *   canonical form.
 *
 * Round trips:
 *   serialize -> parse -> serialize is byte-identical (pinned by tests,
 *   including property-based tests with a fixed seed).
 */

import { createHash } from 'node:crypto';
import { CanonicalizationError } from './errors.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function serialize(value: unknown, path: string): string {
  if (value === null) {
    return 'null';
  }
  const type = typeof value;
  if (type === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalizationError(`non-finite number at ${path}`);
    }
    return JSON.stringify(value);
  }
  if (type === 'string') {
    return JSON.stringify(value);
  }
  if (type === 'object') {
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (let i = 0; i < value.length; i += 1) {
        parts.push(serialize(value[i], `${path}[${i}]`));
      }
      return `[${parts.join(',')}]`;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new CanonicalizationError(
        `non-plain object at ${path} (convert class instances to plain JSON values first)`,
      );
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const entry = record[key];
      if (entry === undefined) {
        throw new CanonicalizationError(`undefined property ${JSON.stringify(key)} at ${path}`);
      }
      parts.push(`${JSON.stringify(key)}:${serialize(entry, `${path}.${key}`)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new CanonicalizationError(`value of type ${type} at ${path} is not JSON`);
}

/** Serialize a JSON value to its canonical text form. Non-JSON values throw. */
export function canonicalSerialize(value: unknown): string {
  return serialize(value, '$');
}

/** UTF-8 bytes of the canonical serialization. Non-JSON values throw. */
export function canonicalBytes(value: unknown): Uint8Array {
  const text = new TextEncoder().encode(canonicalSerialize(value));
  return text;
}

/** SHA-256 content hash (full 64 lowercase hex chars) over the canonical bytes. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalSerialize(value)).digest('hex');
}

/**
 * Whether a JSON text is already in canonical form. Returns false for
 * unparseable text or non-canonical spellings (never throws).
 */
export function isCanonicalText(text: string): boolean {
  try {
    return canonicalSerialize(JSON.parse(text)) === text;
  } catch {
    return false;
  }
}
