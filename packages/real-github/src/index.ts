/**
 * @sos-2/real-github — the REAL GitHub adapter (Work Order P17-B).
 *
 * The vendor-backed realization of the frozen @sos-2/github GitHubPort
 * contract over the REAL GitHub REST API:
 *
 *   - fetch-transport.ts     the real HTTP seam (a fetch-backed
 *                            GitHubRequestPort; credential injected at
 *                            the composition boundary, never ambient;
 *                            rate-limit/API-revision headers captured as
 *                            REAL probe data)
 *   - real-provider.ts       RealGitHubProvider — GitHubPort over the
 *                            real REST API: discovery, branches,
 *                            snapshot/empty detection, webhook, branch,
 *                            commit (Git Data API single-commit path +
 *                            the contents-API initial commit on an empty
 *                            repository), PR operations. The PAT-backed
 *                            real handshake (verifyToken probes /user)
 *                            is the only path to CONNECTED; the OAuth
 *                            app authorization surface is implemented
 *                            (beginConnection) while live operation is
 *                            PAT-backed — recorded honestly.
 *   - provider-state.ts      the P17-B honest provider states
 *                            (CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED)
 *                            from REAL probes only; GH rate limits
 *                            surface as DEGRADED with REAL reset data.
 *   - environment.ts         env-only credential resolution (names only
 *                            in every output; PREPARED is never
 *                            CONNECTED).
 *
 * Determinism discipline: the provider logic has no hidden clocks and no
 * ambient env access; the deterministic suites inject a scripted request
 * port (offline, fixed seed) — network happens only in the env-gated
 * integration suite (RUN_REAL=1, tests/real-github).
 *
 * ZERO external dependencies (workspace:* + the toolchain only); fetch is
 * the Node built-in. The frozen contract is consumed read-only.
 */

export * from './provider-state.js';
export * from './fetch-transport.js';
export * from './api-records.js';
export * from './environment.js';
export * from './github-vocabulary.js';
export * from './real-provider.js';
