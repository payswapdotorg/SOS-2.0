/**
 * Shared deterministic primitives for the P14 cost + reliability
 * contracts. Dependency-free by design; ALIGNED-BY-CONSTRUCTION with
 * the security package's primitives (the same canonical-JSON / FNV-1a
 * content-addressing discipline the merged P9 action-gateway uses).
 *
 * Determinism: no ambient time reads, no randomness, no network, no
 * environment reads, no ambient timers, no subprocess spawning — time is
 * injected (Clock).
 */

/** Injected time in epoch milliseconds. */
export type Timestamp = number;

/** The injected clock port (the worker-runtimes system-clock precedent). */
export interface Clock {
  now(): Timestamp;
}

/** A canonical JSON value. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Deterministic canonical JSON (sorted keys, no whitespace). */
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

/** Domain-separated content address. */
export function contentAddress(value: unknown, domain: string): string {
  return `${domain}:${fnv1a64(`${domain}|${canonicalJson(value)}`)}`;
}

/** RFC3339 formatting for an injected clock value (epoch ms). */
export function epochMsToRfc3339(epochMs: number): string {
  const ms = Math.trunc(epochMs);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`epoch milliseconds out of range, received: ${String(epochMs)}`);
  }
  return date.toISOString();
}
