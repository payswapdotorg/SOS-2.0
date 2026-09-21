/**
 * @sos-2/github — the provider-neutral GitHub/project adapter (Work
 * Order P4): the typed GitHubPort contract (connection with
 * least-privilege repository scope, repository discovery, branch and
 * revision selection, empty-repository detection, snapshot/metadata
 * import, webhook registration where supported, PR/commit operations),
 * the typed capability surface (unsupported = explicit UNSUPPORTED,
 * never a silent failure), an injectable HTTP/request transport seam,
 * an in-memory deterministic reference implementation, a transport-backed
 * provider over the injected request port, and configuration through
 * @sos-2/infra-deployment's environment contract (the GitHub-scope
 * variables from its registry; pinned by test; secrets never echoed).
 *
 * ZERO dependencies (lockfile byte-identity rule, P3 precedent). Honest
 * status: the real-system connection is NOT_YET_CONNECTED (validation
 * GitHub account pending); connection evidence is NEVER fabricated.
 */

export * from './errors.ts';
export * from './capabilities.ts';
export * from './connection.ts';
export * from './environment.ts';
export * from './port.ts';
export * from './reference.ts';
export * from './transport.ts';
