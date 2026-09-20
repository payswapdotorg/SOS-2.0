/**
 * JSON value discipline for adapter payloads — consumed from the spine's
 * canonical serializer (the single serialization authority). A value is a
 * JsonValue iff the spine can canonically serialize it.
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { AdapterError } from './errors.js';

/** Structural + serialization check: is this a canonical-serializable JSON value? */
export function isJsonValue(value: unknown): value is JsonValue {
  try {
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}

/** Loud form (throws AdapterError). */
export function assertValidJsonValue(value: unknown): asserts value is JsonValue {
  if (!isJsonValue(value)) {
    throw new AdapterError(
      `value is not a JSON payload (the spine's canonical serializer rejected it): ${String(value)}`,
    );
  }
}

/** Canonical text of a JSON value (spine serializer; deterministic). */
export function canonicalJsonText(value: JsonValue): string {
  return canonicalSerialize(value);
}
