#!/usr/bin/env node
/**
 * THE P18-B PROJECT ENV SETUP (Work Order P18-B — env-only operator
 * configuration): sets the runtime env vars the DEPLOYED live action
 * endpoint consumes, on the sos-2-0 Vercel project (production + preview
 * targets), through the REAL API.
 *
 * The names (never values in evidence — values arrive env-only here):
 *   LIVE_MISSION_GRANTS      the operator grant declaration for the
 *                            console-user (the authority model: env is
 *                            the operator's control plane; unset/empty
 *                            denies EVERY action, fail-closed)
 *   BODY_PROVIDER_API_KEY    the OpenRouter key backing the real body
 *                            summon probe
 *   BODY_PROVIDER_MODEL      the model override (default: the P17-B
 *                            journey model)
 *   VERCEL_TOKEN / VERCEL_PROJECT_ID — the deployment records the
 *                            promotion/rollback actions bind to (read
 *                            from the runtime env inside the deployed
 *                            function)
 *
 * A credential is never authority by itself: the grants declaration is
 * what authorizes; the provider envs only bind the real executors.
 */

import { fileURLToPath } from 'node:url';

const VERCEL_TOKEN = process.env['VERCEL_TOKEN'] ?? '';
const VERCEL_PROJECT_ID = process.env['VERCEL_PROJECT_ID'] ?? '';
const DECLARED_ORG_ID = process.env['VERCEL_ORG_ID'] ?? '';

const ENV_VARS = [
  { key: 'LIVE_MISSION_GRANTS', value: process.env['LIVE_MISSION_GRANTS'] ?? 'body-lifecycle:*,promotion:production,rollback:*' },
  { key: 'BODY_PROVIDER_API_KEY', value: process.env['BODY_PROVIDER_API_KEY'] ?? '' },
  { key: 'BODY_PROVIDER_MODEL', value: process.env['BODY_PROVIDER_MODEL'] ?? 'qwen/qwen3-coder-flash' },
  { key: 'VERCEL_TOKEN', value: VERCEL_TOKEN },
  { key: 'VERCEL_PROJECT_ID', value: VERCEL_PROJECT_ID },
];

const API = 'https://api.vercel.com';

async function main() {
  const missing = [];
  if (VERCEL_TOKEN.length === 0) missing.push('VERCEL_TOKEN');
  if (VERCEL_PROJECT_ID.length === 0) missing.push('VERCEL_PROJECT_ID');
  if (ENV_VARS.find((entry) => entry.key === 'BODY_PROVIDER_API_KEY')?.value.length === 0) missing.push('BODY_PROVIDER_API_KEY');
  if (missing.length > 0) {
    console.error(`missing required env: ${missing.join(', ')} (names only)`);
    process.exit(1);
  }

  let teamQuery = '';
  if (DECLARED_ORG_ID.length === 0) {
    const user = await fetch(`${API}/v2/user`, { headers: { authorization: `Bearer ${VERCEL_TOKEN}` } });
    const body = (await user.json()) ?? {};
    const discovered = body?.user?.defaultTeamId ?? null;
    if (discovered !== null) teamQuery = `&teamId=${discovered}`;
    console.log(`org discovered via /v2/user: ${discovered ?? 'personal'}`);
  } else {
    teamQuery = `&teamId=${DECLARED_ORG_ID}`;
  }

  for (const entry of ENV_VARS) {
    const response = await fetch(`${API}/v10/projects/${VERCEL_PROJECT_ID}/env?upsert=true${teamQuery}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${VERCEL_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ key: entry.key, value: entry.value, type: 'encrypted', target: ['production', 'preview'] }),
    });
    const text = await response.text();
    console.log(`set ${entry.key}: ${String(response.status)} ${response.status < 300 ? 'ok' : text.slice(0, 200)}`);
    if (response.status >= 300) {
      process.exitCode = 1;
    }
  }
  console.log(`done (project ${VERCEL_PROJECT_ID}; env NAMES recorded here — values never logged)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
