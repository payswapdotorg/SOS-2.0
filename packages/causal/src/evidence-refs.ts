/**
 * Evidence references — the STRICT OBSERVATIONAL/INTERVENTIONAL class
 * separation for causal knowledge (Work Order W5; locked invariant from
 * spec/architecture.md §18 and spec/architecture-lock.md: "causal evidence
 * semantics" may not be redefined, and intervention evidence outranks
 * observational correlation for strong causal claims).
 *
 * A causal hypothesis never references "evidence" generically: it references
 * evidence THROUGH one of two DISTINCT, nominal-ish types:
 *
 *   ObservationalEvidenceRef     evidence_class: 'OBSERVATIONAL'
 *   InterventionalEvidenceRef    evidence_class: 'INTERVENTIONAL'
 *
 * The two shapes are structurally identical apart from the class literal —
 * that is the point: the class is a compile-time-visible, runtime-checked
 * DISCRIMINANT, so a reference can never silently change class, and arrays
 * of references can never silently mix classes. Builders derived from real
 * evidence records (`observationalEvidenceRef`, `interventionalEvidenceRef`)
 * THROW on class mismatch: an observational record can never be turned into
 * an interventional reference.
 *
 * Each reference is a PROVENANCE SNAPSHOT of the evidence record it cites:
 * the evidence id (deterministic, content-addressed — the id pins the exact
 * content), the subject, the truth state, the exact source and subject
 * revisions, and the observation time window. This realizes the W5
 * requirement that every hypothesis carries provenance "which evidence
 * records, which revisions".
 */

import {
  assertValidTimeWindow,
} from '@sos-2/provenance';
import type { TimeWindow } from '@sos-2/provenance';
import {
  EVIDENCE_ARTIFACT_KIND,
} from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import {
  isArtifactId,
  isEvidenceTruthState,
  parseArtifactId,
} from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { CausalError } from './errors.js';

/** Fields shared by both evidence reference classes (the class literal differs). */
interface EvidenceReferenceFields {
  /** Deterministic evidence record id this reference cites (sos://Evidence/<32 hex>). */
  evidence_id: string;
  /** Spine artifact id of the subject the cited evidence is about. */
  subject_ref: string;
  /** Truth state of the cited evidence (one of the 6 distinct states). */
  availability: EvidenceTruthState;
  /** Exact source revision of the cited evidence, or null. */
  source_revision: string | null;
  /** Subject revision the cited evidence reflects, or null. */
  subject_revision: string | null;
  /** Observation time window of the cited evidence, or null. */
  window: TimeWindow | null;
}

/** A reference to OBSERVATIONAL evidence — establishes correlation only. */
export interface ObservationalEvidenceRef extends EvidenceReferenceFields {
  evidence_class: 'OBSERVATIONAL';
}

/** A reference to INTERVENTIONAL evidence — the only class that can support a strong causal claim. */
export interface InterventionalEvidenceRef extends EvidenceReferenceFields {
  evidence_class: 'INTERVENTIONAL';
}

/** The union of the two distinct reference classes. */
export type EvidenceReference = ObservationalEvidenceRef | InterventionalEvidenceRef;

const EVIDENCE_REF_KEYS = [
  'evidence_class',
  'evidence_id',
  'subject_ref',
  'availability',
  'source_revision',
  'subject_revision',
  'window',
] as const;

function isNullOrNonEmptyString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0);
}

/** Validate the class-independent reference shape; returns the typed snapshot. */
function validateReferenceFields(
  value: unknown,
  expectedClass: 'OBSERVATIONAL' | 'INTERVENTIONAL',
): EvidenceReferenceFields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CausalError('evidence reference must be an object');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = new Set<string>(EVIDENCE_REF_KEYS);
  if (actual.length !== EVIDENCE_REF_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new CausalError(
      `evidence reference must have the exact field set ` +
        `{ evidence_class, evidence_id, subject_ref, availability, source_revision, subject_revision, window }`,
    );
  }
  if (record['evidence_class'] !== expectedClass) {
    throw new CausalError(
      `evidence reference class mismatch: expected ${expectedClass}, received ${JSON.stringify(record['evidence_class'])} ` +
        '(the observation/intervention distinction is a distinct type and can never be conflated)',
    );
  }
  if (!isArtifactId(record['evidence_id'])) {
    throw new CausalError(
      `evidence_id must be a well-formed spine artifact id, received: ${JSON.stringify(record['evidence_id'])}`,
    );
  }
  const parsed = parseArtifactId(record['evidence_id']);
  if (parsed.kind !== EVIDENCE_ARTIFACT_KIND) {
    throw new CausalError(
      `evidence_id must reference an Evidence artifact, received: ${JSON.stringify(record['evidence_id'])} (kind ${parsed.kind})`,
    );
  }
  if (!isArtifactId(record['subject_ref'])) {
    throw new CausalError(
      `subject_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['subject_ref'])}`,
    );
  }
  if (!isEvidenceTruthState(record['availability'])) {
    throw new CausalError(
      `availability must be one of the 6 distinct evidence truth states, received: ${JSON.stringify(record['availability'])}`,
    );
  }
  const sourceRevision = record['source_revision'];
  if (!isNullOrNonEmptyString(sourceRevision)) {
    throw new CausalError(
      `source_revision must be null or a non-empty string, received: ${JSON.stringify(sourceRevision)}`,
    );
  }
  const subjectRevision = record['subject_revision'];
  if (!isNullOrNonEmptyString(subjectRevision)) {
    throw new CausalError(
      `subject_revision must be null or a non-empty string, received: ${JSON.stringify(subjectRevision)}`,
    );
  }
  if (record['window'] !== null) {
    try {
      assertValidTimeWindow(record['window']);
    } catch (cause) {
      throw new CausalError(`window is invalid: ${(cause as Error).message}`);
    }
  }
  return {
    evidence_id: record['evidence_id'],
    subject_ref: record['subject_ref'],
    availability: record['availability'],
    source_revision: sourceRevision,
    subject_revision: subjectRevision,
    window: record['window'] === null ? null : { ...(record['window'] as TimeWindow) },
  };
}

/** Structural check: a well-formed OBSERVATIONAL evidence reference. */
export function isObservationalEvidenceRef(value: unknown): value is ObservationalEvidenceRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)['evidence_class'] === 'OBSERVATIONAL' &&
    validateQuietly(value, 'OBSERVATIONAL')
  );
}

/** Structural check: a well-formed INTERVENTIONAL evidence reference. */
export function isInterventionalEvidenceRef(value: unknown): value is InterventionalEvidenceRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)['evidence_class'] === 'INTERVENTIONAL' &&
    validateQuietly(value, 'INTERVENTIONAL')
  );
}

function validateQuietly(value: unknown, expectedClass: 'OBSERVATIONAL' | 'INTERVENTIONAL'): boolean {
  try {
    validateReferenceFields(value, expectedClass);
    return true;
  } catch {
    return false;
  }
}

/** Full validation with a specific error message (throws CausalError). */
export function assertValidObservationalEvidenceRef(
  value: unknown,
): asserts value is ObservationalEvidenceRef {
  validateReferenceFields(value, 'OBSERVATIONAL');
}

/** Full validation with a specific error message (throws CausalError). */
export function assertValidInterventionalEvidenceRef(
  value: unknown,
): asserts value is InterventionalEvidenceRef {
  validateReferenceFields(value, 'INTERVENTIONAL');
}

/** Predicate forms. */
export function validateObservationalEvidenceRef(value: unknown): value is ObservationalEvidenceRef {
  try {
    assertValidObservationalEvidenceRef(value);
    return true;
  } catch {
    return false;
  }
}

export function validateInterventionalEvidenceRef(
  value: unknown,
): value is InterventionalEvidenceRef {
  try {
    assertValidInterventionalEvidenceRef(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build an OBSERVATIONAL reference from a real evidence record.
 * THROWS when the record is not observational — an observational record can
 * never be laundered into an interventional reference (locked invariant).
 */
export function observationalEvidenceRef(record: EvidenceRecordW3): ObservationalEvidenceRef {
  if (record.evidence_class !== 'OBSERVATIONAL') {
    throw new CausalError(
      `evidence record ${record.id} is ${record.evidence_class}, not OBSERVATIONAL — ` +
        'the evidence class of a reference can never be changed or misstated',
    );
  }
  return {
    evidence_class: 'OBSERVATIONAL',
    evidence_id: record.id,
    subject_ref: record.subject_ref,
    availability: record.availability,
    source_revision: record.source_revision,
    subject_revision: record.subject_revision,
    window: record.window === null ? null : { ...record.window },
  };
}

/**
 * Build an INTERVENTIONAL reference from a real evidence record.
 * THROWS when the record is not interventional.
 */
export function interventionalEvidenceRef(record: EvidenceRecordW3): InterventionalEvidenceRef {
  if (record.evidence_class !== 'INTERVENTIONAL') {
    throw new CausalError(
      `evidence record ${record.id} is ${record.evidence_class}, not INTERVENTIONAL — ` +
        'the evidence class of a reference can never be changed or misstated',
    );
  }
  return {
    evidence_class: 'INTERVENTIONAL',
    evidence_id: record.id,
    subject_ref: record.subject_ref,
    availability: record.availability,
    source_revision: record.source_revision,
    subject_revision: record.subject_revision,
    window: record.window === null ? null : { ...record.window },
  };
}

/**
 * Build the correctly-typed reference for a real evidence record (class is
 * read from the record — never supplied by the caller).
 */
export function evidenceReferenceFromRecord(record: EvidenceRecordW3): EvidenceReference {
  return record.evidence_class === 'OBSERVATIONAL'
    ? observationalEvidenceRef(record)
    : interventionalEvidenceRef(record);
}

/**
 * Assert that a set of references contains no duplicate evidence ids across
 * BOTH classes — the same evidence record cited twice (within one class, or
 * once in each class) is either redundancy or a conflation attempt, and is
 * rejected loudly.
 */
export function assertNoDuplicateEvidenceReferences(
  observational: readonly ObservationalEvidenceRef[],
  interventional: readonly InterventionalEvidenceRef[],
): void {
  const seen = new Set<string>();
  for (const ref of [...observational, ...interventional]) {
    if (seen.has(ref.evidence_id)) {
      throw new CausalError(
        `duplicate evidence reference rejected: ${ref.evidence_id} is cited more than once ` +
          '(each evidence record is cited at most once — exactly once per its single class)',
      );
    }
    seen.add(ref.evidence_id);
  }
}
