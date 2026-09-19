/**
 * Typed trace links — the 17 frozen link types from spec/meta-model.md and
 * spec/architecture.md §4, aligned 1:1 with spec/contracts/trace-link.schema.json
 * (additionalProperties: false; required: source, target, type).
 */

export const TRACE_LINK_TYPES = [
  'SATISFIES',
  'REALIZES',
  'REFINES',
  'CONSTRAINS',
  'IMPLEMENTS',
  'VERIFIES',
  'OBSERVES',
  'SUPPORTS',
  'CONTRADICTS',
  'CAUSED_BY',
  'CAUSED',
  'DERIVED_FROM',
  'COMPATIBLE_WITH',
  'CONFLICTS_WITH',
  'COMPOSES',
  'SPECIALIZES',
  'GENERALIZES',
] as const;

export type TraceLinkType = (typeof TRACE_LINK_TYPES)[number];

const TRACE_LINK_TYPE_SET: ReadonlySet<string> = new Set(TRACE_LINK_TYPES);

export function isTraceLinkType(value: unknown): value is TraceLinkType {
  return typeof value === 'string' && TRACE_LINK_TYPE_SET.has(value);
}

export interface TraceLink {
  /** Source artifact id. */
  source: string;
  /** Target artifact id. */
  target: string;
  /** One of the 17 frozen trace link types. */
  type: TraceLinkType;
  /** Optional provenance entries (the schema permits absence; entries are strings). */
  provenance?: string[];
}

const TRACE_LINK_KEYS = ['source', 'target', 'type', 'provenance'] as const;

export function isTraceLink(value: unknown): value is TraceLink {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = new Set<string>(TRACE_LINK_KEYS);
  if (!actual.every((key) => expected.has(key))) {
    return false;
  }
  if (!['source', 'target', 'type'].every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (typeof record.source !== 'string' || record.source.length === 0) {
    return false;
  }
  if (typeof record.target !== 'string' || record.target.length === 0) {
    return false;
  }
  if (!isTraceLinkType(record.type)) {
    return false;
  }
  if (
    record.provenance !== undefined &&
    (!Array.isArray(record.provenance) || !record.provenance.every((entry) => typeof entry === 'string'))
  ) {
    return false;
  }
  return true;
}
