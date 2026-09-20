# @sos-2/transfer

SOS 2.0 Transfer (Work Order W13; spec/architecture.md §5, §11, §12, §18;
docs/package-ecology.md: transfer evidence class, applicability discipline,
specialization/generalization, failure memory).

## Transfer evidence — a distinct evidence class

`TransferStore.recordTransfer` / `createTransferRecord`:

- **Context-conditioned by construction**: a transfer is recorded between a
  SOURCE context (where the solution was known) and a TARGET context (the
  new one). The two must DIFFER — applying a solution in the context it is
  already known in is not a transfer. Empty (universal) contexts are
  rejected by the W6 context authority.
- **The source's applicability is NEVER updated (machine-checked)**: the
  estimate a transfer FEEDS must be conditioned WITHIN the target context.
  An estimate conditioned on the source context is REJECTED at construction
  with a specific error — and re-checked on every restore. There is no code
  path that produces a source-context estimate from a transfer outcome;
  `deriveTargetEstimate` only ever returns target-conditioned estimates
  (declared estimate, or a derived qualitative `WEAK` estimate conditioned
  exactly on the target context for successful transfers; failures and
  inconclusive transfers feed no default estimate — they are retained as
  negative evidence).
- **Numeric probability only with calibration (§12)**: the estimate field
  is validated by the W6 applicability authority — a `CALIBRATED` numeric
  probability without its calibration artifact ref is REJECTED. There is no
  raw numeric probability field anywhere on a transfer record.
- **Causal claim territory (§18)**: a transfer record carries a
  `claim_strength` (vocabulary IMPORTED from `@sos-2/causal`: `CAUSAL` |
  `CORRELATIONAL`, default `CORRELATIONAL`). A `CAUSAL` claim ("deploying
  this package in the target context causes the observed outcomes")
  requires ≥ 1 INTERVENTION SUCCESS evidence record — the check is
  DELEGATED to `@sos-2/evidence` `supportsStrongCausalClaim` (the merged W3
  authority), never re-implemented. Observational-only causal claims are
  REJECTED.

## Specialization/generalization — typed lineage operations

`specializePackage` / `generalizePackage` (the frozen `SPECIALIZES` /
`GENERALIZES` trace types):

- **SPECIALIZE** creates a new package record for a STRICTLY narrower
  context (every base key preserved plus ≥ 1 added); **GENERALIZE** for a
  STRICTLY broader one (a proper sub-map with fewer keys; never the empty
  universal context). Non-narrowing "specializations" and non-broadening
  "generalizations" are REJECTED.
- **The base is NOT superseded** — the variant joins the repertoire
  (diversity is intentional; supersession is a separate governed decision).
- **Copied forward (superset-enforced)**: evidence refs, failure refs
  (negative evidence retained), learned limitations, contracts,
  preconditions, postconditions, realizations and assurance obligations
  (reuse never bypasses assurance). The base's applicability estimates
  consistent with the new context are carried; conflicting estimates are
  dropped only in favor of caller-supplied ones, and derived estimates must
  be CONSISTENT with the declaring context (hierarchical conditioning:
  global → domain → niche → system → current context).
- **Lineage preserves provenance (who/what/which evidence)**: the operation
  REQUIRES non-empty provenance and its OWN non-empty evidence refs; the
  lineage record carries both plus the spine trace link
  (`derived --SPECIALIZES|GENERALIZES--> base`) minted through the spine.
- **No silent autonomy**: derived packages always start `DISCOVERED` —
  maturity is earned through the W6 governed, evidence-gated lifecycle,
  never through a lineage operation. The derived artifact is created
  through the W6 authority (`createPackageArtifact`, deterministic
  content-addressed identity).
- `LineageStore` accumulates lineage records and answers `derivationsOf` /
  `ancestryOf` queries deterministically; snapshots round-trip.

## Negative evidence retained — first-class, never dropped

- **Failed transfers** are recorded exactly like successes and returned by
  every covering query surface (`transfersFor`, `failedTransfersFor`,
  `transfersInto`, `failuresInContext` — the contexts-of-failure view).
- **Invalidated assumptions** are first-class records: the falsified
  assumption, the CONTEXT OF FAILURE where it broke, and the evidence that
  invalidated it (evidence-free invalidation claims are REJECTED).
- **There is NO removal API** on the store — retention is structural,
  pinned by tests that inspect the store's own surface and by round trips
  that keep failures and invalidated assumptions intact.

## Export discipline

Spine identities, trace links and canonical serialization come from
`@sos-2/semantic-spine`; packages, contexts, applicability and maturity
discipline come from `@sos-2/packages`; evidence records and the
strong-causal-claim rule come from `@sos-2/evidence`; the claim-strength
vocabulary comes from `@sos-2/causal`. Nothing here duplicates an
authority; invalid input always fails loudly.
