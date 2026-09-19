/**
 * Evidence records — the W3 realization of the normative Evidence contract.
 *
 * The normative type (@sos-2/contracts EvidenceRecord, 1:1 with
 * spec/contracts/evidence.schema.json, additionalProperties: TRUE) is
 * CONSUMED here — never redefined, never duplicated. This package extends it
 * through the schema's open extension point with the documented W3 fields:
 *
 *   evidence_class     OBSERVATIONAL | INTERVENTIONAL (exactly one; the
 *                      normative observational/intervention booleans are
 *                      DERIVED from it — never conflated)
 *   method             the explicit truth-state assignment method provenance
 *                      (e.g. 'telemetry:capture-availability') — telemetry is
 *                      INPUT, not semantic truth; WHO assigned the truth
 *                      state and HOW is always recorded
 *   window             the observation time window, or null
 *   subject_revision   the subject revision the evidence reflects, or null
 *   confidence         calibrated numeric (requires a calibration artifact
 *                      ref) or qualitative uncertainty class
 *   producer           WHO/WHAT produced the evidence (from @sos-2/provenance)
 *   llm_output         derived: producer.model !== null — LLM output is never
 *                      authoritative (spec/architecture.md §18)
 *
 * Identity discipline: ids are ALWAYS minted by the Semantic Spine
 * (deterministic content-addressing over the exact creation content minus the
 * id and the derived flags). 'Evidence' is one of the 19 frozen core artifact
 * kinds — no kind registration is needed and none is performed.
 *
 * Guard strictness (documented strengthenings, same policy as the contracts
 * layer): provenance entries must be non-empty strings and at least one entry
 * must exist (no provenance-less evidence), and subject_ref must be a
 * well-formed spine artifact id (the evidence layer performs the semantic
 * mapping from source-native subject labels to spine subjects).
 */

import {
  canonicalSerialize,
  deriveDeterministicArtifactId,
  isArtifactId,
  isEvidenceRecord,
  isEvidenceTruthState,
  parseArtifactId,
} from '@sos-2/semantic-spine';
import type { EvidenceRecord, EvidenceTruthState } from '@sos-2/semantic-spine';
import { assertValidProducer, isLlmProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { assertValidTimeWindow } from '@sos-2/provenance';
import type { TimeWindow } from '@sos-2/provenance';
import { assertValidEvidenceClass, evidenceClassFlags, flagsToEvidenceClass } from './classification.js';
import type { EvidenceClass } from './classification.js';
import {
  assertConfidenceAllowedForProducer,
  assertValidConfidence,
  unquantifiedConfidence,
} from './confidence.js';
import type { Confidence } from './confidence.js';
import { EvidenceError } from './errors.js';

/** The (core, frozen) artifact kind segment used for evidence ids. */
export const EVIDENCE_ARTIFACT_KIND = 'Evidence';

/** The canonical evidence record minted by @sos-2/evidence (Work Order W3). */
export interface EvidenceRecordW3 extends EvidenceRecord {
  /** Evidence artifact id: sos://Evidence/<32 lowercase hex>. */
  id: string;
  /** Evidence kind, e.g. "telemetry", "test-run", "incident-report". */
  kind: string;
  /** Spine artifact id of the subject this evidence is about. */
  subject_ref: string;
  /** One of the 6 distinct truth states. */
  availability: EvidenceTruthState;
  /** Provenance entries (non-empty strings; at least one entry). */
  provenance: string[];
  /** Exact source revision, or null (preserved, never defaulted). */
  source_revision: string | null;
  /** Exact deployment revision, or null (preserved, never defaulted). */
  deployment_revision: string | null;
  /** Derived: true iff evidence_class is OBSERVATIONAL. */
  observational: boolean;
  /** Derived: true iff evidence_class is INTERVENTIONAL. */
  intervention: boolean;
  /** The declared evidence class — exactly one of the two, never conflated. */
  evidence_class: EvidenceClass;
  /** Explicit truth-state assignment method provenance. */
  method: string;
  /** The observation time window, or null. */
  window: TimeWindow | null;
  /** The subject revision the evidence reflects, or null. */
  subject_revision: string | null;
  /** Calibrated numeric or qualitative confidence. */
  confidence: Confidence;
  /** WHO/WHAT produced this evidence. */
  producer: Producer;
  /** Derived: true iff produced by model output. Never authoritative (§18). */
  llm_output: boolean;
}

export interface CreateEvidenceInput {
  /** Evidence kind (non-empty), e.g. "telemetry", "test-run", "incident-report". */
  kind: string;
  /** Spine artifact id of the subject (well-formed sos:// id). */
  subject_ref: string;
  /** One of the 6 distinct truth states. */
  availability: EvidenceTruthState;
  /** The declared evidence class. */
  evidence_class: EvidenceClass;
  /**
   * Explicit truth-state assignment method provenance (non-empty), e.g.
   * 'telemetry:capture-availability', 'test-run:exit-code'.
   */
  method: string;
  /** Provenance entries (at least one non-empty string; exact revisions, observation hashes, ...). */
  provenance: string[];
  /** Exact source revision, or null. */
  source_revision?: string | null;
  /** Exact deployment revision, or null. */
  deployment_revision?: string | null;
  /** The observation time window, or null. */
  window?: TimeWindow | null;
  /** The subject revision the evidence reflects, or null. */
  subject_revision?: string | null;
  /** Confidence mark; defaults to qualitative UNQUANTIFIED. */
  confidence?: Confidence;
  /** WHO/WHAT produced this evidence. */
  producer: Producer;
}

/**
 * The exact value an evidence record id is derived from (exported so tests
 * and diagnostics reproduce ids bit-exactly — W0.5 fixture discipline).
 * Derived fields (id, observational/intervention flags, llm_output) are NOT
 * part of the derivation content.
 */
export interface EvidenceCreationContent {
  kind: string;
  subject_ref: string;
  availability: EvidenceTruthState;
  provenance: string[];
  source_revision: string | null;
  deployment_revision: string | null;
  evidence_class: EvidenceClass;
  method: string;
  window: TimeWindow | null;
  subject_revision: string | null;
  confidence: Confidence;
  producer: Producer;
}

function isNullOrNonEmptyString(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.length > 0);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

/** Normalize + validate a CreateEvidenceInput into its exact creation content. */
export function evidenceCreationContent(input: CreateEvidenceInput): EvidenceCreationContent {
  if (typeof input !== 'object' || input === null) {
    throw new EvidenceError('evidence creation input must be an object');
  }
  if (typeof input.kind !== 'string' || input.kind.length === 0) {
    throw new EvidenceError(`evidence kind must be a non-empty string, received: ${JSON.stringify(input.kind)}`);
  }
  if (!isArtifactId(input.subject_ref)) {
    throw new EvidenceError(
      `subject_ref must be a well-formed spine artifact id, received: ${JSON.stringify(input.subject_ref)} ` +
        '(the evidence layer maps source-native subject labels to spine subjects at ingestion — ' +
        'evidence is only minted about semantically identified subjects)',
    );
  }
  if (!isEvidenceTruthState(input.availability)) {
    throw new EvidenceError(
      `availability must be one of the 6 distinct evidence truth states, received: ${JSON.stringify(input.availability)}`,
    );
  }
  assertValidEvidenceClass(input.evidence_class);
  if (typeof input.method !== 'string' || input.method.length === 0) {
    throw new EvidenceError(
      `method must be a non-empty string (explicit truth-state assignment method provenance), received: ${JSON.stringify(input.method)}`,
    );
  }
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new EvidenceError(
      'provenance must be a non-empty array of non-empty strings (no provenance-less evidence is minted)',
    );
  }
  const source_revision = input.source_revision ?? null;
  if (!isNullOrNonEmptyString(source_revision)) {
    throw new EvidenceError(
      `source_revision must be null or a non-empty string, received: ${JSON.stringify(source_revision)}`,
    );
  }
  const deployment_revision = input.deployment_revision ?? null;
  if (!isNullOrNonEmptyString(deployment_revision)) {
    throw new EvidenceError(
      `deployment_revision must be null or a non-empty string, received: ${JSON.stringify(deployment_revision)}`,
    );
  }
  const window = input.window ?? null;
  if (window !== null) {
    try {
      assertValidTimeWindow(window);
    } catch (cause) {
      throw new EvidenceError(`window is invalid: ${(cause as Error).message}`);
    }
  }
  const subject_revision = input.subject_revision ?? null;
  if (!isNullOrNonEmptyString(subject_revision)) {
    throw new EvidenceError(
      `subject_revision must be null or a non-empty string, received: ${JSON.stringify(subject_revision)}`,
    );
  }
  const confidence = input.confidence === undefined ? unquantifiedConfidence() : input.confidence;
  try {
    assertValidConfidence(confidence);
  } catch (cause) {
    throw new EvidenceError(`confidence is invalid: ${(cause as Error).message}`);
  }
  try {
    assertValidProducer(input.producer);
  } catch (cause) {
    throw new EvidenceError(`producer is invalid: ${(cause as Error).message}`);
  }
  // Numeric confidence requires BOTH a calibration artifact AND a non-LLM producer.
  assertConfidenceAllowedForProducer(confidence, isLlmProducer(input.producer));
  return {
    kind: input.kind,
    subject_ref: input.subject_ref,
    availability: input.availability,
    provenance: [...input.provenance],
    source_revision,
    deployment_revision,
    evidence_class: input.evidence_class,
    method: input.method,
    window: window === null ? null : { ...window },
    subject_revision,
    confidence: structuredClone(confidence),
    producer: { ...input.producer },
  };
}

/** Derive the deterministic evidence record id for a creation input. */
export function evidenceRecordId(input: CreateEvidenceInput): string {
  return deriveDeterministicArtifactId(EVIDENCE_ARTIFACT_KIND, evidenceCreationContent(input));
}

/**
 * Create an evidence record. Ids are ALWAYS deterministic (content-addressed)
 * — evidence is reproducible from exact revisions and content
 * (spec/architecture.md §18, R30). The normative observational/intervention
 * booleans and the llm_output mark are DERIVED, so class conflation and
 * hidden LLM involvement are impossible.
 */
export function createEvidence(input: CreateEvidenceInput): EvidenceRecordW3 {
  const content = evidenceCreationContent(input);
  const id = deriveDeterministicArtifactId(EVIDENCE_ARTIFACT_KIND, content);
  const flags = evidenceClassFlags(content.evidence_class);
  return {
    id,
    kind: content.kind,
    subject_ref: content.subject_ref,
    availability: content.availability,
    provenance: content.provenance,
    source_revision: content.source_revision,
    deployment_revision: content.deployment_revision,
    observational: flags.observational,
    intervention: flags.intervention,
    evidence_class: content.evidence_class,
    method: content.method,
    window: content.window,
    subject_revision: content.subject_revision,
    confidence: content.confidence,
    producer: content.producer,
    llm_output: isLlmProducer(content.producer),
  };
}

const EVIDENCE_W3_KEYS = [
  'id',
  'kind',
  'subject_ref',
  'availability',
  'provenance',
  'source_revision',
  'deployment_revision',
  'observational',
  'intervention',
  'evidence_class',
  'method',
  'window',
  'subject_revision',
  'confidence',
  'producer',
  'llm_output',
] as const;

/**
 * Full semantic validation with a specific error message (throws
 * EvidenceError). Validates THIS package's canonical shape: the normative
 * EvidenceRecord contract (contracts layer) PLUS the exact W3 extension
 * field set, with the observation/intervention XOR and llm_output
 * consistency enforced.
 */
export function assertValidEvidenceRecord(value: unknown): asserts value is EvidenceRecordW3 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EvidenceError('evidence record must be an object');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = new Set<string>(EVIDENCE_W3_KEYS);
  if (actual.length !== EVIDENCE_W3_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new EvidenceError(
      'evidence record must have the exact W3 field set ' +
        '{ id, kind, subject_ref, availability, provenance, source_revision, deployment_revision, observational, intervention, evidence_class, method, window, subject_revision, confidence, producer, llm_output }',
    );
  }
  // Normative contract layer first: the record IS an EvidenceRecord.
  if (!isEvidenceRecord(record)) {
    throw new EvidenceError('record does not satisfy the normative EvidenceRecord contract (@sos-2/contracts)');
  }
  if (!isArtifactId(record['id'])) {
    throw new EvidenceError(`evidence record id is not a well-formed artifact id: ${JSON.stringify(record['id'])}`);
  }
  const parsed = parseArtifactId(record['id']);
  if (parsed.kind !== EVIDENCE_ARTIFACT_KIND) {
    throw new EvidenceError(
      `evidence record id ${record['id']} declares kind ${parsed.kind}, expected ${EVIDENCE_ARTIFACT_KIND}`,
    );
  }
  if (!isArtifactId(record['subject_ref'])) {
    throw new EvidenceError(
      `subject_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['subject_ref'])}`,
    );
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new EvidenceError(
      'provenance must be a non-empty array of non-empty strings (no provenance-less evidence)',
    );
  }
  if (!isNullOrNonEmptyString(record['source_revision'])) {
    throw new EvidenceError(
      `source_revision must be null or a non-empty string, received: ${JSON.stringify(record['source_revision'])}`,
    );
  }
  if (!isNullOrNonEmptyString(record['deployment_revision'])) {
    throw new EvidenceError(
      `deployment_revision must be null or a non-empty string, received: ${JSON.stringify(record['deployment_revision'])}`,
    );
  }
  if (typeof record['observational'] !== 'boolean' || typeof record['intervention'] !== 'boolean') {
    throw new EvidenceError('observational and intervention must be booleans');
  }
  let evidenceClass: EvidenceClass;
  try {
    evidenceClass = flagsToEvidenceClass(record['observational'], record['intervention']);
  } catch (cause) {
    throw new EvidenceError((cause as Error).message);
  }
  if (record['evidence_class'] !== evidenceClass) {
    throw new EvidenceError(
      `evidence_class ${JSON.stringify(record['evidence_class'])} is inconsistent with the flags ` +
        `(observational=${String(record['observational'])}, intervention=${String(record['intervention'])}) — ` +
        'the observation/intervention distinction is derived and cannot disagree',
    );
  }
  if (typeof record['method'] !== 'string' || record['method'].length === 0) {
    throw new EvidenceError(
      `method must be a non-empty string (explicit truth-state assignment method provenance), received: ${JSON.stringify(record['method'])}`,
    );
  }
  if (record['window'] !== null) {
    try {
      assertValidTimeWindow(record['window']);
    } catch (cause) {
      throw new EvidenceError(`window is invalid: ${(cause as Error).message}`);
    }
  }
  if (!isNullOrNonEmptyString(record['subject_revision'])) {
    throw new EvidenceError(
      `subject_revision must be null or a non-empty string, received: ${JSON.stringify(record['subject_revision'])}`,
    );
  }
  try {
    assertValidConfidence(record['confidence']);
  } catch (cause) {
    throw new EvidenceError(`confidence is invalid: ${(cause as Error).message}`);
  }
  try {
    assertValidProducer(record['producer']);
  } catch (cause) {
    throw new EvidenceError(`producer is invalid: ${(cause as Error).message}`);
  }
  if (typeof record['llm_output'] !== 'boolean') {
    throw new EvidenceError(`llm_output must be a boolean, received: ${JSON.stringify(record['llm_output'])}`);
  }
  const producer = record['producer'] as Producer;
  if (record['llm_output'] !== isLlmProducer(producer)) {
    throw new EvidenceError(
      `llm_output (${String(record['llm_output'])}) is inconsistent with the producer (model ${JSON.stringify(
        producer.model,
      )} ${producer.model === null ? 'absent' : 'present'}) — LLM involvement can never be hidden or claimed falsely`,
    );
  }
  const confidence = record['confidence'] as Confidence;
  if (confidence.kind === 'CALIBRATED' && record['llm_output']) {
    throw new EvidenceError(
      'LLM-produced evidence cannot carry calibrated numeric confidence (an LLM self-reported confidence value is never calibrated truth)',
    );
  }
}

/** Predicate form of assertValidEvidenceRecord. */
export function validateEvidenceRecord(value: unknown): value is EvidenceRecordW3 {
  try {
    assertValidEvidenceRecord(value);
    return true;
  } catch {
    return false;
  }
}

/** Canonical serialization of an evidence record (deterministic round trips). */
export function canonicalEvidenceText(record: EvidenceRecordW3): string {
  assertValidEvidenceRecord(record);
  return canonicalSerialize(record);
}

/** True iff this record was produced by model output (LLM). */
export function isLlmOutput(record: EvidenceRecordW3): boolean {
  return record.llm_output;
}

/**
 * True iff this record is NON-AUTHORITATIVE.
 *
 * Per spec/architecture.md §18, LLM output is never authoritative evidence or
 * authorization: every LLM-produced evidence record is non-authoritative.
 * (Non-LLM records are not thereby granted authority — they are simply
 * eligible as evidence inputs; authority is granted elsewhere, by humans.)
 */
export function isNonAuthoritativeEvidence(record: EvidenceRecordW3): boolean {
  return record.llm_output;
}

/** Counts per truth state — ALL 6 keys are ALWAYS present. */
export type AvailabilitySummary = Record<EvidenceTruthState, number>;

/**
 * Honest availability summary over a set of evidence records.
 *
 * LOCKED INVARIANT (spec/architecture-lock.md): UNAVAILABLE telemetry is
 * NEVER interpreted as zero or as absence-of-failure. This summary therefore
 * counts UNAVAILABLE AS UNAVAILABLE — it is never folded into SUCCESS,
 * never read as "zero failures", and never dropped. All 6 distinct states
 * are reported, zero-filled when absent.
 */
export function summarizeAvailability(records: readonly EvidenceRecordW3[]): AvailabilitySummary {
  if (!Array.isArray(records)) {
    throw new EvidenceError('summarizeAvailability requires an array of evidence records');
  }
  const summary: AvailabilitySummary = {
    SUCCESS: 0,
    FAILURE: 0,
    UNKNOWN: 0,
    UNAVAILABLE: 0,
    UNSUPPORTED: 0,
    PARTIAL: 0,
  };
  for (const record of records) {
    assertValidEvidenceRecord(record);
    summary[record.availability] += 1;
  }
  return summary;
}
