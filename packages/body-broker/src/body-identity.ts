/**
 * Body identity and registration (Work Order P5).
 *
 * THE TYPED SEPARATION: a body identity (harness/provider identity) is
 * NEVER a SOS semantic identity (spec/productization-requirements.md:
 * "Harness/provider identities are not semantic identities"). The
 * discipline is enforced in THREE places, all pinned by tests:
 *
 *   1. the BodyId guard rejects spine-shaped (sos://) values loudly —
 *      a value shaped like a semantic identity invites being used as one;
 *   2. the BodyRegistration type keeps the PROVIDER block (vendor
 *      name/version) as provenance metadata ONLY — it is never a
 *      selection key and never an identity;
 *   3. semantic references (mission refs, grant refs) are validated by
 *      the spine's own guards where they occur — a body id is never
 *      accepted there.
 */

import { InvalidBodyRecordError } from './errors.js';
import { assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';
import { assertValidHarnessCapabilities } from '@sos-2/harness';
import type { HarnessCapabilities, HarnessContract } from '@sos-2/harness';

/** Vendor provenance of a body — metadata ONLY, never identity/selection key. */
export interface BodyProviderInfo {
  readonly name: string;
  readonly version: string;
}

/** Where a body runs (§7 user device model). */
export const BODY_PLACEMENTS = ['cloud', 'remote', 'user-device'] as const;
export type BodyPlacement = (typeof BODY_PLACEMENTS)[number];

const PLACEMENT_SET: ReadonlySet<string> = new Set(BODY_PLACEMENTS);

/**
 * Assert that `value` is a valid BODY id: a non-empty runtime identifier
 * that is NOT spine-shaped. Throws InvalidBodyRecordError loudly.
 */
export function assertValidBodyId(value: unknown): asserts value is string {
  try {
    assertValidRuntimeIdentifier(value, 'body id');
  } catch (cause) {
    throw new InvalidBodyRecordError('body-id', (cause as Error).message);
  }
}

/** Predicate form of assertValidBodyId. */
export function isValidBodyId(value: unknown): value is string {
  try {
    assertValidBodyId(value);
    return true;
  } catch {
    return false;
  }
}

/** Body health lifecycle states (see body-health.ts for transitions). */
export const BODY_HEALTH_STATES = ['AVAILABLE', 'SUSPENDED', 'RELEASED'] as const;
export type BodyHealth = (typeof BODY_HEALTH_STATES)[number];

const HEALTH_SET: ReadonlySet<string> = new Set(BODY_HEALTH_STATES);

/** A registered body: identity + advertisement + contract handle + health. */
export interface BodyRegistration {
  /** Body identity — a RUNTIME identifier, NEVER a semantic identity. */
  readonly body_id: string;
  /** Vendor provenance — metadata ONLY, never a selection key, never identity. */
  readonly provider: BodyProviderInfo;
  /** The binding §3 capability advertisement. */
  readonly capabilities: HarnessCapabilities;
  /** Execution placement (§7). */
  readonly placement: BodyPlacement;
  /** Current health. */
  readonly health: BodyHealth;
}

/** Input for registering a body. */
export interface RegisterBodyInput {
  readonly body_id: string;
  readonly provider: BodyProviderInfo;
  readonly capabilities: HarnessCapabilities;
  readonly placement: BodyPlacement;
  /** The live harness contract handle for this body. */
  readonly harness: HarnessContract;
}

const REGISTRATION_NAMESPACE = 'body-registration';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** Validate a body registration input (throws InvalidBodyRecordError). */
export function assertValidRegisterBodyInput(value: unknown): asserts value is RegisterBodyInput {
  if (!isPlainObject(value) || !hasExactKeys(value, ['body_id', 'provider', 'capabilities', 'placement', 'harness'])) {
    throw new InvalidBodyRecordError(
      REGISTRATION_NAMESPACE,
      'body registration must have the exact field set { body_id, provider, capabilities, placement, harness }',
    );
  }
  try {
    assertValidBodyId(value['body_id']);
  } catch (cause) {
    throw new InvalidBodyRecordError(REGISTRATION_NAMESPACE, (cause as Error).message);
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
    throw new InvalidBodyRecordError(
      REGISTRATION_NAMESPACE,
      `body registration provider must be { name, version } (non-empty vendor provenance strings — metadata only), received: ${JSON.stringify(provider)}`,
    );
  }
  try {
    assertValidHarnessCapabilities(value['capabilities']);
  } catch (cause) {
    throw new InvalidBodyRecordError(REGISTRATION_NAMESPACE, (cause as Error).message);
  }
  if (typeof value['placement'] !== 'string' || !PLACEMENT_SET.has(value['placement'])) {
    throw new InvalidBodyRecordError(
      REGISTRATION_NAMESPACE,
      `body registration placement must be one of ${BODY_PLACEMENTS.join(', ')}, received: ${JSON.stringify(value['placement'])}`,
    );
  }
  if (typeof value['harness'] !== 'object' || value['harness'] === null) {
    throw new InvalidBodyRecordError(REGISTRATION_NAMESPACE, 'body registration requires a harness contract handle');
  }
}
