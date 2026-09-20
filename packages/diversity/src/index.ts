/**
 * @sos-2/diversity — the SOS 2.0 Solution Diversity layer (Work Order W13;
 * requirement R28; spec/architecture.md §11 "Diversity is intentional").
 *
 *   - the DIVERSITY ARCHIVE over the package/repertoire population:
 *     behavior-space coverage on the nine frozen §11 dimensions, realized
 *     as a §11-constrained MAP-Elites archive COMPOSING @sos-2/optimization's
 *     Quality-Diversity repertoire (imported, never duplicated);
 *   - the DIVERSITY GUARDS: selections that would collapse materially
 *     different high-performing families into one winner are REJECTED; the
 *     sanctioned reduction is familyRepresentatives (best per family);
 *   - deterministic, canonical COVERAGE REPORTS.
 *
 * EXPORT DISCIPLINE (binding): the §11 dimension vocabulary and the
 * diversity-profile family vocabulary come from @sos-2/packages; the QD
 * archive mechanics (spec, entries, per-cell elites, confluent updates,
 * snapshots) come from @sos-2/optimization; spine id checks come from
 * @sos-2/semantic-spine. Nothing here duplicates an authority.
 */

export * from './errors.js';
export * from './axes.js';
export * from './archive.js';
export * from './guard.js';

// Re-export the composed QD types downstream diversity consumers most often
// need (still the same single W7 authority — no duplication).
export { canonicalSerialize } from '@sos-2/semantic-spine';
export type { MapElitesSnapshot, MapElitesSpec, EliteCandidate, InsertOutcome } from '@sos-2/optimization';
