# @sos-2/assurance

SOS 2.0 Living Assurance (Work Order W8, parallel slot B). **AssuranceCase
artifacts** — claims, arguments, assumptions, hazards, controls, evidence
references, validity conditions and first-class objections — plus
**deterministic validity evaluation**: the case tells you, at any moment,
whether it still holds against the current implementation/dependency/
environment revisions, the freshness of its evidence and the satisfaction of
its assumptions, with **distinct tracked invalidation reasons**.

## What lives here

| Export | Purpose |
| --- | --- |
| `AssuranceCaseArtifact` | a Semantic Spine envelope (frozen core kind `AssuranceCase`) + the exact eight-section content: `claims`, `arguments`, `assumptions`, `hazards`, `controls`, `evidence`, `validity_conditions`, `objections` (spec/architecture.md §5, docs/assurance-model.md) |
| `createAssuranceCase` / `assertValidAssuranceCase` | deterministic content-addressed minting (`sos://AssuranceCase/<32 hex>`) and loud validation (cross-references resolvable: arguments→claims, controls→hazards, evidence refs→claims; no duplicate `(evidence_id, claim_ref)` pairs) |
| `evaluateAssuranceCase` | the living-assurance verdict: `VALID` \| `OBJECTIONED` \| `INVALID` with **15 distinct tracked invalidation reasons** (see below); deterministic, total, no hidden clocks |
| `addObjection` / `resolveObjection` | the objection lifecycle as case revisions (version + 1, supersedes the head); resolutions require a note, an instant and provenance; resolutions are terminal |
| `assertValidCaseRevision` | the revision guard: **objections are recorded, never dropped** — no removal, no RESOLVED→OPEN regression, no resolution rewriting |
| `adoptConformanceEvidence` | adoption of merged conformance evidence (W2 drift records, W4 runtime-conformance records) into the case: appends the evidence reference AND mints the spine trace link `evidence.id --VERIFIES/SUPPORTS/CONTRADICTS--> case.id` |

## The verdict model (living assurance)

The verdict is **derived, never stored** — a stored verdict would go stale
silently, which is exactly what living assurance exists to prevent.

```
INVALID       any invalidation reason (below)
OBJECTIONED   mechanically valid, but unresolved objections stand
              (objections are first-class and always surface in the verdict)
VALID         everything holds and no objection is open
```

INVALID dominates OBJECTIONED dominates VALID. Evaluation rejects SUPERSEDED
and RETIRED cases — a terminal case never re-issues a verdict.

### Invalidation reasons (distinct, tracked — never collapsed)

| Reason | When |
| --- | --- |
| `IMPLEMENTATION_OUT_OF_BOUNDS` / `DEPENDENCY_OUT_OF_BOUNDS` / `ENVIRONMENT_OUT_OF_BOUNDS` | the reported revision is not among the condition's recorded `valid_revisions` |
| `IMPLEMENTATION_UNREPORTED` / `DEPENDENCY_UNREPORTED` / `ENVIRONMENT_UNREPORTED` | the condition's subject was not reported at all — an unobserved bound never keeps a case VALID (fail-safe) |
| `EVIDENCE_MISSING` | a referenced evidence record is not in the provided pool |
| `EVIDENCE_EXPIRED` | supporting evidence's observation window closed (W3 freshness: `EXPIRED_TIME_WINDOW`) |
| `EVIDENCE_SUPERSEDED` | supporting evidence reflects a subject revision the system has moved past |
| `EVIDENCE_FRESHNESS_UNKNOWN` | supporting evidence is bound to neither window nor subject revision — freshness cannot be established, which is NOT fresh |
| `CONTRADICTED_BY_EVIDENCE` | a CONTRADICTS-linked record is FRESH (a stale contradiction is not a current one) |
| `SUPPORTING_EVIDENCE_FAILED` | fresh supporting evidence in truth state FAILURE |
| `SUPPORTING_EVIDENCE_INCONCLUSIVE` | fresh supporting evidence in UNKNOWN / UNAVAILABLE / UNSUPPORTED / PARTIAL — inconclusive support is not support |
| `ASSUMPTION_VIOLATED` | an assumption check returned false |
| `ASSUMPTION_UNCHECKED` | an assumption received no check — an unchecked assumption never keeps a case VALID (fail-safe) |

Freshness evaluation is **delegated to the merged W3 authority**
(`@sos-2/evidence evaluateFreshness`) — never re-implemented here.

## Conformance evidence adoption (frozen rules)

Conformance evidence kinds are **consumed from the merged packages**
(`DRIFT_EVIDENCE_KINDS` from `@sos-2/conformance`, W2;
`RUNTIME_CONFORMANCE_EVIDENCE_KIND` from `@sos-2/runtime-conformance`, W4):

- Drift records (`architecture-drift` / `architecture-contradiction`)
  document NON-CONFORMANCE: adoptable **only** with the CONTRADICTS role —
  never as support, regardless of their (SUCCESS) availability.
- Every other conformance record is keyed on truthful availability:
  SUPPORTS/VERIFIES requires `SUCCESS`; CONTRADICTS requires `FAILURE`;
  non-conclusive states (UNKNOWN / UNAVAILABLE / UNSUPPORTED / PARTIAL) can
  be adopted under **no** role — binding an inconclusive record as either
  support or contradiction would be dishonest and is rejected loudly.

## Layering

```
@sos-2/semantic-spine     (W0.5, frozen)  ←  @sos-2/assurance (this package)
@sos-2/evidence           (W3, merged)    ←     (EvidenceRecordW3, evaluateFreshness, createEvidence)
@sos-2/conformance        (W2, merged)    ←     (DRIFT_EVIDENCE_KINDS)
@sos-2/runtime-conformance (W4, merged)   ←     (RUNTIME_CONFORMANCE_EVIDENCE_KIND)
```

`AssuranceCase` is one of the 19 frozen core artifact kinds — no kind
registration is performed or needed. The golden fixture
(`fixtures/assurance-case.json`, id
`sos://AssuranceCase/cfd0c4d34161d82b443866725f7fc63e`) reproduces
bit-exactly from the documented sample input (pinned by tests).

## Invariants pinned by tests

- Objections are first-class: recorded, never dropped; resolutions are
  terminal, provenance-bearing and append-only.
- Unresolved objections surface in the verdict (`OBJECTIONED`), never
  silently absorbed into VALID.
- Expired/missing/unevaluable evidence keeps a case INVALID — never VALID.
- All 15 invalidation reasons stay distinct (each has a dedicated negative
  and positive test).
- Evaluation determinism: identical `(case, input)` pairs produce
  byte-identical results (property tests, fixed seed).
- Canonical round trips: `JSON.parse(JSON.stringify(case))` preserves
  validity and equality (property tests).
