/**
 * The environment-contract pin tests (Work Order P4): the composition
 * between this package's configuration and @sos-2/infra-deployment's
 * environment contract. The infra package declares ZERO imports from or
 * into packages/* (its frozen P3 boundary), so the pin is TEST-side:
 * the actual registry + loadEnvironment sources are imported here and
 * the alignment is machine-verified — a rename in the frozen registry
 * fails this suite loudly instead of drifting silently.
 *
 * Secrets discipline: values are never echoed — only NAMES appear in
 * messages and assertions.
 */

import {
  GITHUB_ENVIRONMENT_VARIABLES,
  isGitHubEnvironmentTier,
  realConnectionStateFromEnvironment,
  resolveGitHubEnvironment,
} from '../src/index.ts';

const infra = await import('../../../infra/deployment/src/index.ts');
const systemState = await import('../../system-state/src/index.ts');

const SYNTHETIC_TOKEN = 'ghp_' + 'A0b0'.repeat(9);

describe('the GitHub-scope variable names are pinned to @sos-2/infra-deployment\'s registry', () => {
  test('the names this adapter reads are exactly the registry names (GITHUB_VARIABLES)', () => {
    expect(GITHUB_ENVIRONMENT_VARIABLES.accessToken).toBe(infra.GITHUB_VARIABLES.accessToken);
    expect(GITHUB_ENVIRONMENT_VARIABLES.webhookSecret).toBe(infra.GITHUB_VARIABLES.webhookSecret);
  });

  test('both names are registered GitHub-scope variables in the environment registry (secret, token-shaped)', () => {
    const accessTokenSpec = infra.variableSpec(GITHUB_ENVIRONMENT_VARIABLES.accessToken);
    const webhookSecretSpec = infra.variableSpec(GITHUB_ENVIRONMENT_VARIABLES.webhookSecret);
    expect(accessTokenSpec?.provider).toBe('github');
    expect(accessTokenSpec?.secret).toBe(true);
    expect(accessTokenSpec?.shape).toBe('token');
    expect(webhookSecretSpec?.provider).toBe('github');
    expect(webhookSecretSpec?.secret).toBe(true);
  });

  test('the tier vocabulary matches @sos-2/infra-deployment\'s EnvironmentTier', () => {
    for (const tier of infra.ENVIRONMENT_TIERS) {
      expect(isGitHubEnvironmentTier(tier)).toBe(true);
    }
    expect(isGitHubEnvironmentTier('staging')).toBe(false);
  });
});

describe('resolveGitHubEnvironment extracts exactly what loadEnvironment exposes (composition pinned)', () => {
  test('a source the real loadEnvironment accepts yields the same secret values (names only in messages)', () => {
    const source = {
      APP_BASE_URL: 'https://sos.example.invalid',
      VERCEL_PROJECT_ID: 'sos',
      VERCEL_ORG_ID: 'sosorg',
      VERCEL_TOKEN: SYNTHETIC_TOKEN,
      VERCEL_APP_ROOT: 'apps/web',
      DATABASE_URL: 'postgres://user:pass@db.example.invalid/sos',
      NEON_DATABASE_NAME: 'sos',
      NEON_BRANCH_NAME: 'main',
      NEON_API_KEY: 'napi_' + 'c0'.repeat(20),
      UPSTASH_REDIS_REST_URL: 'https://cache.example.invalid',
      UPSTASH_REDIS_REST_TOKEN: SYNTHETIC_TOKEN,
      R2_ACCOUNT_ID: 'sos',
      R2_ACCESS_KEY_ID: 'sos-access-key-0001',
      R2_SECRET_ACCESS_KEY: 'sossecret',
      R2_BUCKET_NAME: 'sos-artifacts',
      GITHUB_ACCESS_TOKEN: SYNTHETIC_TOKEN,
      GITHUB_WEBHOOK_SECRET: 'whsec_' + 'd0'.repeat(20),
    };
    const record = infra.loadEnvironment('preview', source);
    const resolution = resolveGitHubEnvironment(source);
    expect(resolution.missing).toEqual([]);
    expect(resolution.credentials.access_token).toBe(record.getSecretValue(infra.GITHUB_VARIABLES.accessToken));
    expect(resolution.credentials.webhook_secret).toBe(record.getSecretValue(infra.GITHUB_VARIABLES.webhookSecret));
  });

  test('an empty source resolves to absent credentials with NAMES-only missing (values never echoed)', () => {
    const resolution = resolveGitHubEnvironment({});
    expect(resolution.credentials.access_token).toBeNull();
    expect(resolution.credentials.webhook_secret).toBeNull();
    expect(resolution.missing).toEqual(['GITHUB_ACCESS_TOKEN', 'GITHUB_WEBHOOK_SECRET']);
    expect(resolution.note).not.toContain('ghp_');
  });

  test('an empty-string value is absent (the loadEnvironment rule)', () => {
    const resolution = resolveGitHubEnvironment({ GITHUB_ACCESS_TOKEN: '', GITHUB_WEBHOOK_SECRET: '' });
    expect(resolution.missing).toEqual(['GITHUB_ACCESS_TOKEN', 'GITHUB_WEBHOOK_SECRET']);
  });
});

describe('the real connection state is honestly NOT_YET_CONNECTED (never fabricated)', () => {
  test('credentials absent: NOT_YET_CONNECTED with the names-only note', () => {
    const resolution = resolveGitHubEnvironment({});
    const state = realConnectionStateFromEnvironment({ provider_id: 'github-transport', tier: 'production', resolution });
    expect(state.status).toBe('NOT_YET_CONNECTED');
    expect(state.simulated).toBe(false);
    expect(state.granted_scopes).toEqual([]);
    expect(state.connected_at).toBeNull();
    expect(state.note).toContain('GITHUB_ACCESS_TOKEN');
  });

  test('credentials present but unverified: STILL NOT_YET_CONNECTED (configured is PREPARED, never CONNECTED)', () => {
    const resolution = resolveGitHubEnvironment({
      GITHUB_ACCESS_TOKEN: SYNTHETIC_TOKEN,
      GITHUB_WEBHOOK_SECRET: 'whsec_' + 'd0'.repeat(20),
    });
    const state = realConnectionStateFromEnvironment({ provider_id: 'github-transport', tier: 'preview', resolution });
    expect(state.status).toBe('NOT_YET_CONNECTED');
    expect(state.note).toContain('no real handshake has completed');
    expect(state.note).toContain('never fabricates connection evidence');
  });

  test('the state shape is validated (exact field set, CONNECTED never fabricated here)', async () => {
    const { assertValidGitHubConnectionState } = await import('../src/index.ts');
    const state = realConnectionStateFromEnvironment({
      provider_id: 'github-transport',
      tier: 'local',
      resolution: resolveGitHubEnvironment({}),
    });
    expect(() => assertValidGitHubConnectionState(state)).not.toThrow();
  });
});

describe('the revision kind is pinned to @sos-2/system-state\'s frozen vocabulary', () => {
  test("imported revisions carry the frozen 'git-sha' revision kind (IMPLEMENTATION_REVISION_KIND)", () => {
    expect(infra).toBeDefined();
    expect(systemState.IMPLEMENTATION_REVISION_KIND).toBe('git-sha');
  });
});
