/**
 * Ambiguity / uncertainty markers (Work Order W4).
 *
 * Brownfield recovery "must preserve multiple hypotheses when evidence is
 * ambiguous" (docs/code-to-architecture.md) and "provenance and uncertainty
 * [must be] retained" (W4 acceptance). Markers are the typed, deterministic
 * mechanism: every place where the observed ImplementationModel admits more
 * than one architectural reading — or where evidence could not be placed at
 * all — is recorded here instead of being silently resolved away.
 *
 * Marker kinds (frozen vocabulary, kebab-case like the W2/W3 registries):
 *   KIND_AMBIGUITY              observed component kind maps to >1 candidate
 *                               node kinds; alternatives listed
 *   GROUPED_REALIZATION         components declare grouped `realizes`, so the
 *                               merge vs direct reading both stay possible
 *   MULTI_REALIZES              a component realizes >1 declared ids and is
                               kept unmerged under every hypothesis
 *   MIXED_KIND_GROUP            a merge group mixes observed kinds; the
 *                               alphabetically-first member decides the node
 *                               kind (deterministic, marked)
 *   MERGE_ID_COLLISION          an unmerged component shares an id with a
 *                               merged node and is absorbed into the group
 *   UNRESOLVED_DEPENDENCY_ENDPOINT a dependency references an id that is not
 *                               a component; the edge cannot be placed
 *   DUPLICATE_DEPENDENCY_PAIR   two observed dependencies share a
 *                               (source, target) pair; the first is kept
 *   INTERNAL_DEPENDENCY         a dependency became intra-node after merging;
 *                               dropped from the merged view (not an edge)
 *   TRUNCATED_HYPOTHESIS_SPACE  the hypothesis enumeration exceeded
 *                               maxHypotheses; competing readings beyond the
 *                               cap were NOT enumerated
 *
 * Hypothesis artifacts are asserted UNIQUE per recovery run (two enumeration
 * branches producing the same artifact id is a construction bug and throws
 * RecoveryError) — convergence is never silently collapsed.
 */

import { RecoveryError } from './errors.js';

export const AMBIGUITY_MARKER_KINDS = [
  'KIND_AMBIGUITY',
  'GROUPED_REALIZATION',
  'MULTI_REALIZES',
  'MIXED_KIND_GROUP',
  'MERGE_ID_COLLISION',
  'UNRESOLVED_DEPENDENCY_ENDPOINT',
  'DUPLICATE_DEPENDENCY_PAIR',
  'INTERNAL_DEPENDENCY',
  'TRUNCATED_HYPOTHESIS_SPACE',
] as const;

export type AmbiguityMarkerKind = (typeof AMBIGUITY_MARKER_KINDS)[number];

const AMBIGUITY_MARKER_KIND_SET: ReadonlySet<string> = new Set(AMBIGUITY_MARKER_KINDS);

export function isAmbiguityMarkerKind(value: unknown): value is AmbiguityMarkerKind {
  return typeof value === 'string' && AMBIGUITY_MARKER_KIND_SET.has(value);
}

export interface AmbiguityMarker {
  /** Which ambiguity/uncertainty was detected (frozen vocabulary above). */
  kind: AmbiguityMarkerKind;
  /** The subject the marker is about (component id, observed kind, edge key). */
  subject: string;
  /** Deterministic human-readable explanation. */
  detail: string;
  /** Competing alternatives that were retained (e.g. candidate node kinds). */
  alternatives?: string[];
}

export function isAmbiguityMarker(value: unknown): value is AmbiguityMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isAmbiguityMarkerKind(record['kind'])) {
    return false;
  }
  if (typeof record['subject'] !== 'string' || (record['subject'] as string).length === 0) {
    return false;
  }
  if (typeof record['detail'] !== 'string' || (record['detail'] as string).length === 0) {
    return false;
  }
  if (
    record['alternatives'] !== undefined &&
    (!Array.isArray(record['alternatives']) ||
      !(record['alternatives'] as unknown[]).every((entry) => typeof entry === 'string' && entry.length > 0))
  ) {
    return false;
  }
  const keys = Object.keys(record).sort();
  const expected = ['alternatives', 'detail', 'kind', 'subject'];
  if (keys.length === 3) {
    return keys[0] === 'detail' && keys[1] === 'kind' && keys[2] === 'subject';
  }
  return keys.length === 4 && keys.every((key, index) => key === expected[index]);
}

/** Build a validated marker (throws RecoveryError on malformed input). */
export function buildAmbiguityMarker(input: {
  kind: AmbiguityMarkerKind;
  subject: string;
  detail: string;
  alternatives?: string[];
}): AmbiguityMarker {
  if (!isAmbiguityMarkerKind(input.kind)) {
    throw new RecoveryError(
      `unknown ambiguity marker kind: ${JSON.stringify(input.kind)} (expected one of ${AMBIGUITY_MARKER_KINDS.join(', ')})`,
    );
  }
  if (typeof input.subject !== 'string' || input.subject.length === 0) {
    throw new RecoveryError(`ambiguity marker subject must be a non-empty string, received: ${JSON.stringify(input.subject)}`);
  }
  if (typeof input.detail !== 'string' || input.detail.length === 0) {
    throw new RecoveryError(`ambiguity marker detail must be a non-empty string, received: ${JSON.stringify(input.detail)}`);
  }
  if (
    input.alternatives !== undefined &&
    (!Array.isArray(input.alternatives) ||
      !input.alternatives.every((entry) => typeof entry === 'string' && entry.length > 0))
  ) {
    throw new RecoveryError('ambiguity marker alternatives must be an array of non-empty strings when present');
  }
  return input.alternatives === undefined
    ? { kind: input.kind, subject: input.subject, detail: input.detail }
    : { kind: input.kind, subject: input.subject, detail: input.detail, alternatives: [...input.alternatives] };
}

/**
 * Deterministic marker ordering: by kind, then subject, then detail — stable
 * across runs so canonical serialization and report output are byte-stable.
 */
export function compareAmbiguityMarkers(a: AmbiguityMarker, b: AmbiguityMarker): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
  if (a.detail !== b.detail) return a.detail < b.detail ? -1 : 1;
  return 0;
}
