/**
 * Canonical view-model serialization — deterministic snapshot/hashing support
 * for the W11 determinism discipline ("same fixtures -> byte-identical
 * rendered output, tested via snapshot or hash of the rendered view-model
 * projections").
 *
 * The serializer is the SPINE's canonical JSON serializer (CONSUMED, never
 * re-implemented): sorted object keys, no whitespace, defined NaN handling.
 * View-models are plain JSON data by construction, so the spine serializer
 * is total on them.
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import { createHash } from 'node:crypto';
import { UIContractError } from './errors.js';

/** Canonical JSON text of a view-model (or any JSON value). Deterministic. */
export function canonicalVMJson(vm: unknown): string {
  return canonicalSerialize(vm);
}

/** sha-256 hex digest of the canonical serialization of a view-model. */
export function vmHash(vm: unknown): string {
  return createHash('sha256').update(canonicalVMJson(vm)).digest('hex');
}

/**
 * Canonical round trip: serialize -> parse -> serialize produces IDENTICAL
 * text (the projection determinism / canonical round-trip property pinned
 * by W11 property tests). Throws UIContractError when the round trip is not
 * stable (never the case for plain-JSON view-models).
 */
export function canonicalRoundTripStable(vm: unknown): boolean {
  const first = canonicalVMJson(vm);
  let parsed: unknown;
  try {
    parsed = JSON.parse(first);
  } catch (cause) {
    throw new UIContractError(
      `view-model is not JSON-round-trippable: ${(cause as Error).message}`,
    );
  }
  return canonicalVMJson(parsed) === first;
}
