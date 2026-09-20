# @sos-2/diversity

SOS 2.0 Solution Diversity (Work Order W13; spec/architecture.md §11;
requirement R28; spec/architecture-lock.md: "universal package winner
replacing a diverse repertoire" is a forbidden shortcut).

## The diversity archive — a §11-constrained MAP-Elites repertoire

`DiversityArchive` **composes** the merged Quality-Diversity repertoire of
`@sos-2/optimization` (`MapElitesArchive`, `MapElitesSpec`,
`EliteCandidate` — the W7 QD authority, imported and never duplicated) and
adds the package-population discipline:

- **The population is packages and compositions**: every entry id must be a
  well-formed spine id of kind `Package` or `PackageComposition` (enforced
  at insert and on restore).
- **The behavior space is the nine frozen §11 dimensions**: cost, latency,
  resilience, privacy, resource footprint, topology, operational
  complexity, customization, human comprehensibility. The dimension
  vocabulary is IMPORTED from `@sos-2/packages` (`DIVERSITY_DIMENSIONS`)
  and projected onto canonical lowercase axis names; a spec with an axis
  OUTSIDE §11 is REJECTED (adding a behavioral dimension is an architecture
  change, not an implementation choice). Any NON-EMPTY SUBSET of the nine
  axes is a legitimate sub-space archive; `defaultDiversitySpec()` covers
  all nine with documented default bin edges (caller-replaceable
  edge-for-edge).
- **All QD mechanics are the W7 authority's**: typed behavior descriptors,
  per-cell elites, deterministic confluent (order-independent) updates,
  within-cell competition only — materially different families land in
  different cells and NEVER evict each other.
- **Uncertainty is carried through verbatim** (mandatory
  `CarriedUncertainty`; a numeric probability without its calibration ref
  is REJECTED — §12, enforced by the W7 authority).

## Coverage reports — deterministic and canonical

`coverageReport()`: per-axis occupied-bin statistics, occupancy ratio, the
distinct families present, and the per-cell repertoire summary — a pure
function of the archive state, byte-identical across insertion orders
(property-tested), round-tripping through snapshots.

## Diversity guards — repertoire preservation is machine-checked

`guard.ts`:

- `assertPreservesFamilies(population, selected, minFitness)` REJECTS any
  selection that would drop EVERY representative of a materially different
  HIGH-PERFORMING family (best fitness ≥ the caller-declared threshold —
  the guard never invents the threshold). This includes the single-winner
  collapse: selecting only one family's champion while other high-performing
  families exist is REJECTED.
- Selections may only REDUCE the population — a selection containing
  entries outside the population is REJECTED.
- `familyRepresentatives(population)` is the sanctioned reduction: the best
  entry per family (canonical id tiebreak), which by construction never
  collapses a family and always passes the guard.
- There is NO single-winner API anywhere in this package.

## Export discipline

The §11 dimension vocabulary and diversity-profile family vocabulary come
from `@sos-2/packages`; the QD archive mechanics come from
`@sos-2/optimization`; spine id checks come from `@sos-2/semantic-spine`.
Nothing here duplicates an authority; invalid input always fails loudly.
