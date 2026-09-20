# @sos-2/provenance

SOS 2.0 Provenance (Work Order W3, parallel slot C). Answers **who or what
produced a record, against which exact revisions, over which time window and
context, derived from what — and with what availability of the underlying
source**.

## What lives here

| Export | Purpose |
| --- | --- |
| `Producer` | who/what produced a record: `tool`, `tool_version`, `model` (LLM-involved), `model_version`, `command`, `environment` |
| `TimeWindow` | `{ start, end }` RFC3339 with `start <= end` (the single W3 temporal shape; imported by telemetry and evidence) |
| `ProvenanceRecord` | exact `source_revision` / `deployment_revision` (null = genuinely unknown, preserved), `window`, structured `context`, `chain`, `source_availability` (all 6 distinct truth states; failure/unknown preserved, never dropped), `llm_output` mark |
| `ProvenanceHop` + `ProvenanceChainBuilder` | verifiable chains: every hop references a well-formed spine artifact id (`sos://…`) or an external revision token (git SHA, OCI digest, observation hash…) |
| `verifyProvenanceChain(record, resolver?)` | **broken chains are reported as UNKNOWN — never silently truncated**; ALL unresolved hops are listed |
| `ProvenanceStore` | in-memory store with deterministic (id-sorted) queries: by source/deployment revision, by tool, LLM-produced, by chain ref |
| `isNonAuthoritativeProvenance` | §18: LLM output is never authoritative evidence or authorization |

## Identity discipline

Ids are ALWAYS minted by `@sos-2/semantic-spine` (deterministic
content-addressing over the creation content minus the id):

```
sos://ProvenanceRecord/<first 32 hex of sha-256 over canonical content>
```

Identical creation input reproduces the identical id (pinned by tests).
The `ProvenanceRecord` kind segment is an explicitly-registered extension
kind in the spine's kind registry (the sanctioned `registerArtifactKind`
API — add-only, no second registry, no frozen kind is touched).

## Layering

```
@sos-2/semantic-spine (W0.5, frozen)  ←  @sos-2/provenance (this package)
                                          @sos-2/telemetry  (imports Producer/TimeWindow)
                                          @sos-2/evidence   (imports provenance records)
```

## Invariants pinned by tests

- 6 distinct truth states preserved on `source_availability` (failure and
  unknown are never dropped, never coerced).
- `llm_output` is derived from the producer's model id — LLM involvement can
  neither be hidden nor claimed falsely; LLM-produced records are
  non-authoritative.
- Chains: hop `ref_kind` must be consistent with the ref's form; a broken
  chain yields status UNKNOWN with ALL unresolved hops reported.
- Deterministic ids and canonical round trips (property tests, seed 424242).
