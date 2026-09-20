# @sos-2/packages

The SOS 2.0 Package model (Work Order W6; requirements R24, R26, R28, R29 —
the registry layer completes them): evidence-backed reusable
capability/subgraph artifacts and the strict, evidence-gated maturity
lifecycle.

## EXPORT DISCIPLINE (binding, mirrors W0.5/W2/W3)

Core identifiers, envelope logic, the 7-state maturity vocabulary and the 6
truth states are ALWAYS obtained from `@sos-2/semantic-spine` (which
re-exports `@sos-2/contracts` — the single normative source). Evidence
records and the uncertainty-class vocabulary (STRONG, MODERATE, WEAK,
UNQUANTIFIED) come from `@sos-2/evidence`; time windows from
`@sos-2/provenance`. Nothing here duplicates an authority. This package has
zero external (npm registry) runtime dependencies.

## The package artifact

A `PackageArtifact` is a spine envelope (frozen core kind `Package`) plus the
exact §5 content field set (spec/architecture.md §5: "validated reusable
capability/subgraph plus contracts, applicability, evidence, failures,
assurance obligations and learned limitations"):

`semantic_capability, contracts, preconditions, postconditions, realizations,
applicability, evidence_refs, failure_refs, compatibility_refs,
composition_refs, assurance_obligations, context, learned_limitations,
diversity_profile, maturity, changes, superseded_by`

- Ids are content-addressed over the creation address
  (`packageArtifactId`), reproduced bit-exactly by identical input; explicit
  ids are accepted only as well-formed `sos://Package/<segment>` ids
  (random minting / golden fixtures).
- **The normative projection** `toPackageRecord` emits the CLOSED 8-key
  `PackageRecord` of `spec/contracts/package.schema.json`
  (additionalProperties: false) — ajv-validated in tests and reproducing the
  W0.5 golden fixture `packages/semantic-spine/fixtures/package-record.json`
  bit-exactly.
- Documented strengthenings over the JSON Schema: `evidence_refs` is
  non-empty (spec/architecture.md §18 "Packages require evidence"),
  `applicability` is non-empty and context-conditioned
  (ARCHITECT_START_HERE rejects packages without applicability),
  `assurance_obligations` is non-empty (reuse never bypasses assurance), a
  diversity profile is required (§11), and refs must be well-formed spine
  ids of the right kind.

## The strict maturity lifecycle

`DISCOVERED → FORMING → VALIDATED → MATURE → CONTEXTUALIZED →
SUPERSEDED/RETIRED` — no skipping, no going backwards, terminal states are
terminal (`ALLOWED_MATURITY_TRANSITIONS`). Promotion is EVIDENCE-GATED by
the frozen requirements (`MATURITY_PROMOTION_REQUIREMENTS`):

| Transition | Frozen gate |
| --- | --- |
| DISCOVERED → FORMING | ≥ 1 resolvable evidence ref |
| FORMING → VALIDATED | ≥ 1 success AND NOT one-lucky-success (≥ 2 successes OR ≥ 1 comparative/interventional) AND ≥ 1 realization |
| VALIDATED → MATURE | ≥ 4 refs, ≥ 2 successes, ≥ 1 comparative-or-interventional |
| MATURE → CONTEXTUALIZED | MATURE gate AND ≥ 1 CALIBRATED applicability estimate |
| * → SUPERSEDED | administrative: requires the replacement id |
| * → RETIRED | administrative |

The **one-lucky-success** rejection (spec/architecture-lock.md forbidden
shortcut "package promoted after one lucky success") is machine-checked:
exactly one SUCCESS record with zero comparative/interventional records
never validates a package. Every cited ref must resolve — evidence outranks
assertion about system reality.

## Applicability (context-conditioned, never a universal score)

- `QUALITATIVE` (default): an uncertainty class + a NON-EMPTY context
  condition (an empty context is a universal score — rejected).
- `CALIBRATED`: numeric probability in [0,1] valid ONLY together with ALL of
  `calibration_ref` (well-formed spine id), `sample_size ≥ 1`, a non-null
  time window and a non-empty context. There is no code path that mints an
  uncalibrated numeric applicability.
- Conflicting estimates for one context are rejected (two calibrated numbers
  for one context, or two qualitative classes); a calibrated + qualitative
  pair for the same context is the sanctioned refinement flow.
- `betaPosterior` is the deterministic, dependency-free baseline for binary
  package outcomes (docs/probabilistic-learning.md): posterior mean, variance,
  90% equal-tailed credible interval and sample size — a bare mean is never
  the whole story.

## Package evidence classification

`classifyPackageEvidence` derives the docs/package-ecology.md evidence
classes (observational success, comparative, interventional, failure,
transfer, composition, longevity/decay, unclassified) from the NORMATIVE W3
evidence-record fields — deterministically, never from free-text claims.

## Architecture Delta

`architecture-delta.json` (this directory) is the W6 Architecture Delta
record — validated through the spine's `assertValidArchitectureDelta` by
`test/delta.test.ts`.
