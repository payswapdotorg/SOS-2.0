#!/usr/bin/env node
/**
 * The provider-states summarizer (Work Order P17-A): aggregates the four
 * per-provider evidence records (neon/upstash/r2/vercel) into the lane's
 * provider-states.json — the machine-readable honest-state summary the
 * README references. Pure derivation from the committed records (never
 * a fresh probe; the states are exactly what the journeys recorded).
 *
 * Usage: node infra/production-connectivity/scripts/summarize-provider-states.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(here, '..', '..', '..', 'docs', 'evidence', 'production-connectivity', 'persistence-deployment');

const sources = [
  { file: 'neon-integration.json', provider: 'neon' },
  { file: 'upstash-integration.json', provider: 'upstash' },
  { file: 'r2-integration.json', provider: 'r2' },
  { file: 'vercel-deployment.json', provider: 'vercel' },
];

const summary = {
  schema: 'sos-2/p17a/provider-states',
  work_order: 'P17-A',
  produced_at: new Date().toISOString(),
  providers: [],
  aggregate_note: null,
};

const rank = { UNAVAILABLE: 0, DEGRADED: 1, CONNECTED: 2 };
for (const source of sources) {
  const record = JSON.parse(readFileSync(join(evidenceDir, source.file), 'utf8'));
  const state = record.provider_states[0];
  summary.providers.push({
    provider: source.provider,
    state: state.state,
    probed_at: state.probed_at,
    credential_env: state.credential_env,
    api_revision: state.api_revision,
    last_error: state.last_error,
    probes: state.probes.length,
    evidence_file: source.file,
  });
}

const withEvidence = summary.providers.filter((provider) => provider.state !== 'UNKNOWN');
const worst = withEvidence.reduce((acc, provider) => (rank[provider.state] < rank[acc.state] ? provider : acc), withEvidence[0]);
const states = summary.providers.map((provider) => provider.state);
summary.aggregate_note =
  `Honest states from REAL probes only: ${states.join(' / ')}. ` +
  (worst === undefined
    ? 'no provider was probed (all UNKNOWN — never health).'
    : worst.state === 'CONNECTED'
      ? 'every probed provider answered its probe (CONNECTED — real evidence, never fabricated).'
      : `the worst probed provider state is ${worst.state} (${worst.provider}): ${worst.last_error ?? 'unspecified'} — recorded verbatim, never a silent skip, never a fabricated success.`);

mkdirSync(evidenceDir, { recursive: true });
const out = join(evidenceDir, 'provider-states.json');
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`provider-states summary written: ${out} (${summary.providers.map((provider) => `${provider.provider}=${provider.state}`).join(', ')})`);
