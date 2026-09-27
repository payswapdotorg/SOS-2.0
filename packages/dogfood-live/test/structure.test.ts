/**
 * The package-local structure suite of the dogfood-live harness: pins
 * the determinism/honesty discipline (offline structure checks only —
 * the full deterministic journey suite lives in tests/real-dogfood).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const OWNED_SRC = join(import.meta.dirname, '..', 'src');

function ownedSources(): { readonly file: string; readonly text: string }[] {
  return readdirSync(OWNED_SRC)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, text: readFileSync(join(OWNED_SRC, file), 'utf8') }));
}

describe('packages/dogfood-live structure (Work Order P19)', () => {
  it('no ambient environment reads in src (credentials arrive from the injected source record only)', () => {
    for (const source of ownedSources()) {
      expect(source.text.includes('process.env'), `${source.file}: process.env`).toBe(false);
    }
  });

  it('no ambient clocks or randomness in src (the clock is injected)', () => {
    for (const source of ownedSources()) {
      expect(source.text.includes('Date.now('), `${source.file}: Date.now(`).toBe(false);
      expect(source.text.includes('Math.random('), `${source.file}: Math.random(`).toBe(false);
    }
  });

  it('the env registry carries the exact §2 names (names only, never values)', () => {
    const environment = readFileSync(join(OWNED_SRC, 'environment.ts'), 'utf8');
    for (const name of ['PAYSWAP_GITHUB_TOKEN', 'GITHUB_ACCESS_TOKEN', 'OPENROUTER_API_KEY', 'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'SOS_DOGFOOD_BODY_MODEL']) {
      expect(environment.includes(`'${name}'`), `the env registry must name ${name}`).toBe(true);
    }
  });

  it('the staged-outcome seams never fabricate (the not-prepared discipline is present)', () => {
    const staging = readFileSync(join(OWNED_SRC, 'staging.ts'), 'utf8');
    expect(staging.includes('REAL_OPERATION_NOT_PREPARED')).toBe(true);
    expect(staging.includes('never a fabricated success')).toBe(true);
    // The executors answer EXACTLY the staged outcomes: every dispatch path
    // either answers a staged entry or the typed notPreparedFailure.
    const executors = readFileSync(join(OWNED_SRC, 'gateway-executors.ts'), 'utf8');
    expect(executors.includes('notPreparedFailure')).toBe(true);
    const notPreparedUses = executors.match(/notPreparedFailure\(/g) ?? [];
    expect(notPreparedUses.length).toBeGreaterThanOrEqual(4); // git.commit, git.push, git.openPullRequest, deployment.apply
  });

  it('the default body model is the §1 pin (qwen/qwen3-coder-flash)', () => {
    const environment = readFileSync(join(OWNED_SRC, 'environment.ts'), 'utf8');
    expect(environment.includes('qwen/qwen3-coder-flash')).toBe(true);
  });

  it('the §7 device pin is structural (the presence recorder answers offline, never consulted)', () => {
    const harness = readFileSync(join(OWNED_SRC, 'harness.ts'), 'utf8');
    expect(harness.includes('userDeviceOnline: () => false')).toBe(true);
  });
});
