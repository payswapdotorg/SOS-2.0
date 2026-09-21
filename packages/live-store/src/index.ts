/**
 * @sos-2/live-store — durable, provider-neutral repositories for the live
 * SOS 2.0 product state (Work Order P2).
 *
 * - Repository PORTS for every supported record family (see
 *   ./ports/repositories.ts) plus a complete IN-MEMORY REFERENCE
 *   implementation (./memory/).
 * - Provider PORTS for the free-tier reference stack (Neon durable /
 *   Upstash coordination-only — NEVER canonical / Cloudflare R2 immutable
 *   artifacts), each documenting its provider role.
 * - The §6 task-durability shape, body lease state, development state and
 *   replay-protected observation events.
 * - Injected clocks everywhere (no hidden time, no randomness, no env, no
 *   network in package src).
 *
 * DOMAIN RECORD SHAPES ARE NEVER REDEFINED: the store persists the owning
 * packages' records verbatim, validated by their own asserts (consumed).
 * The Semantic Spine remains the only identity/serialization authority.
 */

// Clock + typed errors + outcomes.
export * from './clock.js';
export * from './errors.js';
export * from './results.js';

// Execution-fabric record shapes (P2's own boundary per the work order).
export * from './records/observation-event.js';
export * from './records/task.js';
export * from './records/body-lease.js';
export * from './records/development-state.js';

// Ports (provider-neutral contracts).
export * from './ports/provider-adapters.js';
export * from './ports/repositories.js';
export * from './ports/live-store.js';

// In-memory reference implementation.
export * from './memory/in-memory-postgres.js';
export * from './memory/in-memory-redis.js';
export * from './memory/in-memory-object-store.js';
export * from './memory/record-engine.js';
export * from './memory/repositories.js';
export * from './memory/live-store.js';
