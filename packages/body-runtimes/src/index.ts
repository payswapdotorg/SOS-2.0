/**
 * @sos-2/body-runtimes — the reference body runtimes (Work Order P8).
 *
 * THREE reference bodies behind the merged P5 Harness Contract, each
 * advertising honest capabilities:
 *
 *   1. CloudCodingShellBody       the disposable cloud coding/shell body
 *                                  (the primary autonomous execution path)
 *   2. BrowserEvaluatorBody       the browser/evaluator body (typed-record
 *                                  browser journeys through an injectable
 *                                  port; the real bridge is later-wave)
 *   3. GitHubProjectBody          the GitHub-aware project body (typed
 *                                  repository records through the P4
 *                                  provider-neutral vocabulary; honest
 *                                  NOT_YET_CONNECTED without credentials)
 *
 * All three are LOCAL REFERENCE RUNTIMES: deterministic, offline-testable,
 * satisfying the SAME Harness Contract real provider bodies will — real
 * provider endpoints attach later through @sos-2/harness-adapters without
 * contract change.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — bounded environments, ports, policies and secrets are
 * injected; the bodies are clock-less (the fabric stamps instants).
 */

export * from './errors.js';
export * from './shell-simulator.js';
export * from './browser-port.js';
export * from './git-records.js';
export * from './github-vocabulary.js';
export * from './github-operations.js';
export * from './cloud-body.js';
export * from './browser-body.js';
export * from './github-body.js';
