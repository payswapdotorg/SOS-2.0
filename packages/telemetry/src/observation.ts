/**
 * Raw observations — the normalized output of telemetry ingestion.
 *
 * TELEMETRY IS INPUT, NOT SEMANTIC TRUTH. A RawObservation is a validated,
 * normalized capture of what a telemetry source saw; the assignment of an
 * evidence TRUTH STATE (what the observation MEANS about its subject) is the
 * evidence layer's job, performed there with explicit method provenance
 * (@sos-2/evidence ingestObservation).
 *
 * `availability` is CAPTURE-LEVEL availability, marked by ingestion, using
 * the 6 frozen truth states from the spine (imported — never redefined):
 *
 *   SUCCESS      the capture is a valid witness (data arrived and is usable)
 *   FAILURE      the observed signal itself reports failure (e.g. an OTel
 *                span with status ERROR, an ERROR-severity log)
 *   UNKNOWN      data arrived but cannot determine an outcome (e.g. an OTel
 *                span with status UNSET — unknown is NOT unavailable)
 *   UNAVAILABLE  no data exists for the subject/window (a GAP — never
 *                interpreted as zero or as absence-of-failure)
 *   UNSUPPORTED  the source cannot serve this subject/query kind
 *   PARTIAL      partial data (truncated batch, missing attributes)
 *
 * Identity discipline: raw observations are deliberately NOT spine
 * artifacts — they are pre-semantic input. Traceability is preserved by the
 * evidence layer, which records (source id, observation content hash,
 * window) in the evidence record's provenance chain.
 */

import { canonicalSerialize, contentHash, isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { EvidenceTruthState, JsonValue } from '@sos-2/semantic-spine';
import { assertValidProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { assertValidTimeWindow } from '@sos-2/provenance';
import type { TimeWindow } from '@sos-2/provenance';
import { TelemetryError } from './errors.js';

export interface RawObservation {
  /**
   * What the observation is about: either a well-formed spine artifact id
   * (subject already identified semantically) or a source-native subject
   * label (e.g. "otel:service:checkout") that the evidence layer maps to a
   * spine subject id at ingestion.
   */
  subject_ref: string;
  /** Capture-level availability (see module doc). One of the 6 frozen truth states. */
  availability: EvidenceTruthState;
  /** Observation time window (RFC3339, start <= end). */
  window: TimeWindow;
  /** Normalized observed payload (JSON value); null for pure gaps. */
  observed: JsonValue | null;
  /** Normalized metadata attributes (e.g. OTel resource attributes). Plain JSON object; may be empty. */
  attributes: Record<string, JsonValue>;
  /** WHO/WHAT captured this observation (tool/model/command/environment). */
  producer: Producer;
}

const RAW_OBSERVATION_KEYS = ['subject_ref', 'availability', 'window', 'observed', 'attributes', 'producer'] as const;

function isPlainJsonObject(value: unknown): value is Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}

function isJsonOrNull(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  try {
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}

/** Structural + semantic validation with a specific error message (throws TelemetryError). */
export function assertValidRawObservation(value: unknown): asserts value is RawObservation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TelemetryError('raw observation must be an object');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = new Set<string>(RAW_OBSERVATION_KEYS);
  if (actual.length !== RAW_OBSERVATION_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new TelemetryError(
      'raw observation must have the exact field set { subject_ref, availability, window, observed, attributes, producer }',
    );
  }
  if (typeof record['subject_ref'] !== 'string' || record['subject_ref'].length === 0) {
    throw new TelemetryError(`subject_ref must be a non-empty string, received: ${JSON.stringify(record['subject_ref'])}`);
  }
  if (!isEvidenceTruthState(record['availability'])) {
    throw new TelemetryError(
      `availability must be one of the 6 distinct evidence truth states, received: ${JSON.stringify(record['availability'])}`,
    );
  }
  try {
    assertValidTimeWindow(record['window']);
  } catch (cause) {
    throw new TelemetryError(`window is invalid: ${(cause as Error).message}`);
  }
  if (!isJsonOrNull(record['observed'])) {
    throw new TelemetryError('observed must be null or a JSON value (canonical serialization failed)');
  }
  if (!isPlainJsonObject(record['attributes'])) {
    throw new TelemetryError('attributes must be a plain JSON object');
  }
  for (const key of Object.keys(record['attributes'])) {
    if (key.length === 0) {
      throw new TelemetryError('attributes keys must be non-empty strings');
    }
  }
  try {
    assertValidProducer(record['producer']);
  } catch (cause) {
    throw new TelemetryError(`producer is invalid: ${(cause as Error).message}`);
  }
}

/** Predicate form of assertValidRawObservation. */
export function validateRawObservation(value: unknown): value is RawObservation {
  try {
    assertValidRawObservation(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deterministic content hash of a raw observation (full 64 lowercase hex).
 * Used for dedup keys and provenance-chain references; computed over the
 * canonical serialization of the exact observation content.
 */
export function rawObservationHash(observation: RawObservation): string {
  assertValidRawObservation(observation);
  return contentHash(observation);
}

/** Canonical serialization of a raw observation (deterministic round trips). */
export function canonicalObservationText(observation: RawObservation): string {
  assertValidRawObservation(observation);
  return canonicalSerialize(observation);
}
