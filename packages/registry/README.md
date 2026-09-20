# @sos-2/registry

The SOS 2.0 package/composition registry (Work Order W6; requirements
R24, R26, R28, R29): versioned entries, supersession chains, evidence-gated
promotion, and altitude-ordered, diversity-preserving retrieval.

## THE registry (no second package authority)

Entries are keyed by their SPINE identities (content-addressed
`sos://Package/...` and `sos://PackageComposition/...` ids). Evidence
records are NEVER stored here — the W3 Evidence Graph owns them; retrieval
resolves refs through a caller-supplied `evidenceResolver`, and
unresolvable refs are reported honestly as unresolved (never as zero).

## Chain discipline

Chains are LINEAR and CONTIGUOUS (mirror of the W2 SystemStateStore):
superseding artifacts reference a registered ACTIVE head of the same kind,
version = head.version + 1, no branching, `semantic_capability` invariant
within a chain, and **failure memory is monotonic** (a superseding revision
may never drop failure refs — negative evidence and liabilities are
retained). Re-put of identical content is idempotent; different content
under the same id is a collision.

## Maturity changes happen ONLY through promote()

`promote()` is the evidence-gated path (the frozen gates from
`@sos-2/packages`; one-lucky-success rejected; every cited ref must
resolve). Direct puts of maturity-changing revisions are rejected — no
silent autonomy. Validated-or-beyond live ROOTS must present evidence
records that pass the entering-transition gates. `activate()` (DRAFT →
ACTIVE) is the publication gate; only ACTIVE heads can be superseded or
promoted. Compositions promoted to a validated-or-beyond maturity must
present their OWN evidence (member evidence never substitutes).

## Compositions

Registering a composition requires its members to be REGISTERED packages
whose declared contracts cover each member's bound contracts (reuse never
bypasses compatibility), and mints the spine **COMPOSES** trace links
(queryable via `compositionsFor(packageId)`).

## Retrieval (by capability + context)

`retrieve({ capability, contracts?, context?, evidenceResolver?,
maxPerFamily?, maxResults? })`:

- **Altitude ordering** (spec/architecture.md §10, typed field
  `altitude`): validated composition → validated package → package
  adaptation (pattern/novel/synthesis rungs are reserved for downstream
  search); results are ranked by the ladder, then context match, then
  uncertainty quality, then evidence volume, then id (a total, deterministic
  order — `compareCandidates`).
- **Diversity preservation** (§11; the lock forbids a universal winner):
  the candidate set groups by DECLARED family and NEVER collapses to one
  winner — every matching family's best candidate is always present;
  `maxPerFamily` caps per family without removing a family's
  representative; `maxResults` truncates with a representative floor.
- **Honest uncertainty + evidence context**: results carry the best
  context-matching applicability estimate (calibrated probability WITH
  sample size, window and calibration ref; qualitative classes otherwise;
  UNQUANTIFIED with an explicit basis when nothing matches), resolved
  evidence class counts (unresolved counted as unresolved — never zero),
  learned limitations verbatim, and failure contexts (retained failure refs
  with resolved truth states; unresolved ones marked UNAVAILABLE — a gap is
  data about missing data, never absence-of-failure).
- **Superseded never current**: only chain heads with ACTIVE envelopes and
  non-terminal maturity are retrievable; `current(id)` walks to the head
  (which honestly reports SUPERSEDED maturity and `superseded_by`), and
  `history(id)` returns the full root → newest chain.
