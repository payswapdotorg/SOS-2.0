/**
 * The package-local structural suite of @sos-2/real-github (Work Order
 * P17-B): pins the lane's structural disciplines deterministically,
 * offline (the functional contract suites live in tests/real-github).
 *
 *   - ZERO external dependencies: workspace:* + the existing toolchain
 *     only (the P15 lockfile rule, continued for P17-B).
 *   - No ambient environment access and no hidden clocks anywhere in
 *     src (the injectable-source / caller-instant disciplines).
 *   - fetch appears ONLY in the documented network boundary
 *     (fetch-transport.ts) — the one place network happens.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');
const srcRoot = resolve(packageRoot, 'src');

function srcFiles(): string[] {
  return readdirSync(srcRoot).filter((file) => file.endsWith('.ts'));
}

describe('@sos-2/real-github structural discipline', () => {
  it('declares ZERO external runtime dependencies (workspace:* only)', () => {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      expect(spec).toBe('workspace:*');
      expect(name.startsWith('@sos-2/')).toBe(true);
    }
    const allowedToolchain = ['@types/node', 'typescript', 'vitest'];
    for (const name of Object.keys(manifest.devDependencies ?? {})) {
      expect(allowedToolchain.includes(name)).toBe(true);
    }
  });

  it('never reads ambient process.env and never hides a clock in src', () => {
    for (const file of srcFiles()) {
      const text = readFileSync(resolve(srcRoot, file), 'utf8');
      expect(text.includes('process.env'), `${file} reads ambient process.env`).toBe(false);
      expect(text.includes('Date.now'), `${file} uses Date.now`).toBe(false);
      expect(text.includes('Math.random'), `${file} uses Math.random`).toBe(false);
    }
  });

  it('touches the network only in the documented boundary (fetch-transport.ts)', () => {
    for (const file of srcFiles()) {
      const text = readFileSync(resolve(srcRoot, file), 'utf8');
      if (file === 'fetch-transport.ts') {
        expect(text.includes('fetchImpl')).toBe(true);
        continue;
      }
      expect(text.includes('fetch('), `${file} calls fetch outside the documented network boundary`).toBe(false);
      expect(text.includes('fetchImpl'), `${file} touches the fetch seam outside the documented boundary`).toBe(false);
    }
  });

  it('exports the P17-B provider-state vocabulary and the real provider surface', async () => {
    const index = await import('../src/index.js');
    expect(index.REAL_GITHUB_PROVIDER_STATES).toEqual(['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED']);
    expect(index.REAL_GITHUB_PROVIDER_ID).toBe('github-real');
    expect(typeof index.createRealGitHubProvider).toBe('function');
    expect(typeof index.createFetchGitHubRequestPort).toBe('function');
    expect(typeof index.assertValidRealGitHubProviderStateReport).toBe('function');
    expect(index.GITHUB_OAUTH_AUTHORIZE_URL).toBe('https://github.com/login/oauth/authorize');
    expect(index.REAL_GITHUB_ENVIRONMENT_VARIABLES.operationalToken).toBe('PAYSWAP_GITHUB_TOKEN');
  });
});
