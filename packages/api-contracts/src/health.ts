/**
 * Provider health payloads (Work Order P2).
 *
 * The typed availability model surfaced by the health endpoint. Providers
 * are ADAPTERS (docs/deployment/free-tier-plan.md provider roles); their
 * outages and configuration states remain TRUTHFUL:
 *
 *   UP            attached and serving
 *   UNCONFIGURED  no adapter attached for the production target — the
 *                 service cannot determine its state (typed UNKNOWN-class
 *                 fact, never fabricated UP, never treated as failure)
 *   UNAVAILABLE   configured but failing (the operation was NOT performed)
 *   UNKNOWN       the outcome/state cannot be determined
 *
 * The NEVER-CANONICAL rule is a first-class field: the coordination
 * provider (Redis/Upstash) reports canonical: false ALWAYS — it may cache,
 * hold idempotency keys and coordinate leases, but it is never a semantic
 * authority (spec/productization-requirements.md "Redis/queues are never
 * canonical").
 */

import { isJsonObject } from './json.js';

export const PROVIDER_AVAILABILITIES = ['UP', 'UNCONFIGURED', 'UNAVAILABLE', 'UNKNOWN'] as const;

export type ProviderAvailability = (typeof PROVIDER_AVAILABILITIES)[number];

const PROVIDER_AVAILABILITY_SET: ReadonlySet<string> = new Set(PROVIDER_AVAILABILITIES);

export function isProviderAvailability(value: unknown): value is ProviderAvailability {
  return typeof value === 'string' && PROVIDER_AVAILABILITY_SET.has(value);
}

/**
 * The typed per-provider health record. `role` documents what this provider
 * is FOR; `target` names the production provider family (Neon, Upstash,
 * Cloudflare R2) or null for the reference implementation.
 */
export interface ProviderHealthRecord {
  /** Provider identity, e.g. "postgres:memory-reference", "postgres:neon", "redis:upstash", "object-store:r2". */
  provider: string;
  /** The documented provider role (durable semantic state / coordination / large immutable artifacts). */
  role: string;
  /** Production provider family (Neon, Upstash, Cloudflare R2), or null for the in-memory reference. */
  target: string | null;
  /** Which implementation is currently serving this role. */
  implementation: string;
  /** Typed availability (UP / UNCONFIGURED / UNAVAILABLE / UNKNOWN). */
  availability: ProviderAvailability;
  /** Machine-readable sub-code (e.g. UNCONFIGURED, CONNECTION_FAILED), or null when UP. */
  code: string | null;
  /** True iff this provider is ALLOWED to hold canonical semantic state (always false for Redis). */
  canonical: boolean;
  /** Human-readable explanation (deterministic given the same state). */
  detail: string;
}

const HEALTH_KEYS = [
  'provider',
  'role',
  'target',
  'implementation',
  'availability',
  'code',
  'canonical',
  'detail',
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isProviderHealthRecord(value: unknown): value is ProviderHealthRecord {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== HEALTH_KEYS.length || !HEALTH_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (!isNonEmptyString(record['provider']) || !isNonEmptyString(record['role']) || !isNonEmptyString(record['implementation'])) {
    return false;
  }
  if (record['target'] !== null && !isNonEmptyString(record['target'])) {
    return false;
  }
  if (!isProviderAvailability(record['availability'])) {
    return false;
  }
  if (record['code'] !== null && !isNonEmptyString(record['code'])) {
    return false;
  }
  if (typeof record['canonical'] !== 'boolean') {
    return false;
  }
  return isNonEmptyString(record['detail']);
}

/**
 * The typed coordination-degradation record: the coordination layer (Redis)
 * failed during a BEST-EFFORT cache/idempotency/lease operation. The
 * semantic operation SUCCEEDED (the durable store is authoritative — Redis
 * is never canonical), but the degradation is recorded, never silently
 * dropped (never absence-of-failure).
 */
export interface CoordinationDegradationRecord {
  provider: string;
  code: string;
  degraded_operations: number;
  last_at: string;
  detail: string;
}

export function isCoordinationDegradationRecord(value: unknown): value is CoordinationDegradationRecord {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== 5 || !['provider', 'code', 'degraded_operations', 'last_at', 'detail'].every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (!isNonEmptyString(record['provider']) || !isNonEmptyString(record['code']) || !isNonEmptyString(record['detail'])) {
    return false;
  }
  if (typeof record['degraded_operations'] !== 'number' || !Number.isInteger(record['degraded_operations']) || (record['degraded_operations'] as number) < 1) {
    return false;
  }
  return isNonEmptyString(record['last_at']);
}

/** The service health response: typed per-provider availability, coordination degradation, overall status. */
export interface ServiceHealthResponse {
  status: 'UP' | 'DEGRADED';
  providers: ProviderHealthRecord[];
  coordination: CoordinationDegradationRecord[];
  checked_at: string;
}

export function isServiceHealthResponse(value: unknown): value is ServiceHealthResponse {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== 4 || !['status', 'providers', 'coordination', 'checked_at'].every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (record['status'] !== 'UP' && record['status'] !== 'DEGRADED') {
    return false;
  }
  if (!Array.isArray(record['providers']) || !record['providers'].every((entry) => isProviderHealthRecord(entry))) {
    return false;
  }
  if (!Array.isArray(record['coordination']) || !record['coordination'].every((entry) => isCoordinationDegradationRecord(entry))) {
    return false;
  }
  return isNonEmptyString(record['checked_at']);
}

/** The typed provider-availability payload used INSIDE typed availability errors. */
export interface ProviderAvailabilityRecord {
  error_kind: 'UNAVAILABLE' | 'UNKNOWN';
  provider: string;
  code: string;
  detail: string;
}

export function isProviderAvailabilityRecord(value: unknown): value is ProviderAvailabilityRecord {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== 4 || !['error_kind', 'provider', 'code', 'detail'].every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (record['error_kind'] !== 'UNAVAILABLE' && record['error_kind'] !== 'UNKNOWN') {
    return false;
  }
  return isNonEmptyString(record['provider']) && isNonEmptyString(record['code']) && isNonEmptyString(record['detail']);
}
