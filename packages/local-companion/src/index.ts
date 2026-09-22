/**
 * @sos-2/local-companion — the authenticated local companion contract
 * (Work Order P11): the LOCAL BODY PATH over the merged P5 Harness
 * Contract.
 *
 * - Pairing/session records over INJECTED seams (pairing authority +
 *   credential store): the companion cannot mint sessions or authority;
 *   session token VALUES never echo — only NAMES (the P8 sandbox secrets
 *   discipline).
 * - Private workspace/file access is scope-granted: a granted-scope check
 *   before EVERY access; out-of-scope access is a typed
 *   COMPANION_SCOPE_DENIED denial — never silent, never a crash.
 * - Local shell/process integration through an injectable LocalProcess
 *   seam (deterministic simulated reference; zero real process spawning
 *   in library code); un-granted consequential operations are typed
 *   COMPANION_PROCESS_DENIED denials.
 * - Offline queueing: local-only work orders queue while the device
 *   reports offline and run when it reconnects; cloud tasks never
 *   require the companion.
 * - Reconnect + state reconciliation: the durable local event log
 *   reconciles against the P2 live-store observation events through
 *   idempotent, replay-protected ingestion — exactly-once, gap-free.
 * - Local observations are provenance-labelled (local source + device
 *   identity — the @sos-2/telemetry provenance discipline).
 * - LocalCompanionBody implements the merged P5 Harness Contract
 *   (placement user-device) — honest advertisement, typed UNSUPPORTED,
 *   no authority fields anywhere on the surface.
 * - NO real desktop app ships here: provider-neutral contracts + LOCAL
 *   REFERENCE RUNTIMES; honest NOT_YET_INSTALLED (evidence never
 *   fabricated).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — clocks, authorities, stores, ports and seams are
 * injected; ids are deterministic sequences.
 */

// Typed errors + typed denials.
export * from './errors.js';
export * from './denials.js';

// Honest installation statuses.
export * from './status.js';

// The granted-scope model.
export * from './scope.js';

// The pairing/session contract (injectable pairing authority + credential store).
export * from './session.js';

// Provenance-labelled observations + the durable local event log.
export * from './observations.js';

// The private workspace/file access surface (injectable LocalFilePort).
export * from './files.js';

// The local shell/process integration (injectable LocalProcess seam).
export * from './process.js';

// Offline queueing (local-only work orders).
export * from './queue.js';

// Reconnect + state reconciliation (exactly-once, gap-free).
export * from './reconcile.js';

// The companion core.
export * from './companion.js';

// The §9 Harness Contract body (the local body path).
export * from './harness-body.js';
