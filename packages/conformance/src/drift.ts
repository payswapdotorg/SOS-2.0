/**
 * Drift evidence records — the minimal, Evidence-record-SHAPED outputs of
 * drift detection (docs/code-to-architecture.md: "Drift itself becomes
 * Evidence").
 *
 * Scope boundary (W2 vs W3): the full Evidence Graph (observations, tests,
 * telemetry, incidents, provenance model, rollback) is Work Order W3's
 * scope. W2 emits only these minimal typed records referencing the subject
 * id, structurally compatible with the @sos-2/contracts EvidenceRecord
 * contract (additionalProperties: true — the extension fields below ride
 * the schema's open extension point). Ids are minted through the spine's
 * deterministic minter (kind "Evidence") — never invented locally.
 */

import { deriveDeterministicArtifactId, isArtifactId } from '@sos-2/semantic-spine';
import type { EvidenceRecord, ConformanceClass } from '@sos-2/semantic-spine';
import { isEvidenceRecord, isConformanceClass } from '@sos-2/semantic-spine';
import { ReconciliationError } from './errors.js';

export const DRIFT_EVIDENCE_KINDS = ['architecture-drift', 'architecture-contradiction'] as const;

export type DriftEvidenceKind = (typeof DRIFT_EVIDENCE_KINDS)[number];

/** Only DRIFT and CONTRADICTION findings produce drift evidence. */
export const DRIFT_CLASSIFICATIONS = ['DRIFT', 'CONTRADICTION'] as const;

export type DriftClassification = (typeof DRIFT_CLASSIFICATIONS)[number];

/**
 * Minimal typed drift record (Evidence-record-shaped; extends the open
 * EvidenceRecord contract with the subject, classification and reason).
 */
export interface DriftEvidenceRecord extends EvidenceRecord {
  kind: DriftEvidenceKind;
  availability: 'SUCCESS';
  observational: true;
  /** The drift classification that produced this record. */
  classification: DriftClassification;
  /** The local subject id (component id or edge key) the drift is about. */
  subject: string;
  /** The finding reason (deterministic, from the spine classifier). */
  reason: string;
}

export interface BuildDriftEvidenceInput {
  classification: DriftClassification;
  /** Local subject id (component id or edge key). */
  subject: string;
  /** The declared ArchitectureGraph artifact id the drift is about. */
  subject_ref: string;
  /** The finding reason. */
  reason: string;
  /** The observed ImplementationModel artifact id. */
  model_id: string;
  /** The exact source revision of the observed implementation model. */
  source_revision: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Build a drift evidence record with a deterministic, content-addressed id:
 * identical findings reproduce the identical record id (idempotent evidence
 * identity; pinned by tests).
 */
export function buildDriftEvidenceRecord(input: BuildDriftEvidenceInput): DriftEvidenceRecord {
  if (!isConformanceClass(input.classification) || !DRIFT_CLASSIFICATIONS.includes(input.classification as DriftClassification)) {
    throw new ReconciliationError(
      `drift evidence classification must be DRIFT or CONTRADICTION, received: ${JSON.stringify(input.classification)}`,
    );
  }
  if (!isNonEmptyString(input.subject)) {
    throw new ReconciliationError('drift evidence subject must be a non-empty string');
  }
  if (!isArtifactId(input.subject_ref)) {
    throw new ReconciliationError(
      `drift evidence subject_ref must be a well-formed artifact id, received: ${JSON.stringify(input.subject_ref)}`,
    );
  }
  if (!isNonEmptyString(input.reason)) {
    throw new ReconciliationError('drift evidence reason must be a non-empty string');
  }
  if (!isArtifactId(input.model_id)) {
    throw new ReconciliationError(
      `drift evidence model_id must be a well-formed artifact id, received: ${JSON.stringify(input.model_id)}`,
    );
  }
  if (!isNonEmptyString(input.source_revision)) {
    throw new ReconciliationError('drift evidence source_revision must be a non-empty string (exact revisions only)');
  }
  const kind: DriftEvidenceKind =
    input.classification === 'DRIFT' ? 'architecture-drift' : 'architecture-contradiction';
  const id = deriveDeterministicArtifactId('Evidence', {
    kind,
    classification: input.classification,
    subject: input.subject,
    subject_ref: input.subject_ref,
    reason: input.reason,
    model_id: input.model_id,
    source_revision: input.source_revision,
  });
  return {
    id,
    kind,
    subject_ref: input.subject_ref,
    availability: 'SUCCESS',
    provenance: [
      `W2:reconcile:${input.model_id}->${input.subject_ref}`,
      `source-revision:${input.source_revision}`,
    ],
    source_revision: input.source_revision,
    observational: true,
    classification: input.classification,
    subject: input.subject,
    reason: input.reason,
  };
}

/** Guard: EvidenceRecord contract shape + the W2 drift extension fields. */
export function isDriftEvidenceRecord(value: unknown): value is DriftEvidenceRecord {
  if (!isEvidenceRecord(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.id) || !isArtifactId(record.id)) {
    return false;
  }
  if (!DRIFT_EVIDENCE_KINDS.includes(record.kind as DriftEvidenceKind)) {
    return false;
  }
  if (record.availability !== 'SUCCESS') {
    return false;
  }
  if (record.observational !== true) {
    return false;
  }
  if (!isConformanceClass(record.classification) || !DRIFT_CLASSIFICATIONS.includes(record.classification as DriftClassification)) {
    return false;
  }
  if (!isNonEmptyString(record.subject) || !isNonEmptyString(record.reason)) {
    return false;
  }
  return true;
}
