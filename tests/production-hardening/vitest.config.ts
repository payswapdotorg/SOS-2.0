// Plain-object config (assembly alignment with the P9 suite): the
// structural import-boundary scan covers every .ts file in the owned
// dirs and allows only relative, node:, bare 'vitest', and
// owned/merged-workspace specifiers — a 'vitest/config' subpath import
// would trip it. Vitest accepts a plain default export.
//
// COMPOSITION WIRING (Work Order P14): this suite composes the P14
// packages with MERGED code. Because the three P14 package paths
// declare ZERO dependencies (the lockfile byte-identity rule — the only
// construction that passes `pnpm install --frozen-lockfile` with an
// unchanged pnpm-lock.yaml at this base, empirically pinned), the
// merged workspace modules are wired here through TEST-TIME ALIASES to
// their SOURCE entry points (vitest compiles them directly; the P9
// action-gateway sources are dependency-free by design). The merged
// infra/deployment and live-store contracts are imported through
// relative source paths / read as source text (alignment pins).
//
// Fixed seed matches the repo convention (deterministic tests).
const here = new URL('.', import.meta.url);

export default {
  test: {
    root: here.pathname,
    include: ['*.test.ts'],
    sequence: { seed: 424242 },
  },
  resolve: {
    alias: {
      '@sos-2/security': new URL('../../packages/security/src/index.ts', import.meta.url).pathname,
      '@sos-2/cost-policy': new URL('../../packages/cost-policy/src/index.ts', import.meta.url).pathname,
      '@sos-2/action-gateway': new URL('../../packages/action-gateway/src/index.ts', import.meta.url).pathname,
    },
  },
};
