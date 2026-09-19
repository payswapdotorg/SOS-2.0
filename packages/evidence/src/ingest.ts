/**
 * Telemetry ingestion — the evidence layer's truth-state assignment from raw
 * observations (Work Order W3).
 *
 * TELEMETRY IS INPUT, NOT SEMANTIC TRUTH (@sos-2/telemetry). The assignment
 * of an evidence TRUTH STATE — what the observation MEANS about its subject —
 * happens HERE, in the evidence layer, with EXPLICIT method provenance
 * recorded on every minted record:
 *
 *   TELEMETRY_INGEST_METHOD = 'telemetry:capture-availability'
 *
 * The built-in mapping is VERBATIM: the observation's capture-level
 * availability becomes the evidence truth state, one-to-one, with no
 * reinterpretation. In particular (spec/architecture-lock.md, forbidden
 * shortcut "unavailable telemetry interpreted as zero"):
 *
 *   UNAVAILABLE stays UNAVAILABLE — a gap is data about missing data; it is
 *   NEVER read as zero, as absence-of-failure, or as SUCCESS. Likewise
 *   UNKNOWN stays UNKNOWN (not UNAVAILABLE), UNSUPPORTED stays UNSUPPORTED
 *   (not a gap), FAILURE stays FAILURE, PARTIAL stays PARTIAL.
 *
 * Structural disciplines enforced by this ingestion path:
 *   - the subject MUST already be a well-formed spine artifact id — the
 *     evidence layer performs the semantic mapping from source-native
 *     subject labels (e.g. "otel:service:checkout") to spine subjects, and
 *     the mapping target is recorded in the provenance entries;
 *   - ingested evidence is ALWAYS OBSERVATIONAL — telemetry watched the
 *     system, it did not intervene. Interventional evidence only ever comes
 *     from explicit intervention creation (experiments, W9 and later);
 *   - the exact observation is bit-exactly referenced in provenance by its
 *     content hash (observation:sha256:<64hex>, the @sos-2/provenance
 *     external-revision token convention);
 *   - LLM-produced observations (producer.model !== null) yield
 *     non-authoritative evidence (llm_output: true) and can NEVER carry
 *     calibrated numeric confidence — an LLM self-reported confidence value
 *     is never calibrated truth (spec/meta-model.md).
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { assertValidProducer, isLlmProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { assertValidRawObservation, rawObservationHash } from '@sos-2/telemetry';
import type { RawObservation } from '@sos-2/telemetry';
import { assertConfidenceAllowedForProducer, assertValidConfidence } from './confidence.js';
import type { Confidence } from './confidence.js';
import { EvidenceError } from './errors.js';
import { createEvidence } from './record.js';

/** The ONE method of the built-in telemetry ingestion path. */
export const TELEMETRY_INGEST_METHOD = 'telemetry:capture-availability';

/** The evidence kind minted by telemetry ingestion. */
export const TELEMETRY_EVIDENCE_KIND = 'telemetry';

export interface IngestObservationInput {
  /** The validated raw observation (telemetry is INPUT — but not garbage). */
  observation: RawObservation;
  /**
   * The spine artifact id of the subject this evidence is about — the
   * semantic mapping target for the observation's (possibly source-native)
   * subject_ref. The mapping is recorded in provenance.
   */
  subject: string;
  /** The subject revision the observation reflects, or null. */
  subjectRevision?: string | null;
  /** Exact source revision, or null. */
  sourceRevision?: string | null;
  /** Exact deployment revision, or null. */
  deploymentRevision?: string | null;
  /**
   * Optional confidence mark. LLM-produced observations cannot carry
   * calibrated numeric confidence (rejected loudly). Defaults to
   * qualitative UNQUANTIFIED.
   */
  confidence?: Confidence;
}

function isNullOrNonEmptyString(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.length > 0);
}

/**
 * Ingest a raw telemetry observation as evidence about a spine subject.
 *
 * The truth state is assigned VERBATIM from the observation's capture-level
 * availability under the explicit method TELEMETRY_INGEST_METHOD. The
 * returned record is deterministic: the same observation about the same
 * subject with the same revisions yields the same evidence id (content
 * addressing over the exact creation content).
 */
export function ingestObservation(input: IngestObservationInput): ReturnType<typeof createEvidence> {
  if (typeof input !== 'object' || input === null) {
    throw new EvidenceError('ingest input must be an object');
  }
  try {
    assertValidRawObservation(input.observation);
  } catch (cause) {
    throw new EvidenceError(`observation is invalid: ${(cause as Error).message}`);
  }
  const observation: RawObservation = input.observation;
  if (typeof input.subject !== 'string' || !isArtifactId(input.subject)) {
    throw new EvidenceError(
      `subject must be a well-formed spine artifact id (the semantic mapping target), received: ${JSON.stringify(input.subject)}`,
    );
  }
  const subjectRevision = input.subjectRevision ?? null;
  if (!isNullOrNonEmptyString(subjectRevision)) {
    throw new EvidenceError(
      `subjectRevision must be null or a non-empty string, received: ${JSON.stringify(subjectRevision)}`,
    );
  }
  const sourceRevision = input.sourceRevision ?? null;
  if (!isNullOrNonEmptyString(sourceRevision)) {
    throw new EvidenceError(
      `sourceRevision must be null or a non-empty string, received: ${JSON.stringify(sourceRevision)}`,
    );
  }
  const deploymentRevision = input.deploymentRevision ?? null;
  if (!isNullOrNonEmptyString(deploymentRevision)) {
    throw new EvidenceError(
      `deploymentRevision must be null or a non-empty string, received: ${JSON.stringify(deploymentRevision)}`,
    );
  }
  const confidence = input.confidence === undefined ? { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' } as const : input.confidence;
  try {
    assertValidConfidence(confidence);
  } catch (cause) {
    throw new EvidenceError(`confidence is invalid: ${(cause as Error).message}`);
  }
  try {
    assertValidProducer(observation.producer);
  } catch (cause) {
    throw new EvidenceError(`producer is invalid: ${(cause as Error).message}`);
  }
  // LLM self-reported confidence is never calibrated truth — reject loudly.
  assertConfidenceAllowedForProducer(confidence, isLlmProducer(observation.producer));

  const observationHash = rawObservationHash(observation);
  return createEvidence({
    kind: TELEMETRY_EVIDENCE_KIND,
    subject_ref: input.subject,
    // VERBATIM truth-state assignment — UNAVAILABLE is never zero, never
    // absence-of-failure, and no state is ever coerced into another.
    availability: observation.availability as EvidenceTruthState,
    // Telemetry ingestion is OBSERVATIONAL by construction — never interventional.
    evidence_class: 'OBSERVATIONAL',
    method: TELEMETRY_INGEST_METHOD,
    provenance: [
      `observation:sha256:${observationHash}`,
      `method:${TELEMETRY_INGEST_METHOD}`,
      `telemetry:subject:${observation.subject_ref}`,
    ],
    source_revision: sourceRevision,
    deployment_revision: deploymentRevision,
    window: observation.window,
    subject_revision: subjectRevision,
    confidence,
    producer: observation.producer as Producer,
  });
}

/**
 * The provenance token that bit-exactly references an ingested observation
 * (exported so tests and downstream consumers can reconstruct the trail).
 */
export function observationProvenanceToken(observation: RawObservation): string {
  return `observation:sha256:${rawObservationHash(observation)}`;
}
