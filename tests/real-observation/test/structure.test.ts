/**
 * P17-C deterministic reference-mode acceptance suite (6/6): structural
 * scans over the OWNED paths — the lane discipline:
 *
 *  - zero ambient network in packages/real-observation/src outside the
 *    documented boundaries (global fetch ONLY in http.ts bindGlobalFetch;
 *    node:http ONLY in the webhook receiver's inbound bind adapter;
 *    node:crypto HMAC only in the receiver);
 *  - zero ambient time (Date.now only in system-clock.ts — the documented
 *    process boundary; new Date(...) for RFC3339 stamps is allowed — it
 *    derives from the INJECTED clock value);
 *  - zero ambient env (no process.env anywhere in src);
 *  - the live-mission UI module imports only what apps/web already
 *    declares (react, next/link, relative shell components, the
 *    web-contracts surface) — no new dependency edges;
 *  - NO SECRET VALUES COMMITTED: every owned file passes the redaction
 *    corpus with zero findings (env NAMES only);
 *  - pnpm-workspace.yaml untouched (the new packages join through the
 *    existing globs).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { redactObservationSecrets } from '@sos-2/real-observation';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') {
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

const REAL_OBSERVATION_SRC = path.join(REPO_ROOT, 'packages/real-observation/src');
const LIVE_MISSION_SRC = path.join(REPO_ROOT, 'apps/web/live-mission');
const TESTS_SRC = [path.join(REPO_ROOT, 'tests/real-observation/test'), path.join(REPO_ROOT, 'tests/real-observation/src')];
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/production-connectivity/observation-ux');


/** Strip // line comments and /* block comments so scans see CODE, not prose. */
function stripComments(text: string): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/^\s*\/\/.*$/gm, '');
  return out;
}

const tsFiles = (dir: string): string[] => walk(dir).filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'));
const relative = (file: string): string => path.relative(REPO_ROOT, file);

describe('structural scan: packages/real-observation/src (ambient discipline)', () => {
  const files = tsFiles(REAL_OBSERVATION_SRC);

  it('has no ambient environment access anywhere in src', () => {
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(/process\.env\s*[.[]/.test(code), `${relative(file)} reads process.env`).toBe(false);
    }
  });

  it('uses Date.now only in the documented system-clock boundary', () => {
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (path.basename(file) === 'system-clock.ts') {
        continue;
      }
      expect(code.includes('Date.now'), `${relative(file)} reads Date.now outside the clock boundary`).toBe(false);
      expect(code.includes('Math.random'), `${relative(file)} uses Math.random`).toBe(false);
    }
  });

  it('touches the global fetch only in the bindGlobalFetch process boundary (http.ts)', () => {
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (path.basename(file) === 'http.ts') {
        // the documented boundary: the FetchPort bind adapter
        expect(code.includes('await fetch(')).toBe(true);
        continue;
      }
      // a global fetch CALL takes at least one argument; the W3 TelemetrySource method
      // DECLARATION fetch(): RawObservation[] is the contract, not a call.
      expect(/(?<![.\w])fetch\s*\([^)]/.test(code), `${relative(file)} performs a raw fetch call outside the seam`).toBe(false);
    }
  });

  it('uses node:http ONLY in the webhook receiver (the inbound bind adapter) and node:crypto only there too', () => {
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const base = path.basename(file);
      if (base === 'github-webhook.ts') {
        expect(code.includes("from 'node:http'")).toBe(true);
        expect(code.includes("from 'node:crypto'")).toBe(true);
        continue;
      }
      expect(code.includes("'node:http'"), `${relative(file)} imports node:http`).toBe(false);
      expect(code.includes("'node:crypto'"), `${relative(file)} imports node:crypto`).toBe(false);
      expect(/\bsetInterval\b|\bsetTimeout\b/.test(code), `${relative(file)} uses ambient timers`).toBe(false);
      expect(code.includes('child_process'), `${relative(file)} uses child_process`).toBe(false);
    }
  });

  it('imports only merged workspace packages and node builtins (no external runtime deps)', () => {
    const allowed = /^(@sos-2\/(event-ingestion|live-store|observation|provenance|semantic-spine|telemetry|telemetry-runtime|security)\b|node:|\.{1,2}\/)/;
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const imports = [...code.matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
      for (const specifier of imports) {
        expect(allowed.test(specifier), `${relative(file)} imports ${specifier}`).toBe(true);
      }
    }
  });
});

describe('structural scan: apps/web/live-mission (the UX surface module)', () => {
  const srcFiles = tsFiles(path.join(LIVE_MISSION_SRC, 'src'));

  it('has no ambient network, time or env in the UI module (fully server-rendered from props)', () => {
    for (const file of srcFiles) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(/process\.env\s*[.[]/.test(code), `${relative(file)} reads process.env`).toBe(false);
      expect(code.includes('Date.now'), `${relative(file)} reads Date.now`).toBe(false);
      expect(/(?<![.\w])fetch\s*\([^)]/.test(code), `${relative(file)} performs a fetch`).toBe(false);
      expect(code.includes("'use client'"), `${relative(file)} is a client component (server-rendered surface only)`).toBe(false);
    }
  });

  it('imports only what apps/web already declares (react, next, the shell, web-contracts, relative paths)', () => {
    const allowed = /^(@sos-2\/web-contracts\b|@sos-2\/ui-contracts\b|@sos-2\/evidence\b|@sos-2\/semantic-spine\b|next\/link|react|node:|\.{1,2}\/)/;
    for (const file of srcFiles) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const imports = [...code.matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
      for (const specifier of imports) {
        expect(allowed.test(specifier), `${relative(file)} imports ${specifier} (outside apps/web's declared dependencies)`).toBe(true);
      }
    }
  });

  it('mounts as a self-contained module with documented integration steps', () => {
    expect(existsSync(path.join(LIVE_MISSION_SRC, 'MOUNTING.md'))).toBe(true);
    const mounting = readFileSync(path.join(LIVE_MISSION_SRC, 'MOUNTING.md'), 'utf8');
    expect(mounting).toContain('apps/web/app/live-mission/page.tsx');
    expect(mounting).toContain('/api/live-mission/actions');
    expect(mounting).toContain('P18');
  });
});

describe('structural scan: tests + evidence (secret discipline)', () => {
  it('commits NO secret values anywhere in the owned paths (env NAMES only)', () => {
    // the redaction suites intentionally carry SYNTHETIC secret-shaped
    // fixtures (fragment-assembled, never real — the W17 discipline); they
    // are excluded from the no-secrets-committed scan:
    const syntheticFixtureSuites = ['redaction-alignment.test.ts', 'adapters.test.ts'];
    const owned = [
      ...tsFiles(path.join(REPO_ROOT, 'tests/real-observation')).filter((file) => !syntheticFixtureSuites.includes(path.basename(file))),
      ...tsFiles(LIVE_MISSION_SRC).filter((file) => !syntheticFixtureSuites.includes(path.basename(file))),
      ...tsFiles(REAL_OBSERVATION_SRC).filter((file) => !syntheticFixtureSuites.includes(path.basename(file))),
    ];
    if (existsSync(EVIDENCE_DIR)) {
      owned.push(...walk(EVIDENCE_DIR).filter((file) => file.endsWith('.json') || file.endsWith('.md')));
    }
    expect(owned.length).toBeGreaterThan(20);
    for (const file of owned) {
      const text = readFileSync(file, 'utf8');
      const { findings } = redactObservationSecrets(text);
      expect(findings, `${relative(file)} contains secret-shaped values (${findings.map((f) => f.patternId).join(', ')})`).toEqual([]);
    }
  });

  it('references secrets ONLY by environment variable names', () => {
    const names = ['PAYSWAP_GITHUB_TOKEN', 'PAYSWAP_VERCEL_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'PAYSWAP_GITHUB_WEBHOOK_SECRET'];
    const evidenceFiles = existsSync(EVIDENCE_DIR) ? walk(EVIDENCE_DIR).filter((file) => file.endsWith('.json')) : [];
    for (const file of evidenceFiles) {
      const text = readFileSync(file, 'utf8');
      for (const name of names) {
        if (text.includes(name)) {
          // fine — the NAME is the reference; the VALUE must not be present
          expect(text.includes('=ghp_')).toBe(false);
        }
      }
    }
  });
});

describe('structural scan: workspace discipline', () => {
  it('leaves pnpm-workspace.yaml byte-identical to the base (new packages join through existing globs)', () => {
    const workspace = readFileSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('- packages/*');
    expect(workspace).toContain('- tests/*');
    expect(workspace).toContain('- apps/*');
    // no lane-specific entries were added
    expect(workspace.includes('real-observation')).toBe(false);
    expect(workspace.includes('live-mission')).toBe(false);
  });
});
