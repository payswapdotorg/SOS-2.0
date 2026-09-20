# @sos-2/ecology

SOS 2.0 Package Ecology (Work Order W13; spec/architecture.md §5, §18;
docs/package-ecology.md; requirements R24, R27 partially).

## Compatibility/conflict graph — evidence-backed edges only

`EcologyGraph`:

- **Nodes are package spine identities** (`sos://Package/<32 hex>`) — the
  graph references the population, it never owns it (the W6 registry stays
  THE package authority; no second registry).
- **Edges are typed assertions** over the two frozen trace types that carry
  ecological semantics: `COMPATIBLE_WITH` and `CONFLICTS_WITH` (two of the
  17 frozen Semantic Spine trace types, consumed from
  `@sos-2/contracts`/`@sos-2/semantic-spine` — never redefined).
- **Evidence-backed assertions only (machine-checked)**: an edge assertion
  without a NON-EMPTY set of well-formed `sos://Evidence` refs is REJECTED —
  there is no code path that adds an evidence-free compatibility/conflict
  edge. Claims about system reality require evidence (spec/architecture.md
  §18).
- **Symmetric relation semantics**: assertions record the direction their
  evidence spoke about; the aggregated EDGE view canonicalizes the pair so
  `(a,b)` and `(b,a)` assertions about the same relation aggregate into one
  edge. `edgeBetween`, `neighborsOf`, `compatibleWith`, `conflictsOf` and
  `hasConflict` all answer symmetrically.
- **Coexistence reports**: `canCoexist(ids)` scans pairwise conflicts for a
  member set (≥ 2 distinct packages) with the backing evidence surfaced per
  conflicting pair.
- **Spine integration**: `toTraceLinks()` projects every assertion to a
  spine `TraceLink` (mandatory provenance) — consumable by the spine trace
  store without a second link authority.
- **Determinism**: all query outputs canonically ordered; snapshots are a
  pure function of the assertion SET (insertion order never matters —
  property-tested); `snapshot()`/`restore()` round-trip byte-identically
  with the content-address discipline enforced (tampered snapshots are
  rejected).

## Composition interaction evidence — member success never substitutes

`InteractionStore` / `recordInteraction`:

- **Typed outcomes**: `SYNERGY`, `INTERFERENCE`, `NEUTRAL` — properties of
  the COMPOSITION as a whole, distinct from any member's behavior
  (docs/package-ecology.md: "Member success does not imply composition
  success").
- **Own evidence only (machine-checked)**: every cited evidence record's
  `subject_ref` must equal the composition id — member evidence is REJECTED
  with a specific error.
- **Truth-state consistency**: a `SYNERGY` claim requires ≥ 1 cited record
  with availability `SUCCESS`; an `INTERFERENCE` claim requires ≥ 1 with
  `FAILURE`; a neutrality claim still requires own evidence.
- **Retention**: records accumulate; there is no removal API (interference
  records are retained like synergies).

## Decay/obsolescence signals — the review queue never demotes

`MaturityReviewQueue` / `recordSignal`:

- **Frozen four-kind vocabulary**: `USAGE_DECAY`, `FAILURE_RATE_GROWTH`,
  `DEPENDENCY_DEPRECATION`, `SUPERSESSION_AGE` — a closed vocabulary; an
  invented "demote"/"retire" signal kind is REJECTED (there is no signal
  that demotes).
- **Evidence-shaped input only**: every signal carries a NON-EMPTY,
  well-formed evidence ref set — evidence-free decay signals are REJECTED.
- **Signals feed a maturity REVIEW queue and never auto-demote**: the queue
  is a read-only surface for the governed review process; it exposes NO
  maturity-mutating API (no demote/retire/supersede/promote). Demotion
  stays a governed decision of the W6 maturity lifecycle (AGENTS.md §7 "No
  silent autonomy"; the lock places Package maturity outside ordinary
  redefinition) — enforced structurally and pinned by tests.
- **Deterministic canonical ordering**: review items by package id; signals
  by (observed_at, id); snapshots round-trip.

## Record identity (documented discipline)

Ecology records are records INSIDE the ecology aggregates; their ids are
deterministic content-addressed hashes (full sha-256 over the spine's
canonical serialization of the content minus the id — the W5 memory-entries
pattern). They are NOT new spine artifact kinds: no second semantic
registry is created. Every stored record is re-validated on restore, and
the content-address discipline rejects tampered snapshots.

## Export discipline

Spine identities, canonical serialization, RFC3339 and the frozen trace
types come from `@sos-2/semantic-spine`; evidence records come from
`@sos-2/evidence`. The package/composition authorities stay in
`@sos-2/packages`/`@sos-2/composition`/`@sos-2/registry` — this layer
references the population by spine ids only. Nothing here duplicates an
authority; invalid input always fails loudly.
