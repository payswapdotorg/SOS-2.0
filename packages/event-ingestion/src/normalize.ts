/**
 * Normalization — external envelopes become P2 ObservationEventInput
 * records.
 *
 * The durable event id is composed DETERMINISTICALLY from
 * (source, externalId): the same externally-delivered event normalizes to
 * the same id forever, which is exactly what makes replay protection
 * work across redelivery storms (GitHub retries webhooks; CI buses
 * re-emit). The payload is preserved VERBATIM (canonical-JSON): truth
 * states inside payloads (e.g. an UNAVAILABLE telemetry capture) survive
 * normalization bit-exact and are never folded into success or zero
 * (the P2 opaque-payload rule).
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import type { ObservationEventInput } from '@sos-2/live-store';
import { RFC3339_PATTERN } from '@sos-2/live-store';
import type { EventSourceDescription, ExternalEventEnvelope } from './sources.js';
import { EventIngestionError } from './errors.js';

/**
 * The deterministic replay-protection id: `${source}:${externalId}`.
 * Colons are legal in the P2 event id (it only requires non-empty
 * string); the composition is injective for well-formed source ids
 * (source ids containing ':' are fine — the split is greedy-from-left
 * only in spirit; we never need to decompose).
 */
export function composeEventId(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

/** Normalize one external envelope into a durable observation event input. */
export function normalizeExternalEvent(source: EventSourceDescription, envelope: ExternalEventEnvelope): ObservationEventInput {
  if (typeof envelope.externalId !== 'string' || envelope.externalId.length === 0) {
    throw new EventIngestionError('envelope externalId must be a non-empty string');
  }
  if (typeof envelope.kind !== 'string' || envelope.kind.length === 0) {
    throw new EventIngestionError('envelope kind must be a non-empty string');
  }
  if (typeof envelope.occurredAt !== 'string' || !RFC3339_PATTERN.test(envelope.occurredAt)) {
    throw new EventIngestionError(`envelope occurredAt must be RFC3339, received: ${JSON.stringify(envelope.occurredAt)}`);
  }
  let payload: JsonValue;
  try {
    const serialized: string = canonicalSerialize(envelope.payload);
    payload = JSON.parse(serialized) as JsonValue;
  } catch {
    throw new EventIngestionError('envelope payload must be a canonical-JSON value (canonical serialization failed)');
  }
  if (!Array.isArray(envelope.provenance) || envelope.provenance.length === 0 || envelope.provenance.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new EventIngestionError('envelope provenance must be a non-empty array of non-empty strings');
  }
  return {
    id: composeEventId(source.source, envelope.externalId),
    source: source.source,
    kind: envelope.kind,
    occurred_at: envelope.occurredAt,
    payload,
    provenance: [...envelope.provenance],
  };
}

/**
 * Normalize a raw telemetry capture (W3 @sos-2/telemetry) as an
 * observation event. The RawObservation is carried VERBATIM in the
 * payload — capture-level availability (SUCCESS/FAILURE/UNKNOWN/
 * UNAVAILABLE/UNSUPPORTED/PARTIAL) survives bit-exact; the evidence
 * layer's truth-state assignment happens later, never here.
 */
export function telemetryCaptureEvent(
  source: EventSourceDescription,
  observation: { subject_ref: string; availability: string; window: { start: string; end: string } },
  externalId: string,
  occurredAt: string,
  producerProvenance: readonly string[],
): ObservationEventInput {
  if (observation.subject_ref.length === 0) {
    throw new EventIngestionError('telemetry capture subject_ref must be non-empty');
  }
  if (observation.availability.length === 0) {
    throw new EventIngestionError('telemetry capture availability must be non-empty');
  }
  return {
    id: composeEventId(source.source, externalId),
    source: source.source,
    kind: 'telemetry.observation',
    occurred_at: occurredAt,
    payload: {
      subject_ref: observation.subject_ref,
      availability: observation.availability,
      window: { start: observation.window.start, end: observation.window.end },
    } as JsonValue,
    provenance: [...producerProvenance],
  };
}
