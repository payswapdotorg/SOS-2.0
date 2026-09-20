# @sos-2/adapters

SOS 2.0 Platform Adapters (Work Order W12, parallel slot C). Replaceable
**adapter contracts** — interfaces plus in-memory reference
implementations — for the reference stack (docs/implementation/REFERENCE-STACK.md).
Per spec/architecture.md §17: *platforms and vendors are adapters or
contexts; they do not redefine SOS semantics.*

## What lives here

| Export | Purpose |
| --- | --- |
| `RepositoryAdapter` / `InMemoryRepositoryAdapter` | durable store contract for spine **envelopes and trace links** — delegates storage mechanics to the spine's own `EnvelopeStore`/`TraceLinkStore`; a PostgreSQL/file/… adapter implements the same interface and preserves the same spine semantics |
| `TelemetryIngestionAdapter` / `InMemoryTelemetryIngestionAdapter` | evidence-ingestion contract for telemetry backends — **consumes** `@sos-2/telemetry`'s OTel shapes and `convertOtelBatch` verbatim; can also record truthful **gaps** (`UNAVAILABLE` observations — never zero, never absence-of-failure) |
| `ReasoningProviderAdapter` / `InMemoryReasoningProviderAdapter` | the reasoning-provider contract for LLM providers — prompt/complete with **model id + version** provenance on every output; completions are structural bridges `{ content: JsonValue, producer: Producer }` |
| `reasoningOutputAsEvidence` | mints the W3 evidence record for a completion, returned **narrowed to `NonAuthoritativeEvidence` (`llm_output: true`)** — an LLM output can never be *typed* as authoritative evidence (§18) |
| `ExecutionAdapter` / `InMemoryExecutionAdapter` | contract for running candidate code — every request **carries the AuthorityGrant + evaluation point**; the reference implementation validates through `@sos-2/authority`'s `evaluateGrant` before running (expired/revoked → `EXECUTION_DENIED` with a structured reason) |
| `DOMAIN_SEMANTIC_TYPES` / `assertValidAdapterDescriptor` / `verifyAdapterOutputs` | **the semantic bridge** — the closed registry of domain types adapter outputs may bridge onto (guards consumed verbatim from their owning packages) plus the runtime guard |

## The semantic bridge (adapters cannot redefine semantics)

An adapter is a **structural bridge to domain types**, never a source of new
semantics. The enforcement has two layers:

1. **Type level** — `AdapterContractDescriptor.outputs` is
   `Readonly<Record<string, DomainSemanticTypeName>>` where
   `DomainSemanticTypeName` is `keyof` the closed registry. An adapter whose
   output bridges to anything outside the registry **does not compile**.
2. **Runtime** — `assertValidAdapterDescriptor` rejects descriptors whose
   bridges reference unregistered domain types (cast forgeries included),
   and `verifyAdapterOutputs` rejects concrete outputs whose bridged fields
   fail the **owning package's** domain guard. The reference adapters in
   this package run the guard on everything they produce — live, not only
   in tests.

Bridgeable domain types (registry, each with its owning package's guard):
`ArtifactId`, `ArtifactEnvelope`, `TraceLink`, `EvidenceTruthState`,
`JsonValue`, `Producer`, `TimeWindow`, `RawObservation`, `EvidenceRecord`,
`AuthorityGrant`. Adapter control-plane fields (denial codes, error strings)
are operational metadata, not semantic payloads.

## Authority-gated execution

`execute` validates the grant through the merged W1 authority
(`evaluateGrant`) **before** anything runs: an `EXPIRED` or `REVOKED` grant
yields `EXECUTION_DENIED` with a structured denial (`GRANT_EXPIRED` /
`GRANT_REVOKED` + the grant ref + a deterministic reason); a **missing**
grant is rejected loudly at validation. A denial is never reported as a
failure of the candidate — refusing to run and running-and-failing are
distinct facts. This is the same frozen evaluation consumed by
`@sos-2/runtimes`' RuntimeHost; neither package re-implements it.

## Layering

```
@sos-2/semantic-spine  ─┐
@sos-2/provenance       ─┤
@sos-2/telemetry        ─┼──  @sos-2/adapters  (this package)
@sos-2/authority        ─┤     (no adapter introduces any semantic type,
@sos-2/evidence         ─┘      identifier or truth state of its own)
```
