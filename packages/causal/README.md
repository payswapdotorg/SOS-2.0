# @sos-2/causal

SOS 2.0 Causal Knowledge (Work Order W5, parallel slot B). Hypotheses about
**interventions, mechanisms and outcomes** — with the evidence-class
discipline that keeps correlation and causation distinct
(spec/architecture.md §5, §18; requirements R10, R22, R30).

## What lives here

| Export | Purpose |
| --- | --- |
| `CausalHypothesisArtifact` | a Semantic Spine envelope (frozen kind `CausalHypothesis`) plus content: intervention description, mechanism, predicted outcomes, ASSUMPTIONS (retained, ≥ 1), context (≥ 1 fact), ALTERNATIVE EXPLANATIONS (each retained verbatim, never collapsed), refutation conditions (≥ 1 — falsifiability is mandatory), the minimal causal graph, strictly class-separated evidence references, uncertainty, producer, optional correlation origin |
| `createCausalHypothesis` | deterministic content-addressed minting (`sos://CausalHypothesis/<32 hex>` over the creation address) — **runs the claim gate**: `claim_strength: 'CAUSAL'` requires ≥ 1 INTERVENTIONAL evidence reference with availability SUCCESS, else `CausalError` |
| `assertClaimSupportedByEvidence` / `hypothesisEvidenceSupport` | the §18 claim-vs-evidence rule — **delegated to `@sos-2/evidence`'s `supportsStrongCausalClaim`** (the merged W3 authority; never re-implemented here) |
| `ObservationalEvidenceRef` / `InterventionalEvidenceRef` | the two DISTINCT evidence reference types (`evidence_class` literal discriminant); builders `observationalEvidenceRef` / `interventionalEvidenceRef` THROW on class mismatch — an observational record can never be laundered into an interventional reference; `assertNoDuplicateEvidenceReferences` rejects double citation |
| `CorrelationRecordArtifact` | an observed association (`CorrelationRecord` is an explicitly-registered spine extension kind) — structurally INCAPABLE of expressing causation (no claim strength, no mechanism, no graph); requires ≥ 2 variables and ≥ 1 evidence reference |
| `hypothesisFromCorrelation` | the ONLY path from a correlation record to a causal claim: explicit, evidence-gated (throws without interventional SUCCESS evidence), provenance-preserving (`correlation_origin` + a DERIVED_FROM trace link) — a correlation is **never silently promoted** |
| `CausalGraph` | the minimal causal graph: factors + typed edges — `CONTRIBUTES_TO` (cause → effect) and `CONFOUNDS` (confounder on a cause → effect relation); unique factor ids, known endpoints, no self-edges, no duplicate edges, confounder distinct from both sides; cycles are permitted (adjudicating them is causal inference, which is out of scope) |
| `CausalKnowledgeStore` | envelope lifecycle for hypotheses and correlations (contiguous version+1 supersedes chains, ACTIVE-only revision), SUPPORTS links minted from every distinct evidence reference, DERIVED_FROM links for revisions and promotions, `history()` / `activeHypotheses()` / `evidenceSupporting()` queries — every listing sorted by id (deterministic) |

## Identity discipline

Ids are ALWAYS minted by `@sos-2/semantic-spine` (deterministic
content-addressing over the creation address — envelope fields minus `id`,
plus content — exactly the `@sos-2/mission` pattern):

```
sos://CausalHypothesis/<first 32 hex of sha-256 over the creation address>
sos://CorrelationRecord/<first 32 hex of sha-256 over the creation address>
```

`CausalHypothesis` is one of the 19 frozen core kinds — no registration is
performed or needed. `CorrelationRecord` is a documented, explicitly
registered extension kind (the spine's sanctioned add-only
`registerArtifactKind` API — the same precedent as W3's `ProvenanceRecord`).
The golden fixtures (`fixtures/causal-hypothesis.json`,
`fixtures/correlation.json`) reproduce bit-exactly from the documented
sample inputs (pinned by tests).

## The claim gate (locked invariant)

`spec/architecture.md` §18: *intervention evidence outranks observational
correlation for strong causal claims*. A hypothesis asserts
`claim_strength: 'CAUSAL' | 'CORRELATIONAL'`; construction validates the
assertion against the evidence:

- `CAUSAL` requires ≥ 1 interventional SUCCESS reference — observational
  references, however many, never suffice, and the attempted upgrade is
  REJECTED loudly (at creation, at revision, and at promotion);
- `CORRELATIONAL` claims less than the evidence supports — always
  permitted.

The rule itself is consumed from `@sos-2/evidence`
(`supportsStrongCausalClaim`); this package never re-implements it.

## Uncertainty discipline

`uncertainty` is the W3 `Confidence` type: a CALIBRATED numeric probability
is valid ONLY with a well-formed `calibration_ref` spine artifact id;
otherwise a qualitative uncertainty class is used
(`STRONG`/`MODERATE`/`WEAK`/`UNQUANTIFIED`). LLM-drafted hypotheses
(`producer.model !== null`) can never carry calibrated confidence — an LLM
self-reported confidence value is never calibrated truth
(spec/meta-model.md).

## Layering

```
@sos-2/semantic-spine (W0.5, frozen)   ←  @sos-2/causal (this package)
@sos-2/evidence       (W3, merged)     ←     (Confidence discipline, the §18
                                             strong-claim rule, EvidenceRecordW3)
@sos-2/provenance     (W3, merged)     ←     (Producer, TimeWindow)
```

## Invariants pinned by tests

- Causal upgrades backed only by observational evidence are rejected — at
  creation, at revision, and at correlation promotion (explicit negative
  tests, including the "many observational records still never suffice" case)
- The two evidence reference classes are distinct types and can never be
  conflated or mis-stated; duplicate evidence citations are rejected
- Correlation records are typed distinctly from causal claims; promotion is
  explicit, evidence-gated and traced — never silent
- Numeric confidence without calibration is rejected; LLM producers can never
  carry calibrated confidence
- The minimal causal graph validates: unique factors, known endpoints, no
  self-edges, no duplicates, confounder distinct from both sides
- Every listing/query is deterministic (sorted by id); identical creation
  inputs reproduce identical artifacts bit-exactly; canonical round trips
  are byte-stable
