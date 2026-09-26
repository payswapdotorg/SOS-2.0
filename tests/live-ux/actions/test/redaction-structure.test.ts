/**
 * P18-B deterministic reference-mode suite (7/7): REDACTION + STRUCTURAL
 * DISCIPLINE over the owned paths. Pins:
 *
 *   - NO secret values in any committed owned file (the merged redaction
 *     corpus with zero findings; env NAMES only);
 *   - the receipts/evidence the pipeline produces never carry credential
 *     values (a configured-looking secret in an env-shaped field never
 *     reaches a receipt);
 *   - ambient discipline: process.env ONLY in the route handler (the
 *     documented process boundary); no ambient time in the endpoint core
 *     or the mission surfaces; no ambient network in the app sources
 *     (the real providers run ONLY inside the bridge worker's documented
 *     boundary);
 *   - the app files stay server-rendered (no 'use client');
 *   - the sync provider bridge fails with TYPED honest failures when
 *     unconfigured (never a fabricated provider outcome) — pinned
 *     offline, worker included, zero network;
 *   - pnpm-workspace.yaml gained only the lane's tests/live-ux/actions
 *     importer entry (never 'live-mission' — the P17-C pin).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { InMemoryAuthority } from '@sos-2/action-gateway';
import { redactObservationSecrets } from '@sos-2/real-observation';
import { createLiveActionHost, submitLiveAction } from '@live-action/core';
import { deployedHostConfigFromEnv } from '@live-action/deployed-host';
import { createSyncProviderBridge } from '@live-action/bridge';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '.next') {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const tsFiles = (dir: string): string[] => walk(dir).filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'));
const relative = (file: string): string => path.relative(REPO_ROOT, file);

const OWNED_APP_PATHS = [
  path.join(REPO_ROOT, 'apps/web/app/live-mission'),
  path.join(REPO_ROOT, 'apps/web/app/mission'),
  path.join(REPO_ROOT, 'apps/web/app/api/live-mission'),
];
const ROUTE_HANDLER = path.join(REPO_ROOT, 'apps/web/app/api/live-mission/actions/route.ts');
const BRIDGE = path.join(REPO_ROOT, 'apps/web/app/api/live-mission/actions/real-executor-bridge.ts');

/** Strip comments so scans see CODE, not prose. */
function stripComments(text: string): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/^\s*\/\/.*$/gm, '');
  return out;
}

describe('secret discipline: no credential VALUES in any committed owned file', () => {
  // these suites intentionally carry SYNTHETIC secret-shaped fixtures
  // (all-zero/synthetic values assigned to env-NAMED keys, never real —
  // the P17-C synthetic-fixture discipline); they are excluded from the
  // no-secrets-committed scan:
  const syntheticFixtureSuites = ['redaction-structure.test.ts', 'authority-fail-closed.test.ts'];
  const owned = [
    ...OWNED_APP_PATHS.flatMap((dir) => tsFiles(dir)),
    ...tsFiles(path.join(REPO_ROOT, 'apps/web/live-mission')),
    ...tsFiles(path.join(REPO_ROOT, 'tests/live-ux/actions')).filter((file) => !syntheticFixtureSuites.includes(path.basename(file))),
  ];
  const evidenceDir = path.join(REPO_ROOT, 'docs/evidence/production-connectivity/live-ux/actions-mission');
  if (existsSync(evidenceDir)) {
    owned.push(...walk(evidenceDir).filter((file) => file.endsWith('.json') || file.endsWith('.md')));
  }

  it('scans every owned file with the merged redaction corpus (zero findings)', () => {
    expect(owned.length).toBeGreaterThan(20);
    for (const file of owned) {
      const text = readFileSync(file, 'utf8');
      const { findings } = redactObservationSecrets(text);
      expect(findings, `${relative(file)} contains secret-shaped values (${findings.map((f) => f.patternId).join(', ')})`).toEqual([]);
    }
  });

  it('references credentials only by environment-variable NAMES', () => {
    for (const file of owned) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('BODY_PROVIDER_API_KEY') || text.includes('VERCEL_TOKEN') || text.includes('GITHUB_ACCESS_TOKEN')) {
        expect(text).not.toMatch(/(ghp_|sk-or-v1-|vcp_)[A-Za-z0-9_-]{8,}/);
      }
    }
  });
});

describe('the pipeline never echoes credential values into receipts', () => {
  it('a receipt produced with provider-looking env values carries only the env NAMES', () => {
    const config = deployedHostConfigFromEnv({
      BODY_PROVIDER_API_KEY: 'sk-or-v1-0000000000000000000000000000000000000000000000000000',
      VERCEL_TOKEN: 'vcp_0000000000000000000000000000000000000000',
      GITHUB_ACCESS_TOKEN: 'ghp_0000000000000000000000000000000000000000',
    });
    // the config VALUES stay in the process (never serialized into any
    // receipt view): the serialized deployed-host surface contains only names
    const surface = JSON.stringify({ grants: config.grants, providers: config.openRouter === null ? null : { model: config.openRouter.model } });
    expect(surface).not.toContain('sk-or-v1-0000');
    expect(surface).not.toContain('vcp_0000');
    expect(surface).not.toContain('ghp_0000');
  });

  it('the receipt views serialize clean (no secret-shaped material)', () => {
    const host = createLiveActionHost({ clock: { now: () => 1_797_123_600_000 } });
    (host.reference!.authority as InMemoryAuthority).grant('console-user', 'body-lifecycle', 'cloud-sandbox-1');
    const result = submitLiveAction({
      body: JSON.stringify({
        family: 'body-lifecycle',
        actor: { kind: 'human', id: 'console-user' },
        targetRevision: { kind: 'source', sha: 'seed-workspace-base' },
        payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-1', operation: 'start' } },
      }),
      contentType: 'application/json',
      host,
      now: 1_797_123_600_000,
    });
    const serialized = JSON.stringify(result.view);
    const { findings } = redactObservationSecrets(serialized);
    expect(findings).toEqual([]);
  });
});

describe('ambient discipline over the owned app paths', () => {
  it('reads process.env ONLY in the route handler (the documented process boundary)', () => {
    for (const dir of OWNED_APP_PATHS) {
      for (const file of tsFiles(dir)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        if (file === ROUTE_HANDLER) {
          expect(code.includes('process.env')).toBe(true);
          continue;
        }
        expect(/process\.env\s*[.[]/.test(code), `${relative(file)} reads process.env outside the route boundary`).toBe(false);
      }
    }
  });

  it('uses ambient time ONLY in the route handler (injected clocks everywhere else)', () => {
    for (const dir of OWNED_APP_PATHS) {
      for (const file of tsFiles(dir)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        if (file === ROUTE_HANDLER) {
          continue; // Date.now at the request boundary (the injected `now`)
        }
        expect(code.includes('Date.now'), `${relative(file)} reads Date.now`).toBe(false);
      }
    }
  });

  it('performs network ONLY inside the bridge worker boundary (no fetch in any app source)', () => {
    for (const dir of OWNED_APP_PATHS) {
      for (const file of tsFiles(dir)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        if (file === BRIDGE) {
          continue; // the documented provider boundary: the worker source string
        }
        expect(/(?<![.\w])fetch\s*\(/.test(code), `${relative(file)} performs a raw fetch call`).toBe(false);
      }
    }
    // and the bridge's MAIN thread carries no fetch call (only the worker source string does)
    const bridgeCode = stripComments(readFileSync(BRIDGE, 'utf8'));
    const workerSourceStart = bridgeCode.indexOf('const WORKER_SOURCE');
    const mainThreadCode = bridgeCode.slice(0, workerSourceStart);
    expect(/(?<![.\w])fetch\s*\(/.test(mainThreadCode)).toBe(false);
  });

  it('keeps every mission surface server-rendered (no client components)', () => {
    const surfaces = [
      ...tsFiles(path.join(REPO_ROOT, 'apps/web/app/live-mission')),
      ...tsFiles(path.join(REPO_ROOT, 'apps/web/app/mission')),
      ...tsFiles(path.join(REPO_ROOT, 'apps/web/live-mission/src')),
    ];
    for (const file of surfaces) {
      const code = readFileSync(file, 'utf8');
      expect(code.includes("'use client'"), `${relative(file)} is a client component`).toBe(false);
    }
  });
});

describe('the sync provider bridge fails honestly (offline, worker included)', () => {
  it('an unconfigured bridge answers typed PROVIDER_NOT_CONNECTED failures — never a fabricated provider outcome', () => {
    const bridge = createSyncProviderBridge({ openRouter: null, vercel: null, github: null });
    try {
      expect(bridge.live).toBe(true);
      const result = bridge.executor.execute(
        { op: 'body.start', bodyId: 'cloud-sandbox-1' },
        { actionId: 'a', idempotencyKey: 'k', actor: { kind: 'human', id: 'u' }, targetRevision: { kind: 'source', sha: 's' }, at: 0 },
      );
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.errorType).toBe('PROVIDER_NOT_CONNECTED');
        expect(result.message).toContain('no OpenRouter body provider configured');
        expect(result.message).toContain('honestly did not run');
      }
      const verification = bridge.verifier.verify('dpl_unknown', 'sha', 0);
      expect(verification.verdict).toBe('UNKNOWN');
      expect(verification.limitation).toContain('no Vercel provider configured');
    } finally {
      bridge.close();
    }
  });

  it('a provider operation with no provider bound answers the typed honest failure', () => {
    const bridge = createSyncProviderBridge({ openRouter: null, vercel: null, github: null });
    try {
      const result = bridge.executor.execute(
        { op: 'body.pause', bodyId: 'cloud-sandbox-1' },
        { actionId: 'a', idempotencyKey: 'k', actor: { kind: 'human', id: 'u' }, targetRevision: { kind: 'source', sha: 's' }, at: 0 },
      );
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.errorType).toBe('PROVIDER_OPERATION_UNSUPPORTED');
      }
    } finally {
      bridge.close();
    }
  });
});

describe('workspace discipline', () => {
  it('pnpm-workspace.yaml gained ONLY the lane importer entry (never live-mission — the P17-C pin)', () => {
    const workspace = readFileSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('- tests/live-ux/actions');
    expect(workspace.includes('live-mission')).toBe(false);
    expect(workspace.includes('real-observation')).toBe(false);
  });

  it('apps/web declares the action packages (the mechanical importer addition the endpoint requires)', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'apps/web/package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@sos-2/action-gateway']).toBe('workspace:*');
    expect(pkg.dependencies['@sos-2/ask']).toBe('workspace:*');
  });
});
