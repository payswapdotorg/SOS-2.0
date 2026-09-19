/**
 * Artifact envelope — the exact field set from spec/meta-model.md:
 * id, kind, version, status, authority_ref, provenance, created_at, supersedes.
 *
 * There is no JSON Schema for the envelope in spec/contracts/ (W0.5 only adds
 * implementation-model.schema.json); this module IS the normative typed
 * contract for the envelope, and the field set is closed (exact 8 keys).
 */

export const ARTIFACT_STATUSES = ['DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED'] as const;

export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

const ARTIFACT_STATUS_SET: ReadonlySet<string> = new Set(ARTIFACT_STATUSES);

export function isArtifactStatus(value: unknown): value is ArtifactStatus {
  return typeof value === 'string' && ARTIFACT_STATUS_SET.has(value);
}

export interface ArtifactEnvelope {
  /** Globally unique, stable artifact id of the form sos://<kind>/<segment>. */
  id: string;
  /** Registered artifact kind (see artifact-kinds.ts). */
  kind: string;
  /** Monotonically increasing version within a supersede chain (integer >= 1). */
  version: number;
  /** Lifecycle status. Terminal states are SUPERSEDED and RETIRED. */
  status: ArtifactStatus;
  /** Reference to the authorizing artifact id, or null for self-authorized roots (e.g. Constitution). */
  authority_ref: string | null;
  /** Provenance entries (non-empty strings required by the spine layer). */
  provenance: string[];
  /** RFC3339 creation timestamp (caller-supplied; never a hidden clock). */
  created_at: string;
  /** Artifact id superseded by this one, or null. */
  supersedes: string | null;
}

const ENVELOPE_KEYS = [
  'id',
  'kind',
  'version',
  'status',
  'authority_ref',
  'provenance',
  'created_at',
  'supersedes',
] as const;

export function isArtifactEnvelope(value: unknown): value is ArtifactEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== ENVELOPE_KEYS.length) {
    return false;
  }
  const expected = new Set<string>(ENVELOPE_KEYS);
  if (!actual.every((key) => expected.has(key))) {
    return false;
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return false;
  }
  if (typeof record.kind !== 'string' || record.kind.length === 0) {
    return false;
  }
  if (
    typeof record.version !== 'number' ||
    !Number.isInteger(record.version) ||
    record.version < 1
  ) {
    return false;
  }
  if (!isArtifactStatus(record.status)) {
    return false;
  }
  if (record.authority_ref !== null && (typeof record.authority_ref !== 'string' || record.authority_ref.length === 0)) {
    return false;
  }
  if (!Array.isArray(record.provenance) || !record.provenance.every((entry) => typeof entry === 'string')) {
    return false;
  }
  if (typeof record.created_at !== 'string' || record.created_at.length === 0) {
    return false;
  }
  if (record.supersedes !== null && (typeof record.supersedes !== 'string' || record.supersedes.length === 0)) {
    return false;
  }
  return true;
}
