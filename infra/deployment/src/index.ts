/**
 * @sos-2/infra-deployment — SOS 2.0 Free-Tier Deployment Foundation
 * (Work Order P3, wave 1, worker C).
 *
 * Configuration-as-code + infrastructure contracts + CI + deterministic
 * tests for the free-tier validation topology (Vercel Hobby / Neon Free /
 * Upstash Redis Free / Cloudflare R2 Free / GitHub Actions), with the
 * honest status NOT_YET_DEPLOYED (validation accounts pending): this
 * package verifies CONTRACTS, not deployments — no real provider
 * credentials exist for this Work Order, and none are fabricated.
 *
 * Layers:
 *   - environment: typed schema (local/preview/production), fail-closed
 *     loading, preview/production isolation footprints;
 *   - providers: Vercel / Neon / Upstash (never-canonical) / R2
 *     (immutable objects) / GitHub configuration contracts;
 *   - secrets: detection, redaction, presence validation (names only);
 *   - revisions: deployment revision record contract + in-memory
 *     reference registrar (later waves wire it into System State);
 *   - health: UNKNOWN | UNAVAILABLE | DEGRADED | HEALTHY diagnostics with
 *     injectable probes (never a fabricated HEALTHY);
 *   - execution: body provider configuration (isolated from packages/*)
 *     and the long-running work delegation boundary (Vercel request
 *     lifetime never owns long-running autonomous work).
 *
 * Determinism: no Date.now, no Math.random, no fetch, no process.env in
 * library source — clocks, entropy, sources and probes are injected.
 * Structural isolation: no imports from or into packages/* (providers
 * remain adapters); pinned by tests.
 */

export * from './core/types.ts';
export * from './environment/schema.ts';
export * from './environment/load.ts';
export * from './environment/isolation.ts';
export * from './providers/vercel.ts';
export * from './providers/neon.ts';
export * from './providers/upstash.ts';
export * from './providers/r2.ts';
export * from './providers/github.ts';
export * from './secrets/policy.ts';
export * from './revisions/registrar.ts';
export * from './health/diagnostics.ts';
export * from './execution/body-providers.ts';
export * from './execution/delegation.ts';
