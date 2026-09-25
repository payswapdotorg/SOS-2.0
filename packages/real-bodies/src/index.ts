/**
 * @sos-2/real-bodies — the REAL cloud execution bodies (Work Order
 * P17-B).
 *
 * At least one real cloud/remote execution body behind the EXISTING P5
 * §9 HarnessContract (the body abstraction remains UNCHANGED — no
 * vendor becomes part of SOS semantics):
 *
 *   - model-port.ts         the injectable HostedModelPort (async) + the
 *                           deterministic ScriptedHostedModelPort + the
 *                           bounded work-program parsing protocol
 *   - openrouter-client.ts  the REAL OpenRouter chat-completions client
 *                           (the documented network boundary of this
 *                           package; credential injected at the
 *                           composition boundary — env-only, names in
 *                           evidence, never values)
 *   - hosted-coding-body.ts the HostedCodingBody — a hosted
 *                           coding-harness body executing a durable
 *                           task's work program by driving the REAL
 *                           model API inside its bounded sandbox (the
 *                           sync §9 control/read surface + the
 *                           documented async engine, per the frozen P8
 *                           sync-seam composition discipline). Placement
 *                           'cloud': the user's computer is NEVER
 *                           required. A body cannot self-certify — the
 *                           independent evaluator gates completion.
 *   - github-bridge.ts      the async -> sync REAL provider session
 *                           bridge over the P8 repository-operations
 *                           seam (the exact composition boundary P8
 *                           documented for the later-wave attachment).
 *
 * Determinism: no hidden clocks, no ambient environment access, no
 * randomness in src; the deterministic suites drive the scripted model
 * port offline (fixed seed). Network happens only in the env-gated
 * integration suite (RUN_REAL=1, tests/real-bodies).
 *
 * ZERO external dependencies (workspace:* + the toolchain only).
 */

export * from './model-port.js';
export * from './openrouter-client.js';
export * from './hosted-coding-body.js';
export * from './github-bridge.js';
