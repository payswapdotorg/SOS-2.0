# @sos-2/memory

SOS 2.0 Architecture Memory (Work Order W5, parallel slot B). Durable
learning from predictions, observations, outcomes, **failures, technical
liabilities, rollbacks and learned rules** (spec/architecture.md §5;
requirements R19, R21, R22, R30) — memory that **never forgets** and never
loses its provenance.

## What lives here

| Export | Purpose |
| --- | --- |
| `ArchitectureMemoryArtifact` | a Semantic Spine envelope (frozen kind `ArchitectureMemory`) plus versioned content: `entries` (the seven entry kinds) + `update` (the provenance of THIS version: `producer` — who/what produced it — and `evidence_refs` — from which evidence) |
| `createArchitectureMemory` / `assertValidArchitectureMemory` | deterministic content-addressed minting (`sos://ArchitectureMemory/<32 hex>` over the creation address) and loud validation |
| `MemoryEntry` | the discriminated union of the seven entry kinds — `PREDICTION` (forward-looking; optionally derived from a `CausalHypothesis` artifact via `hypothesis_ref`), `OBSERVATION` (≥ 1 evidence ref), `OUTCOME` (realized verdict `REALIZED`/`NOT_REALIZED`/`UNKNOWN` + prediction refs + ≥ 1 evidence ref), `FAILURE` (**non-null context required, retained verbatim**; ≥ 1 evidence ref), `LIABILITY` (severity + owner-kind + resolution), `ROLLBACK` (from/to revisions + reason + ≥ 1 evidence ref), `LEARNED_RULE` (**non-empty applicability context + ≥ 1 evidence refs — rules without evidence are rejected**; uncertainty with calibration discipline) |
| `LiabilityResolution` | the validated resolution state machine — `OPEN → ACKNOWLEDGED → MITIGATED → RESOLVED` (terminal), with `ACCEPTED` (risk acceptance, terminal) reachable from every non-terminal state; MITIGATED/RESOLVED require resolution evidence, RESOLVED requires a timestamp |
| `assertValidMemoryEvolution` | **THE EVOLUTION RULE** (pure, exported): across a revision no entry may ever be dropped; failure entries are immutable (contexts retained verbatim); liability entries may change ONLY in resolution (with valid state transitions); every other entry is immutable; revisions may only append |
| `ArchitectureMemoryStore` | envelope lifecycle (contiguous version+1 supersedes chains, ACTIVE-only revision), SUPPORTS links minted from every distinct evidence reference, DERIVED_FROM revision lineage links, `history()` / `active()` / `entriesOf()` / `failuresOf()` / `liabilitiesOf()` / `learnedRulesOf()` — all deterministic (sorted by id / entry id) |

## Identity discipline

Ids are ALWAYS minted by `@sos-2/semantic-spine` (deterministic
content-addressing over the creation address — envelope fields minus `id`,
plus content — exactly the `@sos-2/mission` pattern):

```
sos://ArchitectureMemory/<first 32 hex of sha-256 over the creation address>
```

`ArchitectureMemory` is one of the 19 frozen core kinds — no registration is
performed or needed. The golden fixture (`fixtures/architecture-memory.json`)
reproduces bit-exactly from the documented sample input (pinned by tests).

## The evolution rule (locked discipline)

Memory never forgets, and mutations that would quietly rewrite history are
rejected loudly at every revision:

- **No drops**: every entry id present in a version must be present in the
  next (deletion is impossible through the store);
- **Failures are immutable**: failure entries (including their contexts)
  are retained byte-identically — contexts of failure are never dropped or
  rewritten;
- **Liabilities change only in resolution**: statement, severity, owner-kind,
  context and recorded_at are immutable; only the resolution object may
  change, and only along the validated state machine (re-assessments
  require a NEW liability entry; the old record stays in the append-only
  history);
- **Everything else is immutable**: corrections are NEW entries; the old
  entries remain queryable through the complete `history()` chain.

## Update provenance discipline

Every memory update carries `update: { producer, evidence_refs }` plus the
spine envelope's mandatory non-empty `provenance` entries. A memory update
without provenance is rejected: the producer must be a valid W3 `Producer`
and every evidence ref must be a well-formed `sos://Evidence/<32 hex>` id.
An LLM-produced update (`producer.model !== null`) can never attach
calibrated numeric confidence to a learned rule — an LLM self-reported
confidence value is never calibrated truth (spec/meta-model.md).

## Layering

```
@sos-2/semantic-spine (W0.5, frozen)   ←  @sos-2/memory (this package)
@sos-2/evidence       (W3, merged)     ←     (Confidence discipline,
                                             Evidence-kind id validation)
@sos-2/provenance     (W3, merged)     ←     (Producer)
```

Memory entries may reference causal hypothesis artifacts by spine id
(`sos://CausalHypothesis/<32 hex>` on predictions) — `@sos-2/causal` (the
W5 sibling) composes with this package through the spine without a code
dependency.

## Invariants pinned by tests

- Liability deletion is rejected; only resolution state changes are accepted
  (statement/severity/owner-kind mutations rejected loudly)
- Failure entries (and their contexts) are retained verbatim — never
  dropped, never rewritten
- Memory updates without provenance are rejected (empty envelope provenance,
  missing/invalid producer, non-Evidence evidence refs)
- Learned rules without evidence refs are rejected; empty applicability is
  rejected
- Numeric confidence without calibration is rejected; LLM updates can never
  attach calibrated confidence to learned rules
- history() is complete, contiguous and version-ordered; every listing and
  entry query is deterministic (sorted); identical creation inputs reproduce
  identical artifacts bit-exactly; canonical round trips are byte-stable
