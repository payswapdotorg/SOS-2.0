/**
 * @sos-2/adapters — SOS 2.0 Platform Adapters (Work Order W12, parallel
 * slot C).
 *
 * Replaceable adapter CONTRACTS (interfaces + in-memory reference
 * implementations) for the reference stack:
 *
 *   - RepositoryAdapter            durable store for spine envelopes/trace
 *                                  links (storage is adapter based; semantic
 *                                  types stay framework independent)
 *   - TelemetryIngestionAdapter    OTel-shaped backends -> raw observations
 *                                  (evidence-ingestion contract; the OTel
 *                                  types and converter are CONSUMED from
 *                                  @sos-2/telemetry)
 *   - ReasoningProviderAdapter     LLM providers behind a reasoning-provider
 *                                  contract — prompt/complete with model id +
 *                                  version provenance; outputs NON-AUTHORITATIVE
 *                                  (spec/architecture.md section 18)
 *   - ExecutionAdapter             running candidate code — authority-gated
 *                                  through @sos-2/authority grant evaluation
 *
 * ADAPTERS CANNOT REDEFINE SEMANTICS (spec/architecture.md section 17,
 * spec/work-orders/W12-platform-adapters.md): every adapter output is a
 * structural bridge onto a domain type from the workspace packages,
 * enforced by the semantic bridge (semantic-bridge.ts) at the type level
 * AND at runtime — an adapter introducing a novel semantic concept is
 * REJECTED. The reference implementations run the bridge guard live on
 * everything they produce.
 */

export * from './errors.js';
export * from './json.js';
export * from './semantic-bridge.js';
export * from './repository.js';
export * from './telemetry-ingestion.js';
export * from './reasoning-provider.js';
export * from './execution.js';
