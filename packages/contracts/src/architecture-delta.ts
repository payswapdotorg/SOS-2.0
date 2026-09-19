/**
 * Architecture Delta — aligned 1:1 with spec/contracts/architecture-delta.schema.json
 * ($id: sos://schema/architecture-delta; required: affected_artifacts,
 * preserved_invariants; additionalProperties: false).
 */

export interface ArchitectureDelta {
  /** Artifact ids / contract ids affected by the change (required, non-empty at the spine layer). */
  affected_artifacts: string[];
  /** Invariants that the change explicitly preserves (required, non-empty at the spine layer). */
  preserved_invariants: string[];
  /** Added elements. */
  added?: string[];
  /** Removed elements. */
  removed?: string[];
  /** Modified elements. */
  modified?: string[];
  /** Boundary / interface changes. */
  boundary_changes?: string[];
  /** Reference to the rationale artifact, or null. */
  rationale_ref?: string | null;
  /** Owning Work Order, e.g. "W0.5". */
  work_order?: string;
}

const ARCHITECTURE_DELTA_KEYS = [
  'affected_artifacts',
  'added',
  'removed',
  'modified',
  'preserved_invariants',
  'boundary_changes',
  'rationale_ref',
  'work_order',
] as const;

export function isArchitectureDelta(value: unknown): value is ArchitectureDelta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = new Set<string>(ARCHITECTURE_DELTA_KEYS);
  if (!actual.every((key) => expected.has(key))) {
    return false;
  }
  if (
    !['affected_artifacts', 'preserved_invariants'].every((key) =>
      Object.prototype.hasOwnProperty.call(record, key),
    )
  ) {
    return false;
  }
  for (const key of ['affected_artifacts', 'added', 'removed', 'modified', 'preserved_invariants', 'boundary_changes']) {
    const list = record[key];
    if (list !== undefined && (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string'))) {
      return false;
    }
  }
  if (
    record.rationale_ref !== undefined &&
    record.rationale_ref !== null &&
    (typeof record.rationale_ref !== 'string' || record.rationale_ref.length === 0)
  ) {
    return false;
  }
  if (record.work_order !== undefined && (typeof record.work_order !== 'string' || record.work_order.length === 0)) {
    return false;
  }
  return true;
}
