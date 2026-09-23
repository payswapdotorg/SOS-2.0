/**
 * Shared vocabulary for the P9 action gateway. Dependency-free by design.
 *
 * Binding to the merged core happens through the ports defined in this
 * package and is wired at the composition root (apps/actions). The ports
 * mirror the documented core disciplines:
 *   - Clock           -> injected time (apps/worker-runtimes system-clock precedent)
 *   - AuthorityPort   -> current-grant evaluation (@sos-2/authority)
 *   - DurableEventLog -> idempotent, replay-protected ingestion (@sos-2/live-store)
 *   - EvidenceSink    -> provenance-bound evidence (@sos-2/evidence + @sos-2/provenance)
 */

export type Timestamp = number;

export interface ActorRef {
  readonly kind: 'body' | 'human' | 'system';
  readonly id: string;
}

export interface SourceRevisionRef {
  readonly kind: 'source';
  readonly sha: string;
}

export type RevisionRef =
  | SourceRevisionRef
  | { readonly kind: 'deployment'; readonly id: string; readonly sourceSha: string };

/** Injected time. Library code never reads ambient time. */
export interface Clock {
  now(): Timestamp;
}

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

/** Domain-separated content address, e.g. `action-evidence:<16 hex>`. */
export function contentAddress(value: unknown, domain: string): string {
  return `${domain}:${fnv1a64(`${domain}|${canonicalJson(value)}`)}`;
}
