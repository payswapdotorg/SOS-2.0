/**
 * Cloudflare R2 bucket/prefix layout contract (Work Order P3).
 *
 * R2 Free holds large immutable evidence/import/report objects. Semantic
 * metadata and content hashes remain in the durable semantic layer (Neon);
 * R2 holds the OBJECTS. The contract fixes:
 *
 *   - a single free-tier bucket with tier-isolated prefixes:
 *     production/, preview/<slug>/ (isolated preview prefix) and local/;
 *   - purposes (evidence, imports, reports) under each prefix;
 *   - IMMUTABLE OBJECT RULES: objects are write-once — overwrite-mode
 *     operations are typed-rejected; keys are content-anchored (the object
 *     name carries a content anchor); deletion happens only through the
 *     documented retention path;
 *   - preview prefix isolation: an object key may never cross tier
 *     prefixes (a preview key referencing production/ — or any path
 *     traversal — is typed-rejected).
 *
 * Pure data + pure functions; no process.env, no network, no clock.
 */

import { InfraDeploymentError, type EnvironmentTier } from '../core/types.ts';

/** Object purposes (frozen vocabulary). */
export type R2ObjectPurpose = 'evidence' | 'imports' | 'reports';

export const R2_OBJECT_PURPOSES: readonly R2ObjectPurpose[] = ['evidence', 'imports', 'reports'] as const;

/** Tier prefix roots (the isolation seam). */
export function r2TierPrefix(tier: EnvironmentTier): string {
  switch (tier) {
    case 'production':
      return 'production';
    case 'preview':
      return 'preview/default';
    case 'local':
      return 'local';
  }
}

/** The IMMUTABLE OBJECT RULES, encoded and machine-checkable. */
export const R2_IMMUTABILITY_CONTRACT = {
  provider: 'r2',
  rule: 'objects are write-once immutable artifacts',
  writeMode: 'create-only — an operation targeting an EXISTING key in overwrite mode is typed-rejected',
  contentAnchoring:
    'object names carry a content anchor (e.g. sha256 hex) so identical content maps to identical keys and re-writes are unnecessary by construction',
  metadata:
    'semantic metadata and content hashes live in the durable semantic layer (Neon); R2 holds the bytes',
  retention:
    'deletion happens only through the documented retention policy; no ad-hoc delete from request paths',
} as const;

/** A reference to an R2 object operation (what the immutability gate checks). */
export interface R2ObjectOperation {
  readonly provider: 'r2';
  readonly tier: EnvironmentTier;
  readonly purpose: R2ObjectPurpose;
  readonly key: string;
  readonly mode: 'create' | 'overwrite';
  readonly contentAnchor: string;
}

/** Builds the canonical object key for a tier/purpose/name. */
export function r2ObjectKey(tier: EnvironmentTier, purpose: R2ObjectPurpose, name: string): string {
  assertPlainObjectName(name);
  return `${r2TierPrefix(tier)}/${purpose}/${name}`;
}

/** Rejects malformed object names (path traversal, emptiness, control chars). */
export function assertPlainObjectName(name: string): void {
  if (name.length === 0) {
    throw new InfraDeploymentError('R2 object name must be non-empty');
  }
  if (name.includes('..') || name.includes('//') || name.startsWith('/') || name.endsWith('/')) {
    throw new InfraDeploymentError(
      `R2 object name '${name}' is malformed (path traversal or empty segments are rejected)`,
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new InfraDeploymentError(
      `R2 object name '${name}' violates the naming convention (alphanumerics, dot, underscore, dash)`,
    );
  }
}

/**
 * The immutability + isolation gate for one operation:
 *   - overwrite mode => typed rejection (write-once rule);
 *   - key outside the operation's tier prefix => typed rejection
 *     (preview isolation: a preview operation may never touch
 *     production/, and vice versa);
 *   - keys must carry a content anchor (enforced shape: hex, length >= 8).
 */
export function assertR2ObjectOperation(operation: R2ObjectOperation): void {
  if (operation.mode === 'overwrite') {
    throw new InfraDeploymentError(
      `R2 operation on key '${operation.key}' uses overwrite mode — objects are write-once immutable (create-only; content-anchored keys make overwrites unnecessary)`,
    );
  }
  const expectedPrefix = `${r2TierPrefix(operation.tier)}/`;
  if (!operation.key.startsWith(expectedPrefix)) {
    throw new InfraDeploymentError(
      `R2 key '${operation.key}' is outside the tier-${operation.tier} prefix '${expectedPrefix}' — tier prefix isolation forbids cross-tier object references`,
    );
  }
  if (!/^[a-f0-9]{8,}$/.test(operation.contentAnchor)) {
    throw new InfraDeploymentError(
      `R2 operation on key '${operation.key}' lacks a valid content anchor (hex, >= 8 chars) — immutability is anchored to content identity`,
    );
  }
}

/**
 * Cross-tier reference gate: no key from one tier's prefix space may be
 * referenced by a configuration for another tier. Used by the environment
 * isolation layer on derived resource footprints.
 */
export function assertR2KeyBelongsToTier(key: string, tier: EnvironmentTier): void {
  const expectedPrefix = `${r2TierPrefix(tier)}/`;
  if (!key.startsWith(expectedPrefix)) {
    throw new InfraDeploymentError(
      `R2 key '${key}' does not belong to tier '${tier}' (expected prefix '${expectedPrefix}') — cross-tier object references are typed-rejected`,
    );
  }
  // Belt and braces: a preview key must never point into production/ at all.
  if (tier === 'preview' && key.startsWith('production/')) {
    throw new InfraDeploymentError(
      `R2 key '${key}' references the production prefix from the preview tier — preview must NEVER mutate production`,
    );
  }
}

/** Regions allowed for the R2 contract ('auto' is the free-tier default). */
export const R2_REGIONS = ['auto', 'wnam', 'enam', 'weur', 'eeur', 'apac'] as const;
export type R2Region = (typeof R2_REGIONS)[number];
export const R2_DEFAULT_REGION: R2Region = 'auto';
