# @sos-2/evidence

SOS 2.0 Evidence (Work Order W3, parallel slot C). The **Evidence Graph** and
the telemetry ingestion contracts: what the system knows, on the basis of
**which exact evidence, captured how, against which exact revisions and time
windows — and how stale that evidence is now**.

## What lives here

| Export | Purpose |
| --- | --- |
| `EvidenceRecordW3` | the canonical evidence record: the normative `EvidenceRecord` contract (`@sos-2/contracts`, unchanged) extended through the schema's open extension point with `evidence_class`, `method`, `window`, `subject_revision`, `confidence`, `producer`, `llm_output` |
| `createEvidence` / `assertValidEvidenceRecord` | deterministic content-addressed minting (`sos://Evidence/<32 hex>`) and loud validation — the contracts layer runs FIRST, then the exact W3 field set |
| `EvidenceClass` | `OBSERVATIONAL` \| `INTERVENTIONAL` — exactly one per record, never conflated; the normative `observational`/`intervention` booleans are DERIVED from it |
| `supportsStrongCausalClaim` | §18: intervention evidence outranks observational correlation — a strong causal claim requires interventional SUCCESS evidence |
| `Confidence` | calibrated numeric confidence ONLY with a `calibration_ref` (well-formed spine artifact id); qualitative uncertainty classes (`STRONG`/`MODERATE`/`WEAK`/`UNQUANTIFIED`) otherwise; LLM producers can never carry calibrated confidence |
| `ingestObservation` | the truth-state assignment from telemetry: VERBATIM under the explicit method provenance `telemetry:capture-availability`; the observation is bit-exactly referenced in provenance by `observation:sha256:<hash>` |
| `evaluateFreshness` | stale-evidence detection with 4 DISTINCT statuses: `FRESH`, `EXPIRED_TIME_WINDOW`, `SUPERSEDED_SUBJECT_REVISION`, `UNKNOWN_PROVENANCE` (deterministic precedence, no hidden clocks) |
| `EvidenceGraph` | records + the spine's typed trace links (its own `TraceLinkStore`); `observe()` links evidence OBSERVES its subject; `evidenceObserving(systemStateId)` is the evidence-to-System-State traceability query |
| `summarizeAvailability` | honest per-state counts — ALL 6 truth states always reported; UNAVAILABLE is never folded into SUCCESS or FAILURE |

## Identity discipline

Ids are ALWAYS minted by `@sos-2/semantic-spine` (deterministic
content-addressing over the creation content minus the id and derived flags):

```
sos://Evidence/<first 32 hex of sha-256 over canonical content>
```

`Evidence` is one of the 19 frozen core artifact kinds — no kind registration
is performed or needed. The golden fixture
(`fixtures/evidence.json`, id `sos://Evidence/e7f3c74939a13049bbcf014d8e1b7ab2`)
reproduces bit-exactly from the documented sample input (pinned by tests).

## Layering

```
@sos-2/semantic-spine (W0.5, frozen)  ←  @sos-2/evidence (this package)
@sos-2/provenance     (W3 sibling)    ←     (Producer, TimeWindow)
@sos-2/telemetry      (W3 sibling)    ←     (RawObservation, rawObservationHash)
```

Telemetry is INPUT, not semantic truth: truth-state assignment happens HERE,
with explicit method provenance. Ingested evidence is ALWAYS OBSERVATIONAL —
interventional evidence only ever comes from explicit intervention creation.

## Invariants pinned by tests

- The 6 distinct truth states pass through ingestion VERBATIM
  (`assertTruthStateIs` pins each state exactly).
- **UNAVAILABLE is NEVER interpreted as zero or absence-of-failure**
  (spec/architecture-lock.md): a gap observation becomes UNAVAILABLE evidence;
  the availability summary counts it as UNAVAILABLE, never as success/zero.
- UNKNOWN, UNSUPPORTED, FAILURE and PARTIAL all stay distinct through
  ingestion and validation.
- Observation/intervention XOR on every record; class conflation is rejected.
- Calibrated numeric confidence requires a calibration artifact ref AND a
  non-LLM producer (an LLM self-reported confidence value is never calibrated
  truth — spec/meta-model.md).
- `llm_output` is derived from the producer's model id — LLM involvement can
  neither be hidden nor claimed falsely; LLM-produced evidence is
  non-authoritative (§18).
- Freshness is total and deterministic over every valid record, with distinct
  statuses for expired windows, superseded subject revisions and unknown
  provenance; precedence is documented.
- Deterministic ids, canonical round trips and graph determinism
  (property tests, seed 424242).
