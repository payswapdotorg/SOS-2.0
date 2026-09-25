/**
 * Shared deterministic primitives for the P14 security contracts.
 *
 * Dependency-free by design. The canonical-JSON serialization, FNV-1a
 * digest and domain-separated content addressing are ALIGNED-BY-
 * CONSTRUCTION with the merged P9 action-gateway discipline
 * (packages/action-gateway/src/types.ts — consumed vocabulary, never
 * redefined: this package cannot declare workspace dependencies at this
 * base without breaking the lockfile identity rule, so the small pure
 * primitives are realized here and their alignment is pinned by the
 * acceptance suite, which composes both implementations directly).
 *
 * Determinism: no ambient time reads, no randomness, no network, no
 * environment reads, no ambient timers, no subprocess spawning — time is
 * injected everywhere (Clock).
 */

/** Injected time in epoch milliseconds. Library code never reads ambient time. */
export type Timestamp = number;

/** The injected clock port (the apps/worker-runtimes system-clock precedent). */
export interface Clock {
  now(): Timestamp;
}

/** A canonical JSON value (what observation payloads are made of). */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Deterministic canonical JSON (sorted keys, no whitespace) — the spine discipline. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value) as string;
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
}

/** Deterministic FNV-1a (64-bit) hex digest; pure and offline. */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Domain-separated content address, e.g. `security-audit:<16 hex>`. */
export function contentAddress(value: unknown, domain: string): string {
  return `${domain}:${fnv1a64(`${domain}|${canonicalJson(value)}`)}`;
}

/**
 * RFC3339 timestamp formatting for an injected clock value (epoch ms) —
 * the same formatting discipline the P7 event-ingestion boundary uses.
 */
export function epochMsToRfc3339(epochMs: number): string {
  const ms = Math.trunc(epochMs);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`epoch milliseconds out of range, received: ${String(epochMs)}`);
  }
  return date.toISOString();
}

/** The RFC3339 pattern (aligned with the P2/live-store record contract). */
export const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Structural check: is this a canonical-JSON value? */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true;
  }
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry));
  if (isPlainObject(value)) {
    return Object.entries(value).every(([key, child]) => isNonEmptyString(key) && isJsonValue(child));
  }
  return false;
}
