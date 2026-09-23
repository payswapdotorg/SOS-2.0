/**
 * Shared tier vocabulary for the P14 deployment hardening contracts
 * (infra/production-hardening).
 *
 * The tier vocabulary is ALIGNED with the merged P3 environment schema
 * (infra/deployment/src/core/types.ts: 'local' | 'preview' |
 * 'production') as an INDEPENDENT typed vocabulary — document
 * alignment only, no import from infra/deployment (this tree is not a
 * workspace package and imports nothing). The equality of the two
 * vocabularies is PINNED by the acceptance suite
 * (tests/production-hardening), which imports the merged P3 module
 * directly and compares.
 *
 * Determinism: pure typed vocabulary; no ambient anything.
 */

/** The environment tiers (P3-aligned vocabulary). */
export type HardeningTier = 'local' | 'preview' | 'production';

export const HARDENING_TIERS: readonly HardeningTier[] = ['local', 'preview', 'production'] as const;

export function isHardeningTier(value: unknown): value is HardeningTier {
  return typeof value === 'string' && (HARDENING_TIERS as readonly string[]).includes(value);
}

/**
 * A tier-namespaced provider resource identity — the P3 footprint
 * discipline: identities are namespaced BY CONSTRUCTION so a preview
 * identity and a production identity can never be the same string.
 */
export interface TierResourceIdentity {
  readonly provider: string;
  readonly kind: string;
  readonly identity: string;
  readonly tier: HardeningTier;
}

/** Construct a tier-namespaced identity (preview/production can never collide). */
export function tierIdentity(provider: string, kind: string, name: string, tier: HardeningTier): TierResourceIdentity {
  return { provider, kind, identity: `${provider}:${kind}:${tier}:${name}`, tier };
}

/** Typed error for hardening-contract violations (fail-closed). */
export class HardeningContractError extends Error {
  constructor(message: string) {
    super(`[deployment-hardening] ${message}`);
    this.name = 'HardeningContractError';
  }
}

/** Structural helper shared by the contract validators. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
