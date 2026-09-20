/**
 * Runtime observations — the typed, evidence-shaped record every execution
 * emits (Work Order W12: "RUNTIME FEEDS SYSTEM STATE AND EVIDENCE").
 *
 * WHAT THIS IS: the observation record of ONE execution against a declared
 * runtime: truthful availability (the frozen 6 states, verbatim — an
 * operation that returned is SUCCESS, one that threw is FAILURE, never
 * conflated), the operation's output, the execution window, the producer,
 * the grant that authorized the run, and the trace links binding the
 * executed subject to the SystemState revision it observed (OBSERVES, or
 * VERIFIES for assurance-verification executions).
 *
 * WHAT THIS IS NOT: a mutation of System State. Runtime observations are
 * INPUT to reconciliation — they reference the observed SystemState
 * revision by its spine id and carry no write path of any kind (the host
 * structurally cannot mutate state; pinned by tests).
 *
 * Identity discipline: observations are deliberately NOT spine artifacts
 * (the @sos-2/telemetry RawObservation precedent — pre-semantic input). The
 * observation id is a deterministic 64-hex content hash over the canonical
 * observation content (minus the id), computed with the spine's serializer;
 * identical executions yield identical ids.
 */

import { canonicalSerialize, contentHash, isArtifactId, isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { EvidenceTruthState, JsonValue, TraceLink } from '@sos-2/semantic-spine';
import { isTimeWindow, validateProducer } from '@sos-2/provenance';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import type { RawObservation } from '@sos-2/telemetry';
import type { RuntimeKind } from './descriptor.js';
import { RuntimeObservationError } from './errors.js';

/** A runtime observation — evidence-shaped, truthful, reconciliation input. */
export interface RuntimeObservation {
  /** Deterministic content hash id (64 lowercase hex; sha-256 over the canonical content minus the id). */
  id: string;
  /** The runtime that executed (descriptor id). */
  runtime_id: string;
  /** The runtime substrate kind. */
  runtime_kind: RuntimeKind;
  /** The runtime version. */
  runtime_version: string;
  /** The declared operation that was executed. */
  operation: string;
  /** Truthful outcome of the execution (the frozen 6 states, verbatim). */
  availability: EvidenceTruthState;
  /** The operation's output (JSON), or null when failed/none. */
  output: JsonValue | null;
  /** Non-null error description iff the operation threw or its output was unusable. */
  error: string | null;
  /** The execution time window (caller-supplied; no hidden clocks). */
  window: TimeWindow;
  /** WHO/WHAT executed (the host's producer). */
  producer: Producer;
  /** Spine artifact id of the executed subject (candidate), or null. */
  subject_ref: string | null;
  /** Spine SystemState artifact id of the revision observed, or null. */
  observed_system_state: string | null;
  /** The grant that authorized the execution (spine id). */
  grant_ref: string;
  /** OBSERVES/VERIFIES trace links emitted by this execution (spine-validated). */
  trace_links: TraceLink[];
}

const OBSERVATION_KEYS = [
  'id',
  'runtime_id',
  'runtime_kind',
  'runtime_version',
  'operation',
  'availability',
  'output',
  'error',
  'window',
  'producer',
  'subject_ref',
  'observed_system_state',
  'grant_ref',
  'trace_links',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** Full semantic validation of a runtime observation (throws RuntimeObservationError). */
export function assertValidRuntimeObservation(value: unknown): asserts value is RuntimeObservation {
  if (!isPlainObject(value)) {
    throw new RuntimeObservationError('runtime observation must be an object');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = new Set<string>(OBSERVATION_KEYS);
  if (actual.length !== OBSERVATION_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new RuntimeObservationError(
      `runtime observation must have the exact field set { ${OBSERVATION_KEYS.join(', ')} }`,
    );
  }
  if (typeof record['id'] !== 'string' || !/^[0-9a-f]{64}$/.test(record['id'])) {
    throw new RuntimeObservationError(`observation id must be 64 lowercase hex chars, received: ${JSON.stringify(record['id'])}`);
  }
  for (const field of ['runtime_id', 'runtime_version', 'operation'] as const) {
    if (typeof record[field] !== 'string' || (record[field] as string).length === 0) {
      throw new RuntimeObservationError(`observation ${field} must be a non-empty string`);
    }
  }
  if (!isEvidenceTruthState(record['availability'])) {
    throw new RuntimeObservationError(
      `observation availability must be one of the 6 distinct truth states, received: ${JSON.stringify(record['availability'])}`,
    );
  }
  if (!isJsonOrNull(record['output'])) {
    throw new RuntimeObservationError('observation output must be null or a JSON value');
  }
  if (record['error'] !== null && (typeof record['error'] !== 'string' || (record['error'] as string).length === 0)) {
    throw new RuntimeObservationError('observation error must be null or a non-empty string');
  }
  if (!isTimeWindow(record['window'])) {
    throw new RuntimeObservationError('observation window must be a valid time window');
  }
  try {
    validateProducer(record['producer']);
  } catch (cause) {
    throw new RuntimeObservationError(`observation producer is invalid: ${(cause as Error).message}`);
  }
  for (const field of ['subject_ref', 'observed_system_state'] as const) {
    if (record[field] !== null && !isArtifactId(record[field])) {
      throw new RuntimeObservationError(
        `observation ${field} must be null or a well-formed spine artifact id, received: ${JSON.stringify(record[field])}`,
      );
    }
  }
  if (typeof record['grant_ref'] !== 'string' || !isArtifactId(record['grant_ref'])) {
    throw new RuntimeObservationError(
      `observation grant_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['grant_ref'])}`,
    );
  }
  if (!Array.isArray(record['trace_links']) || !record['trace_links'].every((link) => isPlainObject(link))) {
    throw new RuntimeObservationError('observation trace_links must be an array of trace links');
  }
  for (const link of record['trace_links']) {
    const typed = link as Record<string, unknown>;
    if (typed['type'] !== 'OBSERVES' && typed['type'] !== 'VERIFIES') {
      throw new RuntimeObservationError(
        `observation trace link type must be OBSERVES or VERIFIES, received: ${JSON.stringify(typed['type'])}`,
      );
    }
  }
}

/** Predicate form of assertValidRuntimeObservation. */
export function validateRuntimeObservation(value: unknown): value is RuntimeObservation {
  try {
    assertValidRuntimeObservation(value);
    return true;
  } catch {
    return false;
  }
}

/** The exact content a runtime observation id is derived from (id removed). */
function observationContent(observation: Omit<RuntimeObservation, 'id'>): Record<string, unknown> {
  return structuredClone(observation) as unknown as Record<string, unknown>;
}

/** Derive the deterministic observation id (sha-256 over canonical content minus the id). */
export function runtimeObservationId(content: Omit<RuntimeObservation, 'id'>): string {
  return contentHash(observationContent(content));
}

/** Deterministic content hash of a full observation (dedup/provenance). */
export function runtimeObservationHash(observation: RuntimeObservation): string {
  assertValidRuntimeObservation(observation);
  return contentHash(observationContent(observation));
}

/** Canonical serialization of an observation (deterministic round trips). */
export function canonicalObservationText(observation: RuntimeObservation): string {
  assertValidRuntimeObservation(observation);
  return canonicalSerialize(observation);
}

/**
 * Bridge a runtime observation into a @sos-2/telemetry RawObservation so the
 * merged evidence layer (ingestObservation) can mint evidence from it. The
 * availability is carried VERBATIM — never reinterpreted.
 */
export function toRawObservation(observation: RuntimeObservation): RawObservation {
  assertValidRuntimeObservation(observation);
  return {
    subject_ref:
      observation.subject_ref ?? `runtime:${observation.runtime_id}`,
    availability: observation.availability,
    window: { ...observation.window },
    observed: {
      operation: observation.operation,
      runtime_id: observation.runtime_id,
      runtime_kind: observation.runtime_kind,
      runtime_version: observation.runtime_version,
      output: observation.output,
      error: observation.error,
      grant_ref: observation.grant_ref,
      observed_system_state: observation.observed_system_state,
      trace_links: observation.trace_links,
    } as unknown as RawObservation['observed'],
    attributes: {
      runtime_id: observation.runtime_id,
      runtime_kind: observation.runtime_kind,
      runtime_version: observation.runtime_version,
      operation: observation.operation,
      grant_ref: observation.grant_ref,
      ...(observation.observed_system_state === null
        ? {}
        : { observed_system_state: observation.observed_system_state }),
    },
    producer: { ...observation.producer },
  };
}
