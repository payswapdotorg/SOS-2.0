/**
 * Provider-health payloads (Work Order P2 — the truthful failure model).
 *
 * Per docs/deployment/free-tier-plan.md the target topology is Neon
 * (durable), Upstash (coordination only — NEVER canonical) and Cloudflare R2
 * (immutable artifacts). Until real provider adapters are attached in later
 * waves, every provider reports a TYPED availability:
 *
 *   AVAILABLE    a configured provider answered its probe
 *   UNAVAILABLE  a configured provider failed (never fabricated success)
 *   UNKNOWN      no provider is configured / availability cannot be
 *                determined (the in-memory reference backend is exactly this)
 *
 * These three states are operational availability states, deliberately
 * distinct from the six frozen evidence truth states; UNAVAILABLE and
 * UNKNOWN are never conflated and never silently upgraded to AVAILABLE.
 */

export const PROVIDER_NAMES = ['postgres', 'redis', 'object-store'] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

const PROVIDER_NAME_SET: ReadonlySet<string> = new Set(PROVIDER_NAMES);

export const PROVIDER_AVAILABILITIES = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'] as const;

export type ProviderAvailability = (typeof PROVIDER_AVAILABILITIES)[number];

const PROVIDER_AVAILABILITY_SET: ReadonlySet<string> = new Set(PROVIDER_AVAILABILITIES);

/** Health of one provider adapter, as reported by the health endpoint. */
export interface ProviderHealthPayload {
  provider: ProviderName;
  /** The provider's documented role, e.g. "durable-canonical-state". */
  role: string;
  status: ProviderAvailability;
  /** Human-readable explanation, or null. */
  detail: string | null;
}

/** The full health report (GET /health). */
export interface HealthReportPayload {
  providers: ProviderHealthPayload[];
  /** Report generation instant, RFC3339 (injected clock at the API boundary). */
  generated_at: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural check for one provider-health payload. */
export function isProviderHealthPayload(value: unknown): value is ProviderHealthPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  const actual = Object.keys(value);
  if (actual.length !== 4) {
    return false;
  }
  if (!actual.every((key) => key === 'provider' || key === 'role' || key === 'status' || key === 'detail')) {
    return false;
  }
  if (typeof value['provider'] !== 'string' || !PROVIDER_NAME_SET.has(value['provider'])) {
    return false;
  }
  if (typeof value['role'] !== 'string' || (value['role'] as string).length === 0) {
    return false;
  }
  if (typeof value['status'] !== 'string' || !PROVIDER_AVAILABILITY_SET.has(value['status'])) {
    return false;
  }
  return value['detail'] === null || typeof value['detail'] === 'string';
}

/** Structural check for the health report payload. */
export function isHealthReportPayload(value: unknown): value is HealthReportPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  const actual = Object.keys(value);
  if (actual.length !== 2) {
    return false;
  }
  if (!actual.includes('providers') || !actual.includes('generated_at')) {
    return false;
  }
  if (!Array.isArray(value['providers'])) {
    return false;
  }
  if (!value['providers'].every((entry) => isProviderHealthPayload(entry))) {
    return false;
  }
  return typeof value['generated_at'] === 'string';
}
