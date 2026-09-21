/**
 * Runtime identifiers and the NON-SEMANTIC identity discipline (Work Order P5).
 *
 * spec/productization-requirements.md product rules: "Harness/provider
 * identities are not semantic identities." A runtime identifier names a
 * replaceable execution mechanism (a harness, a body, an integration
 * surface) — it is NEVER a Semantic Spine artifact id. The guard here makes
 * that separation LOUD: a runtime identifier that carries the spine's
 * sos://<kind>/<segment> shape is rejected, because a value shaped like a
 * semantic identity invites being used as one.
 *
 * The spine's ARTIFACT_ID_PATTERN is CONSUMED from @sos-2/semantic-spine
 * (never re-implemented) — this package re-uses the frozen pattern as the
 * rejection rule for runtime identifiers.
 */

import { ARTIFACT_ID_PATTERN } from '@sos-2/semantic-spine';
import { RuntimeContractError } from './errors.js';

/** Is this value shaped like a Semantic Spine artifact id? (Consumed pattern.) */
export function isSemanticIdShaped(value: string): boolean {
  return ARTIFACT_ID_PATTERN.test(value);
}

/**
 * Assert that `value` is a valid RUNTIME identifier: a non-empty string
 * that is NOT spine-id-shaped. Throws RuntimeContractError loudly
 * otherwise (a runtime identifier is never a semantic identity).
 */
export function assertValidRuntimeIdentifier(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RuntimeContractError('INVALID', `${what} must be a non-empty string, received: ${JSON.stringify(value)}`);
  }
  if (isSemanticIdShaped(value)) {
    throw new RuntimeContractError(
      'INVALID',
      `${what} must be a RUNTIME identifier, never a SOS semantic identity — spine-shaped ids (sos://<kind>/<segment>) are rejected: ${JSON.stringify(value)}`,
    );
  }
  if (value.includes('sos://')) {
    throw new RuntimeContractError(
      'INVALID',
      `${what} must not embed a sos:// semantic reference: ${JSON.stringify(value)} (harness/provider identity is never semantic identity)`,
    );
  }
}

/** Predicate form of assertValidRuntimeIdentifier. */
export function isValidRuntimeIdentifier(value: unknown): value is string {
  try {
    assertValidRuntimeIdentifier(value, 'runtime identifier');
    return true;
  } catch {
    return false;
  }
}
