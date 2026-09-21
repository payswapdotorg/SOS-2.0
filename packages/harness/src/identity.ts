/**
 * Harness identity (Work Order P5).
 *
 * A harness/body identity names a REPLACEABLE EXECUTION MECHANISM — it is
 * NEVER a SOS semantic identity (spec/productization-requirements.md:
 * "Harness/provider identities are not semantic identities"). The runtime
 * identifier discipline is consumed from @sos-2/runtime-contracts: a
 * spine-shaped (sos://) harness id is rejected loudly.
 *
 * The PROVIDER block (vendor name/version) is provenance metadata only:
 * it records who built the body and is never a selection key, never an
 * identity, never an authority.
 */

import { InvalidHarnessContractError } from './errors.js';
import { assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';

/** Vendor provenance of a harness — metadata ONLY, never identity/authority. */
export interface HarnessProviderInfo {
  /** Vendor/provider name (e.g. "acme-runners") — provenance only. */
  readonly name: string;
  /** Provider version string. */
  readonly version: string;
}

/** Where a body runs (§7 user device model). */
export const HARNESS_PLACEMENTS = ['cloud', 'remote', 'user-device'] as const;
export type HarnessPlacement = (typeof HARNESS_PLACEMENTS)[number];

const PLACEMENT_SET: ReadonlySet<string> = new Set(HARNESS_PLACEMENTS);

/** The provider-neutral identity a harness answers identity() with. */
export interface HarnessIdentity {
  /** Harness identity — a RUNTIME identifier, never a semantic identity. */
  readonly harness_id: string;
  /** Vendor provenance — metadata only. */
  readonly provider: HarnessProviderInfo;
  /** Execution placement (§7: cloud/remote bodies work while the user device is off). */
  readonly placement: HarnessPlacement;
}

const IDENTITY_NAMESPACE = 'harness-identity';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** Validate a harness identity (throws InvalidHarnessContractError). */
export function assertValidHarnessIdentity(value: unknown): asserts value is HarnessIdentity {
  if (!isPlainObject(value) || !hasExactKeys(value, ['harness_id', 'provider', 'placement'])) {
    throw new InvalidHarnessContractError(
      IDENTITY_NAMESPACE,
      'harness identity must have the exact field set { harness_id, provider, placement }',
    );
  }
  try {
    assertValidRuntimeIdentifier(value['harness_id'], 'harness identity harness_id');
  } catch (cause) {
    throw new InvalidHarnessContractError(IDENTITY_NAMESPACE, (cause as Error).message);
  }
  const provider = value['provider'];
  if (
    !isPlainObject(provider) ||
    !hasExactKeys(provider, ['name', 'version']) ||
    typeof provider['name'] !== 'string' ||
    provider['name'].length === 0 ||
    typeof provider['version'] !== 'string' ||
    provider['version'].length === 0
  ) {
    throw new InvalidHarnessContractError(
      IDENTITY_NAMESPACE,
      `harness identity provider must be { name, version } (non-empty strings; vendor provenance metadata only), received: ${JSON.stringify(provider)}`,
    );
  }
  if (typeof value['placement'] !== 'string' || !PLACEMENT_SET.has(value['placement'])) {
    throw new InvalidHarnessContractError(
      IDENTITY_NAMESPACE,
      `harness identity placement must be one of ${HARNESS_PLACEMENTS.join(', ')}, received: ${JSON.stringify(value['placement'])}`,
    );
  }
}
