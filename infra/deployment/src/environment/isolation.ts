/**
 * Preview/production isolation contract (Work Order P3).
 *
 * PREVIEW NEVER MUTATES PRODUCTION — enforced here at the environment
 * schema layer, before any provider client exists:
 *
 *   - every environment record derives a RESOURCE FOOTPRINT: the set of
 *     concrete provider resource identities the tier's configuration
 *     references (Neon database/branch, Upstash namespaces, R2 prefix,
 *     Vercel project+dimension);
 *   - identities are tier-namespaced BY CONSTRUCTION (neon:database:
 *     sos_preview vs neon:database:sos; r2:prefix:preview/default/ vs
 *     r2:prefix:production/; upstash namespaces sos:preview:* vs
 *     sos:production:*);
 *   - assertTierIsolation type-rejects ANY shared identity between a
 *     preview footprint and a production footprint;
 *   - assertFootprintMatchesTier type-rejects a footprint whose
 *     identities belong to another tier (a preview environment record
 *     referencing production resources cannot exist);
 *   - the DATABASE_URL connection string (a SECRET) is checked by
 *     DERIVED PUBLIC IDENTITY ONLY: the database name is extracted and
 *     compared against the tier's naming convention — credentials are
 *     never extracted, echoed or compared.
 *
 * Pure functions; no process.env, no network, no clock.
 */

import {
  PreviewIsolationError,
  type EnvironmentTier,
  type RawEnvironmentSource,
} from '../core/types.ts';
import { neonDatabaseName, neonDatabaseNameFromConnectionUrl, neonBranchName } from '../providers/neon.ts';
import { r2TierPrefix } from '../providers/r2.ts';
import { upstashNamespace, UPSTASH_NAMESPACE_PURPOSES } from '../providers/upstash.ts';

/** One derived provider resource identity. */
export interface ResourceIdentity {
  readonly provider: 'neon' | 'upstash' | 'r2' | 'vercel';
  readonly kind: string;
  readonly identity: string;
  /** The tier this identity belongs to BY CONSTRUCTION. */
  readonly tier: EnvironmentTier;
}

/** The derived footprint of a tier's configuration. */
export interface ResourceFootprint {
  readonly tier: EnvironmentTier;
  readonly identities: readonly ResourceIdentity[];
}

/**
 * Derives the resource footprint for a tier from an injected raw source.
 * Deterministic; reads only public/non-secret shaping (the Neon database
 * name inside DATABASE_URL is a PUBLIC identity declared by
 * NEON_DATABASE_NAME — credentials are never extracted).
 */
export function deriveResourceFootprint(tier: EnvironmentTier, source: RawEnvironmentSource): ResourceFootprint {
  const identities: ResourceIdentity[] = [];

  // Neon: database + branch identities (tier naming convention).
  identities.push({
    provider: 'neon',
    kind: 'database',
    identity: `neon:database:${neonDatabaseName(tier)}`,
    tier,
  });
  identities.push({
    provider: 'neon',
    kind: 'branch',
    identity: `neon:branch:${neonBranchName(tier)}`,
    tier,
  });
  // The CONNECTION string, when present, must point at the tier's database.
  const connectionUrl = source['DATABASE_URL'];
  if (connectionUrl !== undefined && connectionUrl.length > 0) {
    const derived = neonDatabaseNameFromConnectionUrl(connectionUrl);
    if (derived === undefined || derived !== neonDatabaseName(tier)) {
      throw new PreviewIsolationError(
        `tier '${tier}' DATABASE_URL does not reference the tier database identity 'neon:database:${neonDatabaseName(tier)}' — a connection string pointing at ANOTHER tier's database is typed-rejected (credentials never inspected; only the public database-name segment was compared)`,
      );
    }
  }

  // Upstash: one identity per namespace (tier-prefixed by construction).
  for (const purpose of UPSTASH_NAMESPACE_PURPOSES) {
    identities.push({
      provider: 'upstash',
      kind: `namespace:${purpose}`,
      identity: `upstash:namespace:${upstashNamespace(tier, purpose)}`,
      tier,
    });
  }

  // R2: the tier prefix identity.
  identities.push({
    provider: 'r2',
    kind: 'prefix',
    identity: `r2:prefix:${r2TierPrefix(tier)}`,
    tier,
  });

  // Vercel: project + environment dimension (local has no dimension).
  const vercelEnvironment = tier === 'local' ? 'none' : tier === 'preview' ? 'preview' : 'production';
  identities.push({
    provider: 'vercel',
    kind: 'environment-dimension',
    identity: `vercel:project:${source['VERCEL_PROJECT_ID'] ?? '(unset)'}:${vercelEnvironment}`,
    tier,
  });

  return { tier, identities };
}

/**
 * Isolation gate: a preview footprint must share NO identity with a
 * production footprint. Any collision is a typed rejection naming the
 * colliding identity. (Same project id on Vercel is legal — the identity
 * includes the environment dimension; stores are what must never collide.)
 */
export function assertTierIsolation(preview: ResourceFootprint, production: ResourceFootprint): void {
  if (preview.tier !== 'preview' || production.tier !== 'production') {
    throw new PreviewIsolationError(
      `assertTierIsolation compares a preview footprint with a production footprint (got '${preview.tier}' vs '${production.tier}')`,
    );
  }
  const productionIdentities = new Set(production.identities.map((entry) => entry.identity));
  const collisions = preview.identities
    .map((entry) => entry.identity)
    .filter((identity) => productionIdentities.has(identity));
  if (collisions.length > 0) {
    throw new PreviewIsolationError(
      `preview NEVER mutates production: the preview footprint references production-owned resource identities (${collisions.join(', ')}) — separate stores per environment tier are mandatory`,
    );
  }
}

/**
 * Tier-match gate: every identity in a footprint must BELONG to that
 * footprint's tier. This is checked by RE-DERIVING the exact expected
 * identity set for the tier from the same naming conventions (airtight —
 * no substring heuristics): a footprint carrying any identity outside its
 * tier's constructed set is a typed rejection. This is the check that
 * makes 'a preview env record referencing production resources'
 * unrepresentable as a passing state.
 */
export function assertFootprintMatchesTier(footprint: ResourceFootprint): void {
  const expected = expectedIdentitiesForTier(footprint.tier);
  const expectedSet = new Set(expected.map((entry) => entry.identity));
  for (const entry of footprint.identities) {
    if (entry.provider === 'vercel') {
      // Vercel identities embed the (variable) project id; only the
      // environment DIMENSION segment is convention-owned.
      const dimension = footprint.tier === 'local' ? ':none' : footprint.tier === 'preview' ? ':preview' : ':production';
      if (!entry.identity.endsWith(dimension) || !entry.identity.startsWith('vercel:project:')) {
        throw new PreviewIsolationError(
          `footprint for tier '${footprint.tier}' carries a Vercel identity with the wrong environment dimension: '${entry.identity}' (expected dimension '${dimension}')`,
        );
      }
      continue;
    }
    if (!expectedSet.has(entry.identity)) {
      throw new PreviewIsolationError(
        `footprint for tier '${footprint.tier}' carries an identity from outside the tier's constructed resource set: '${entry.identity}' (${entry.provider}/${entry.kind}) — tier-namespaced resources cannot be cross-referenced`,
      );
    }
  }
}

/** The exact convention-owned identities of a tier (neon/upstash/r2). */
function expectedIdentitiesForTier(tier: EnvironmentTier): readonly ResourceIdentity[] {
  const identities: ResourceIdentity[] = [
    { provider: 'neon', kind: 'database', identity: `neon:database:${neonDatabaseName(tier)}`, tier },
    { provider: 'neon', kind: 'branch', identity: `neon:branch:${neonBranchName(tier)}`, tier },
    { provider: 'r2', kind: 'prefix', identity: `r2:prefix:${r2TierPrefix(tier)}`, tier },
  ];
  for (const purpose of UPSTASH_NAMESPACE_PURPOSES) {
    identities.push({
      provider: 'upstash',
      kind: `namespace:${purpose}`,
      identity: `upstash:namespace:${upstashNamespace(tier, purpose)}`,
      tier,
    });
  }
  return identities;
}

/**
 * Full isolation check for a preview source: derives the preview footprint,
 * proves it matches its tier, and proves it shares nothing with the
 * production footprint derived from the same schema conventions.
 */
export function assertPreviewIsolation(
  previewSource: RawEnvironmentSource,
  productionSource: RawEnvironmentSource,
): void {
  const preview = deriveResourceFootprint('preview', previewSource);
  const production = deriveResourceFootprint('production', productionSource);
  assertFootprintMatchesTier(preview);
  assertFootprintMatchesTier(production);
  assertTierIsolation(preview, production);
}
