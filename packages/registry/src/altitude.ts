/**
 * Retrieval altitude — the typed reasoning-altitude ladder of
 * spec/architecture.md §10:
 *
 *   "Search starts at the highest safe validated reasoning altitude:
 *    validated composition -> validated package -> package adaptation ->
 *    architecture pattern -> novel architecture -> low-level synthesis."
 *
 * The full six-rung ladder is the frozen typed vocabulary (downstream
 * search Work Orders W7+ consume the same field); the W6 registry occupies
 * the first three rungs (plus reserves the pattern rung for downstream
 * pattern-level entries):
 *
 *   VALIDATED_COMPOSITION  a composition entry at validated-or-beyond
 *                          maturity (validated composed reasoning is the
 *                          highest reusable altitude);
 *   VALIDATED_PACKAGE      a package entry at validated-or-beyond maturity;
 *   PACKAGE_ADAPTATION     a package OR composition entry below validated
 *                          maturity — reusing it requires adaptation and
 *                          validation first (the reasoning altitude of the
 *                          RESULT, not the artifact type);
 *   ARCHITECTURE_PATTERN   reserved for pattern-level entries (downstream
 *                          Work Orders; never minted by the W6 registry);
 *   NOVEL_ARCHITECTURE     reserved for downstream candidate search;
 *   LOW_LEVEL_SYNTHESIS    reserved for downstream candidate search.
 *
 * Ranking honors the ladder: results are ordered by ALTITUDE_RANK
 * ascending — validated compositions before validated packages before
 * adaptation-level entries — within the diversity-preserving candidate set.
 */

import type { PackageMaturity } from '@sos-2/semantic-spine';
import { isValidatedMaturity } from '@sos-2/packages';

/** The frozen §10 retrieval-altitude ladder (see module doc). */
export const RETRIEVAL_ALTITUDES = [
  'VALIDATED_COMPOSITION',
  'VALIDATED_PACKAGE',
  'PACKAGE_ADAPTATION',
  'ARCHITECTURE_PATTERN',
  'NOVEL_ARCHITECTURE',
  'LOW_LEVEL_SYNTHESIS',
] as const;

export type RetrievalAltitude = (typeof RETRIEVAL_ALTITUDES)[number];

const RETRIEVAL_ALTITUDE_SET: ReadonlySet<string> = new Set(RETRIEVAL_ALTITUDES);

export function isRetrievalAltitude(value: unknown): value is RetrievalAltitude {
  return typeof value === 'string' && RETRIEVAL_ALTITUDE_SET.has(value);
}

/** Total order over the ladder (lower rank = higher, safer reuse altitude). */
export const ALTITUDE_RANK: Readonly<Record<RetrievalAltitude, number>> = {
  VALIDATED_COMPOSITION: 0,
  VALIDATED_PACKAGE: 1,
  PACKAGE_ADAPTATION: 2,
  ARCHITECTURE_PATTERN: 3,
  NOVEL_ARCHITECTURE: 4,
  LOW_LEVEL_SYNTHESIS: 5,
};

/** The entry kinds the W6 registry stores. */
export type RegistryEntryKind = 'PACKAGE' | 'COMPOSITION';

/**
 * The typed retrieval altitude of an entry:
 *   - composition + validated-or-beyond maturity -> VALIDATED_COMPOSITION;
 *   - package + validated-or-beyond maturity     -> VALIDATED_PACKAGE;
 *   - anything live but below validated          -> PACKAGE_ADAPTATION.
 *
 * Entries at SUPERSEDED/RETIRED maturity never reach retrieval (they are
 * filtered before altitude computation — superseded entries are never
 * returned as current).
 */
export function altitudeOfEntry(kind: RegistryEntryKind, maturity: PackageMaturity): RetrievalAltitude {
  if (isValidatedMaturity(maturity)) {
    return kind === 'COMPOSITION' ? 'VALIDATED_COMPOSITION' : 'VALIDATED_PACKAGE';
  }
  return 'PACKAGE_ADAPTATION';
}
