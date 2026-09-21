/**
 * Upstash Redis namespace configuration contract (Work Order P3).
 *
 * Upstash Redis Free provides short-lived acceleration and coordination
 * ONLY: cache, idempotency, rate limiting, leases and lightweight queue
 * coordination. Redis is NEVER CANONICAL — that rule is not a comment, it
 * is an encoded, machine-checked contract:
 *
 *   - every namespace declaration carries canonical: false;
 *   - a declaration that claims canonicity is typed-rejected
 *     (assertNeverCanonical) — Redis keys may never be the sole home of
 *     semantic state; semantic writes always land in the durable store
 *     (Neon) first, Redis entries are derivable and ephemeral;
 *   - namespaces are tier-prefixed (sos:production:*, sos:preview:*,
 *     sos:local:*) so a preview environment can never share a Redis
 *     namespace with production (the isolation seam);
 *   - every namespace carries a bounded TTL policy — Redis data is
 *     short-lived by contract, with retention bounds per purpose.
 *
 * Pure data + pure functions; no process.env, no network, no clock.
 */

import { InfraDeploymentError, type EnvironmentTier } from '../core/types.ts';

/** Coordination purposes of the free-tier plan (frozen vocabulary). */
export type UpstashNamespacePurpose = 'cache' | 'idempotency' | 'rate-limit' | 'leases' | 'queue';

export const UPSTASH_NAMESPACE_PURPOSES: readonly UpstashNamespacePurpose[] = [
  'cache',
  'idempotency',
  'rate-limit',
  'leases',
  'queue',
] as const;

/**
 * The NEVER-CANONICAL rule, encoded. A namespace declaration that sets
 * canonical: true anywhere in this package's typed surface is rejected.
 */
export const UPSTASH_NEVER_CANONICAL_CONTRACT = {
  provider: 'upstash',
  rule: 'Redis/queues are never canonical (spec/productization-requirements.md product rules)',
  enforcement:
    'every Redis namespace declaration must carry canonical: false; a declaration claiming canonicity is typed-rejected before any key is written',
  durableWrites:
    'all semantic writes go to the durable store (Neon) first; Redis entries are derivable, ephemeral acceleration/coordination data',
  recovery:
    'losing the entire Redis database must never lose semantic state — it only costs a cold cache / re-acquired leases / replayed idempotency checks',
} as const;

/** A namespace declaration (the unit the never-canonical rule applies to). */
export interface UpstashNamespaceDeclaration {
  readonly provider: 'upstash';
  readonly namespace: string;
  readonly purpose: UpstashNamespacePurpose;
  readonly canonical: false;
  readonly ttlMs: number;
}

/** TTL policy per purpose (bounded — Redis data is short-lived by contract). */
export const UPSTASH_TTL_POLICY_MS: Readonly<Record<UpstashNamespacePurpose, number>> = {
  cache: 5 * 60_000,
  idempotency: 24 * 60 * 60_000,
  'rate-limit': 60_000,
  leases: 60_000,
  queue: 60 * 60_000,
};

/** Tier prefix for every namespace (the isolation seam). */
export function upstashTierPrefix(tier: EnvironmentTier): string {
  return `sos:${tier}`;
}

/** Fully-qualified namespace for a purpose in a tier. */
export function upstashNamespace(tier: EnvironmentTier, purpose: UpstashNamespacePurpose): string {
  return `${upstashTierPrefix(tier)}:${purpose}`;
}

/** The full namespace set for a tier, in purpose order. */
export function upstashNamespacesForTier(tier: EnvironmentTier): readonly UpstashNamespaceDeclaration[] {
  return UPSTASH_NAMESPACE_PURPOSES.map((purpose) => ({
    provider: 'upstash' as const,
    namespace: upstashNamespace(tier, purpose),
    purpose,
    canonical: false as const,
    ttlMs: UPSTASH_TTL_POLICY_MS[purpose],
  }));
}

/** Key prefix inside a namespace (convention: sos:<tier>:<purpose>:<key>). */
export function upstashKeyPrefix(tier: EnvironmentTier, purpose: UpstashNamespacePurpose): string {
  return `${upstashNamespace(tier, purpose)}:`;
}

/**
 * NEVER-CANONICAL gate: rejects any namespace declaration that claims
 * canonicity, and validates the TTL bound and tier-prefixed naming. This
 * is the rule later waves must consume before creating any Redis client
 * configuration. Violations are typed and loud — never a warning.
 */
export function assertNeverCanonical(declaration: UpstashNamespaceDeclaration): void {
  if ((declaration as { canonical?: boolean }).canonical === true) {
    throw new InfraDeploymentError(
      `Redis namespace '${declaration.namespace}' declares canonical: true — Redis is NEVER canonical; semantic state lives in the durable store (Neon) and Redis entries are derivable/ephemeral`,
    );
  }
  if (declaration.ttlMs <= 0 || !Number.isFinite(declaration.ttlMs)) {
    throw new InfraDeploymentError(
      `Redis namespace '${declaration.namespace}' must declare a positive finite TTL (bounded lifetime is part of the never-canonical contract)`,
    );
  }
  if (declaration.namespace !== upstashNamespace(tierOfNamespace(declaration.namespace), declaration.purpose)) {
    throw new InfraDeploymentError(
      `Redis namespace '${declaration.namespace}' violates the tier-prefixed naming convention sos:<tier>:<purpose>`,
    );
  }
}

/** Extracts the tier segment of a namespace string (deterministic parse). */
export function tierOfNamespace(namespace: string): EnvironmentTier {
  const match = /^sos:(local|preview|production):/.exec(namespace);
  if (match === null) {
    throw new InfraDeploymentError(`namespace '${namespace}' is not tier-prefixed (sos:<tier>:<purpose>)`);
  }
  return match[1] as EnvironmentTier;
}

/** Regions allowed for the Upstash contract. */
export const UPSTASH_REGIONS = ['global', 'us-east-1', 'us-west-1', 'eu-central-1'] as const;
export type UpstashRegion = (typeof UPSTASH_REGIONS)[number];
export const UPSTASH_DEFAULT_REGION: UpstashRegion = 'global';
