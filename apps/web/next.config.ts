import type { NextConfig } from 'next';

/**
 * The production web console build configuration (Work Order P1).
 *
 * Determinism rules (binding): no network at build or test time — no
 * next/font (system font stack only), no remote images (none used at all),
 * no runtime fetch in any render path (all data comes from the static,
 * revision-pinned DEMO fixtures projected through @sos-2/web-contracts).
 * NEXT_TELEMETRY_DISABLED=1 is pinned in the package scripts. No ESLint
 * configuration ships with the app (lint is not a P1 gate; TypeScript
 * checking runs as part of `next build`).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
