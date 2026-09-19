/**
 * Evidence record — aligned 1:1 with spec/contracts/evidence.schema.json
 * ($id: sos://schema/evidence; required: id, kind, subject_ref, availability,
 * provenance; additionalProperties: TRUE — the evidence contract is
 * intentionally open for downstream Work Order extensions, so the TS type
 * carries an index signature).
 */

import type { EvidenceTruthState } from './truth-states.js';
import { isEvidenceTruthState } from './truth-states.js';

export interface EvidenceRecord {
  /** Evidence artifact id (sos://Evidence/<segment>). */
  id: string;
  /** Evidence kind, e.g. "test-run", "telemetry", "incident-report". */
  kind: string;
  /** Artifact id of the subject this evidence is about. */
  subject_ref: string;
  /** One of the 6 distinct truth states. */
  availability: EvidenceTruthState;
  /** Provenance entries. */
  provenance: string[];
  /** Exact source revision, or null. */
  source_revision?: string | null;
  /** Exact deployment revision, or null. */
  deployment_revision?: string | null;
  /** Whether the evidence is observational (no intervention). */
  observational?: boolean;
  /** Whether the evidence arises from an intervention. */
  intervention?: boolean;
  /**
   * Open extension point (schema additionalProperties: true).
   * Unknown keys are preserved but not interpreted at this layer.
   */
  [extension: string]: unknown;
}

const EVIDENCE_REQUIRED_KEYS = ['id', 'kind', 'subject_ref', 'availability', 'provenance'] as const;

export function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!EVIDENCE_REQUIRED_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return false;
  }
  if (typeof record.kind !== 'string' || record.kind.length === 0) {
    return false;
  }
  if (typeof record.subject_ref !== 'string' || record.subject_ref.length === 0) {
    return false;
  }
  if (!isEvidenceTruthState(record.availability)) {
    return false;
  }
  if (!Array.isArray(record.provenance) || !record.provenance.every((entry) => typeof entry === 'string')) {
    return false;
  }
  if (
    record.source_revision !== undefined &&
    record.source_revision !== null &&
    (typeof record.source_revision !== 'string' || record.source_revision.length === 0)
  ) {
    return false;
  }
  if (
    record.deployment_revision !== undefined &&
    record.deployment_revision !== null &&
    (typeof record.deployment_revision !== 'string' || record.deployment_revision.length === 0)
  ) {
    return false;
  }
  if (record.observational !== undefined && typeof record.observational !== 'boolean') {
    return false;
  }
  if (record.intervention !== undefined && typeof record.intervention !== 'boolean') {
    return false;
  }
  return true;
}
