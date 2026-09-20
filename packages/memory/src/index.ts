/**
 * @sos-2/memory — SOS 2.0 Architecture Memory (Work Order W5).
 *
 * Versioned ArchitectureMemory artifacts (frozen core kind) holding the
 * seven memory entry kinds of spec/architecture.md §5 — predictions,
 * observations, outcomes, FAILURES (contexts retained, never dropped),
 * TECHNICAL LIABILITIES (first-class records with severity, owner-kind and
 * a validated resolution state machine; deletions rejected, only resolution
 * may change), rollback events and learned rules (applicability context +
 * supporting evidence refs; rules without evidence are rejected). Every
 * memory update is a versioned supersedes chain entry that preserves
 * provenance (who/what produced it, from which evidence); the append-only
 * evolution rule is machine-enforced; history is complete, contiguous and
 * queryable.
 *
 * All identities, envelopes, truth states and canonical serialization come
 * from @sos-2/semantic-spine; the confidence/calibration discipline comes
 * from @sos-2/evidence; producers come from @sos-2/provenance. Nothing here
 * duplicates an authority; invalid memory always fails loudly.
 */

export * from './errors.js';
export * from './liability.js';
export * from './entries.js';
export * from './artifact.js';
export * from './store.js';
