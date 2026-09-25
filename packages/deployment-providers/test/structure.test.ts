/**
 * The package-local structural suite of @sos-2/deployment-providers
 * (Work Order P17-A): pins the lane's structural disciplines
 * deterministically, offline (the functional contract suites live in
 * tests/real-persistence).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');
const srcRoot = resolve(packageRoot, 'src');

function srcFiles(): string[] {
  return readdirSync(srcRoot).filter((file) => file.endsWith('.ts'));
}

describe('@sos-2/deployment-providers structural discipline', () => {
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

  it('touches the network only through the injectable FetchPort seam (http.ts is the documented boundary)', () => {
    for (const file of srcFiles()) {
      const text = readFileSync(resolve(srcRoot, file), 'utf8');
      if (file === 'http.ts') {
        expect(text.includes('await fetch(')).toBe(true);
        continue;
      }
      expect(
        text.includes('await fetch('),
        `${file} calls the global fetch outside the documented network boundary (http.ts)`,
      ).toBe(false);
      expect(
        text.includes('fetch(url'),
        `${file} calls the global fetch outside the documented network boundary (http.ts)`,
      ).toBe(false);
    }
  });

  it('imports only merged workspace packages + own modules (no vendor SDKs, no infra source)', () => {
    const allowed = new Set([
      '@sos-2/deployment',
      '@sos-2/provenance',
      '@sos-2/recovery-control',
      '@sos-2/semantic-spine',
      '@sos-2/system-state',
      '@sos-2/live-store',
    ]);
    for (const file of srcFiles()) {
      const text = readFileSync(resolve(srcRoot, file), 'utf8');
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
      for (const specifier of imports) {
        if (specifier.startsWith('.')) {
          expect(specifier.endsWith('.js'), `${file} uses a non-js-extension relative import: ${specifier}`).toBe(true);
          continue;
        }
        if (specifier.startsWith('@sos-2/')) {
          expect(allowed.has(specifier), `${file} imports a package outside the lane's merged dependency set: ${specifier}`).toBe(true);
          continue;
        }
        if (specifier.startsWith('node:')) {
          continue;
        }
        expect(false, `${file} imports an external module (vendor SDKs are forbidden): ${specifier}`).toBe(false);
      }
    }
  });

  it('exports the P17-A provider-state vocabulary and the real Vercel provider surface', async () => {
    const index = await import('../src/index.js');
    expect(index.REAL_DEPLOYMENT_PROVIDER_STATES).toEqual(['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED']);
    expect(index.REAL_VERCEL_PROVIDER_ID).toBe('vercel-real');
    expect(typeof index.RealVercelDeploymentProvider).toBe('function');
    expect(typeof index.createRealVercelDeploymentProvider).toBe('function');
    expect(typeof index.assertValidRealDeploymentProviderStateReport).toBe('function');
    expect(index.REAL_DEPLOYMENT_ENVIRONMENT_VARIABLES.vercelToken).toBe('VERCEL_TOKEN');
    expect(index.VERCEL_APP_ROOT_DEFAULT).toBe('apps/web');
    expect(index.VERCEL_REGIONS).toEqual(['iad1', 'sfo1', 'fra1', 'cdg1', 'hnd1', 'syd1']);
  });
});
