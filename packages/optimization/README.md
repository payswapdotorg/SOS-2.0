# @sos-2/optimization

SOS 2.0 multi-objective and quality-diversity evaluation (Work Order W7;
requirements R12, R28; spec/architecture.md §9, §11).

## Pareto — non-dominated sorting over typed objectives (never a single winner)

`nonDominatedSort(candidates)` / `paretoFrontOf(candidates)`:

- **Typed objectives** on the §11 behavioral dimensions — the axis vocabulary
  is IMPORTED from `@sos-2/packages` (`DIVERSITY_DIMENSIONS`), never
  redefined. Six core axes carry frozen natural directions:
  `COST`/`LATENCY`/`RESOURCE_FOOTPRINT` (MINIMIZE) and
  `RESILIENCE`/`PRIVACY`/`HUMAN_COMPREHENSIBILITY` (MAXIMIZE); flipping a
  frozen direction is rejected. The remaining §11 dimensions
  (`TOPOLOGY`, `OPERATIONAL_COMPLEXITY`, `CUSTOMIZATION`) may be optimized
  over with a caller-declared direction.
- **Dominance** is weak Pareto dominance: at least as good on every
  objective, strictly better on at least one. Dominance is defined only over
  a COMMON objective space — mixed axis sets in one sort are rejected
  loudly.
- **The result is the FRONT** (rank-0 of the full front partition), never a
  single winner: every mutually non-dominated candidate is returned, and
  the fronts PARTITION the input — no candidate is ever discarded by a
  ranking collapse (spec/architecture-lock.md: a single global architecture
  score is never the sole authority). There is no winner/best API.
- **Determinism**: O(n²) non-dominated sorting, canonical id ordering within
  each front; the fronts are a pure function of the input SET
  (permutation-invariance is property-tested).

## Quality-Diversity repertoire — a MAP-Elites-style archive

`MapElitesArchive`:

- **Typed behavior descriptors**: each archive declares behavior axes with
  explicit strictly-ascending bin edges; a candidate's behavior record must
  cover exactly those axes; its cell is the bin-index tuple.
- **Per-cell elites**: each cell keeps exactly one elite — the
  highest-fitness candidate seen for that cell (fitness is a WITHIN-CELL
  competition scalar, higher is better; it never becomes a global ranking).
- **Deterministic, order-independent (confluent) updates**: equal-fitness
  contests resolve by canonical id (smaller wins), so the final archive is a
  pure function of the candidate SET, independent of insertion order
  (property-tested with random shuffles).
- **The repertoire preserves materially different high-performing solution
  families**: candidates with different behavior land in different cells and
  never evict each other — a globally dominant family cannot collapse the
  repertoire (unit- and property-tested).
- **Snapshots** round-trip through `MapElitesArchive.restore` (canonical
  serialization is stable).

## Uncertainty preserved end-to-end (§12)

Every candidate entering evaluation — Pareto or repertoire — MUST carry a
`CarriedUncertainty` payload: qualitative `uncertainty_class` (vocabulary
from `@sos-2/evidence`), `sample_size`, and optionally a
`calibrated_probability` that is valid ONLY together with its
`calibration_ref` (a well-formed spine artifact id — numeric confidence is
valid only where calibration exists). The payload rides through evaluation
verbatim and is present on every result; results never collapse to point
scores or fitness values alone. An uncertainty-stripped candidate is
rejected loudly (negative-tested), as is a numeric probability without
calibration evidence.

## Export discipline

The objective-axis vocabulary and the uncertainty-class vocabulary are
imported from `@sos-2/packages` / `@sos-2/evidence`; canonical
serialization and spine id checks come from `@sos-2/semantic-spine`.
Nothing here duplicates an authority; invalid input always fails loudly.
