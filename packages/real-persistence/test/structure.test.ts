/**
 * The package-local structural suite of @sos-2/real-persistence (Work
 * Order P17-A): pins the lane's structural disciplines deterministically,
 * offline (the functional contract suites live in tests/real-persistence).
 *
 *   - ZERO external dependencies: workspace:* + the existing toolchain
 *     only (the P15/P17-B lockfile rule, continued for P17-A).
 *   - No ambient environment access and no hidden clocks anywhere in
 *     src (the injectable-source / caller-instant disciplines).
 *   - Network happens ONLY through the injectable FetchPort seam; the
 *     global fetch appears only in the documented impure boundary
 *     (http.ts bindGlobalFetch + composition.ts's default).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');
const srcRoot = resolve(packageRoot, 'src');

function srcFiles(): string[] {
  return readdirSync(srcRoot).filter((file) => file.endsWith('.ts'));
}

describe('@sos-2/real-persistence structural discipline', () => {
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

  it('touches the network only through the injectable FetchPort seam (documented boundary files)', () => {
    for (const file of srcFiles()) {
      const text = readFileSync(resolve(srcRoot, file), 'utf8');
      if (file === 'http.ts') {
        // The documented impure boundary: bindGlobalFetch attaches the
        // platform fetch — the ONLY global-fetch call in src.
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
    for (const file of srcFiles()) {
      const text = readFileSync(resolve(srcRoot, file), 'utf8');
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
      for (const specifier of imports) {
        if (specifier.startsWith('.')) {
          expect(specifier.endsWith('.js'), `${file} uses a non-js-extension relative import: ${specifier}`).toBe(true);
          continue;
        }
        if (specifier.startsWith('@sos-2/')) {
          expect(
            specifier === '@sos-2/live-store' || specifier === '@sos-2/semantic-spine',
            `${file} imports a package outside the lane's merged dependency set: ${specifier}`,
          ).toBe(true);
          continue;
        }
        if (specifier.startsWith('node:')) {
          expect(specifier.startsWith('node:crypto'), `${file} imports a node builtin beyond node:crypto: ${specifier}`).toBe(true);
          continue;
        }
        expect(false, `${file} imports an external module (vendor SDKs are forbidden): ${specifier}`).toBe(false);
      }
    }
  });

  it('exports the P17-A provider-state vocabulary and the real adapter surfaces', async () => {
    const index = await import('../src/index.js');
    expect(index.REAL_PERSISTENCE_PROVIDER_STATES).toEqual(['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED']);
    expect(typeof index.NeonPostgresStoreAdapter).toBe('function');
    expect(typeof index.UpstashRedisCoordinationAdapter).toBe('function');
    expect(typeof index.R2ObjectStoreAdapter).toBe('function');
    expect(typeof index.createRealPersistenceStack).toBe('function');
    expect(typeof index.assertValidRealPersistenceProviderStateReport).toBe('function');
    expect(typeof index.mapProviderStateToPortAvailability).toBe('function');
    expect(index.REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.databaseUrl).toBe('DATABASE_URL');
    expect(index.REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.upstashRestUrl).toBe('UPSTASH_REDIS_REST_URL');
    expect(index.REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.r2BucketName).toBe('R2_BUCKET_NAME');
    expect(index.UPSTASH_TTL_POLICY_MS.cache).toBe(5 * 60_000);
    expect(index.NEON_REGIONS).toEqual(['aws-us-east-1', 'aws-us-west-2', 'aws-eu-central-1', 'aws-ap-southeast-1']);
  });
});
