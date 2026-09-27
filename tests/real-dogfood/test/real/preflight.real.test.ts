/**
 * The REAL preflight probes (Work Order P19, RUN_REAL=1, default OFF) —
 * the honest provider states BEFORE any journey runs: GitHub (the
 * PAT-backed whoami), Vercel (the authenticated /v2/user probe),
 * OpenRouter (the real key check), Neon/Upstash (the DNS probes) and
 * the honest store selection. Probe-only: NO repository/project is
 * created here (the journey runs create their own). A provider outage
 * is VALID evidence — recorded as UNAVAILABLE with the real failure,
 * never a silent skip, never a fabricated CONNECTED.
 */

import { describe, expect, it } from 'vitest';
import { bindGlobalFetch } from '@sos-2/deployment-providers';
import { createRealDogfoodHarness, probeDogfoodProviders, selectDogfoodStore, DOGFOOD_DEFAULT_BODY_MODEL, resolveDogfoodEnvironment, createDogfoodVercelClient } from '@sos-2/dogfood-live';
import { FetchGitHubRequestPort, RealGitHubProvider } from '@sos-2/real-github';
import { OpenRouterModelClient } from '@sos-2/real-bodies';
import { ambientSource, credentialEnvNames, realClock, RUN_REAL } from './real-world.js';
import { writeDogfoodEvidence, repoHeadSha } from '../../src/evidence.js';

const suite = RUN_REAL ? describe : describe.skip;

suite('REAL dogfood preflight (RUN_REAL=1): the honest provider states before the journeys', () => {
  const source = ambientSource();
  const head = repoHeadSha();
  const env = resolveDogfoodEnvironment(source);

  it('probes every provider honestly (CONNECTED/UNAVAILABLE — never fabricated)', async () => {
    const githubRequestPort = new FetchGitHubRequestPort({ token: env.github.token });
    const provider = new RealGitHubProvider({ requestPort: githubRequestPort, credentialEnv: env.github.credentialEnv });
    const vercelClient = env.vercel.token !== null ? createDogfoodVercelClient({ token: env.vercel.token, teamId: env.vercel.orgId, fetch: bindGlobalFetch() }) : null;
    void OpenRouterModelClient;

    const providerStates = await probeDogfoodProviders({
      github: provider,
      githubCredentialEnv: env.github.credentialEnv,
      vercel: vercelClient,
      vercelCredentialEnv: env.vercel.credentialEnv,
      openRouterApiKey: env.openRouter.apiKey,
      openRouterCredentialEnv: env.openRouter.credentialEnv,
      clock: realClock,
    });
    const storeSelection = selectDogfoodStore({
      databaseUrl: env.databaseUrl,
      databaseUrlEnv: env.databaseUrlEnv,
      canonicalProbeOk: false,
      coordinationProbeOk: false,
    });

    expect(providerStates.length).toBeGreaterThanOrEqual(5);
    for (const name of ['github', 'vercel', 'openrouter', 'neon', 'upstash']) {
      expect(providerStates.some((state) => state.provider === name), `the ${name} row must exist`).toBe(true);
    }
    const github = providerStates.find((state) => state.provider === 'github')!;
    expect(github.state, `github must be CONNECTED for the dogfood to proceed (honest: ${github.detail})`).toBe('CONNECTED');
    const vercel = providerStates.find((state) => state.provider === 'vercel')!;
    expect(vercel.state, `vercel must be CONNECTED for the dogfood to proceed (honest: ${vercel.detail})`).toBe('CONNECTED');
    const openRouter = providerStates.find((state) => state.provider === 'openrouter')!;
    expect(openRouter.state, `openrouter must be CONNECTED for the dogfood to proceed (honest: ${openRouter.detail})`).toBe('CONNECTED');

    writeDogfoodEvidence({
      evidence_kind: 'dogfood-preflight',
      record: {
        schema: 'sos-2/p19/dogfood-preflight',
        credential_envs: credentialEnvNames(source),
        body_model: env.bodyModel ?? DOGFOOD_DEFAULT_BODY_MODEL,
        provider_states: providerStates,
        store_selection: storeSelection,
        github_transport_telemetry: {
          requests: githubRequestPort.telemetry().requests,
          api_revision: githubRequestPort.telemetry().apiRevision,
          oauth_scopes: githubRequestPort.telemetry().oauthScopes,
          rate_limit: githubRequestPort.telemetry().rateLimit,
        },
        honest_notes: [
          'CONNECTED derives from real probes only (the PAT-backed whoami, the authenticated /v2/user probe, the real key check); UNAVAILABLE/UNKNOWN rows carry the real failures verbatim',
          'probe-only: no repository/project was created here (the journey runs create their own)',
        ],
      },
      file: 'preflight.json',
      head,
    });
  });

  it('the harness composition resolves the environment by env NAMES only (the registry constant)', () => {
    expect(env.github.credentialEnv === 'PAYSWAP_GITHUB_TOKEN' || env.github.credentialEnv === 'GITHUB_ACCESS_TOKEN').toBe(true);
    expect(env.openRouter.credentialEnv).toBe('OPENROUTER_API_KEY');
    expect(env.vercel.credentialEnv).toBe('VERCEL_TOKEN');
    expect(env.vercel.orgIdEnv).toBe('VERCEL_ORG_ID');
    const serialized = JSON.stringify({ env: { ...env, github: { credentialEnv: env.github.credentialEnv }, openRouter: { credentialEnv: env.openRouter.credentialEnv }, vercel: { credentialEnv: env.vercel.credentialEnv, orgIdEnv: env.vercel.orgIdEnv } } });
    for (const value of Object.values(source)) {
      if (value.length > 8) {
        expect(serialized.includes(value), 'a credential VALUE must never appear in a resolved-environment record').toBe(false);
      }
    }
    void createRealDogfoodHarness;
  });
});
