/**
 * The DETERMINISTIC reference-mode suite of the real GitHub adapter
 * (Work Order P17-B): the frozen GitHubPort contract compliance of
 * @sos-2/real-github — offline (a scripted request port), fixed seed,
 * run-to-run identical.
 *
 * Pins (per the work order):
 *   1. the field-for-field P4 vocabulary alignment (the structural
 *      mirror vs the REAL frozen P4 package sources — the P8 pinning
 *      precedent of non-literal dynamic imports);
 *   2. the honest connection discipline (CONNECTED only after the
 *      PAT-backed real handshake probe; the implemented OAuth surface;
 *      REFUSED otherwise — never fabricated);
 *   3. REST request/response mapping (exact method/path/query/body);
 *   4. honest error mapping (typed UNSUPPORTED carrying the truthful
 *      status; rate limits as DEGRADED with REAL reset data);
 *   5. the secret redaction discipline (the credential never appears).
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FetchGitHubRequestPort,
  GITHUB_OAUTH_AUTHORIZE_URL,
  REAL_GITHUB_PROVIDER_ID,
  createRealGitHubProvider,
} from '@sos-2/real-github';
import type { GitHubProviderRequest } from '@sos-2/real-github';
import { ScriptedFetch, ScriptedGitHubRequestPort, scriptedProvider, type P4GithubModule } from './world.js';

const NOW = '2026-09-25T12:00:00Z';
const REPO = { owner: 'payswapdotorg', name: 'sos-connectivity-scratch' };
const HEAD_SHA = '5f1c0d3e9a8b7d6c4e2f1a0b9c8d7e6f5a4b3c2d';

function requestOf(port: ScriptedGitHubRequestPort, index: number): GitHubProviderRequest<unknown> {
  const request = port.requests[index];
  if (request === undefined) {
    throw new Error(`no request ${index} was dispatched (dispatched ${port.requests.length})`);
  }
  return request;
}

describe('the P4 vocabulary alignment (structural, pinned against the real frozen sources)', () => {
  /**
   * The @sos-2/real-github github-vocabulary is carried STRUCTURALLY
   * (the P4 package is a frozen zero-dependency no-build package — the
   * P8 body-runtimes / web-contracts precedent). This suite imports the
   * REAL P4 package sources through a non-literal dynamic import
   * (vitest transforms them; the tsc build never sees the specifier)
   * and pins field-for-field compatibility.
   */
  it('the vocabularies and functions are field-for-field identical to the real P4 sources', async () => {
    const githubUrl = join(import.meta.dirname, '..', '..', '..', 'packages', 'github', 'src', 'index.ts');
    const github = (await import(/* @vite-ignore */ githubUrl)) as unknown as P4GithubModule;
    const mirror = await import('@sos-2/real-github');

    expect([...mirror.GITHUB_CAPABILITIES]).toEqual([...github.GITHUB_CAPABILITIES]);
    expect([...mirror.GITHUB_CONNECTION_SCOPES]).toEqual([...github.GITHUB_CONNECTION_SCOPES]);
    expect([...mirror.GITHUB_ONBOARDING_READ_SCOPES]).toEqual([...github.GITHUB_ONBOARDING_READ_SCOPES]);
    expect([...mirror.GITHUB_ONBOARDING_WRITE_SCOPES]).toEqual([...github.GITHUB_ONBOARDING_WRITE_SCOPES]);
    expect([...mirror.GITHUB_CONNECTION_STATUSES]).toEqual([...github.GITHUB_CONNECTION_STATUSES]);
    expect(mirror.repositorySlug(REPO)).toBe(github.repositorySlug(REPO));
    expect(mirror.parseRepositorySlug('payswapdotorg/sos-connectivity-scratch')).toEqual(
      github.parseRepositorySlug('payswapdotorg/sos-connectivity-scratch'),
    );
    // The mirror's buildCapabilitySurface rejects exactly like the P4 original.
    expect(() => mirror.buildCapabilitySurface({ provider_id: 'x', supported: ['not-a-capability' as never], note: 'x' })).toThrow();
    expect(() => github.buildCapabilitySurface({ provider_id: 'x', supported: ['not-a-capability'], note: 'x' })).toThrow();

    // The P4 reference provider's typed records carry exactly the field
    // sets the structural vocabulary declares (the P8 pin, repeated here
    // against the real provider package's shapes).
    const provider = github.createInMemoryGitHubProvider() as {
      connection(): Record<string, unknown>;
      createBranch(input: unknown): Promise<{ status: string; result?: Record<string, unknown> }>;
      commitFiles(input: unknown): Promise<{ status: string; result?: Record<string, unknown> }>;
      createPullRequest(input: unknown): Promise<{ status: string; result?: Record<string, unknown> }>;
    };
    const connection = provider.connection();
    expect(Object.keys(connection).sort()).toEqual(['connected_at', 'granted_scopes', 'note', 'provider_id', 'simulated', 'status'].sort());
    expect(connection['status']).toBe('NOT_YET_CONNECTED');
    const branch = await provider.createBranch({ repository: { owner: 'acme', name: 'legacy-checkout' }, name: 'align/branch', from_sha: 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7' });
    expect(branch.status).toBe('OK');
    if (branch.result !== undefined) {
      expect(Object.keys(branch.result).sort()).toEqual(['head_sha', 'is_protected', 'name'].sort());
    }
    const commit = await provider.commitFiles({
      repository: { owner: 'acme', name: 'legacy-checkout' },
      branch: 'align/branch',
      message: 'alignment',
      files: [{ path: 'a.ts', contents: 'a' }],
    });
    expect(commit.status).toBe('OK');
    if (commit.result !== undefined) {
      expect(Object.keys(commit.result).sort()).toEqual(['branch', 'committed_at', 'message', 'repository', 'sha'].sort());
    }
    const pullRequest = await provider.createPullRequest({
      repository: { owner: 'acme', name: 'legacy-checkout' },
      title: 'alignment pr',
      head_branch: 'align/branch',
      base_branch: 'main',
      body: null,
    });
    expect(pullRequest.status).toBe('OK');
    if (pullRequest.result !== undefined) {
      expect(Object.keys(pullRequest.result).sort()).toEqual(
        ['base_branch', 'head_branch', 'head_sha', 'number', 'repository', 'state', 'title', 'url'].sort(),
      );
    }
  });

  it('the real provider structurally realizes the frozen GitHubPort surface', () => {
    const { provider } = scriptedProvider([]);
    const required: (keyof typeof provider | 'descriptor')[] = [
      'capabilities',
      'connection',
      'beginConnection',
      'completeConnection',
      'discoverRepositories',
      'listBranches',
      'getRepositorySnapshot',
      'importSnapshot',
      'registerWebhook',
      'createBranch',
      'commitFiles',
      'createPullRequest',
    ];
    for (const member of required) {
      expect(typeof (provider as unknown as Record<string, unknown>)[member], `GitHubPort member ${member}`).toBe('function');
    }
    expect(provider.descriptor.provider_id).toBe(REAL_GITHUB_PROVIDER_ID);
    expect(provider.descriptor.adapter_contract).toBe('ProjectAdapter');
    expect(provider.capabilities().supported.length).toBe(10);
    expect(provider.capabilities().unsupported).toEqual([]);
  });
});

describe('the honest connection discipline (CONNECTED is never fabricated)', () => {
  it('starts NOT_YET_CONNECTED (not simulated) with the provider state UNKNOWN (unprobed)', () => {
    const { provider } = scriptedProvider([]);
    const connection = provider.connection();
    expect(connection.status).toBe('NOT_YET_CONNECTED');
    expect(connection.simulated).toBe(false);
    expect(connection.granted_scopes).toEqual([]);
    expect(connection.connected_at).toBeNull();
    const state = provider.providerState();
    expect(state.state).toBe('UNKNOWN');
    expect(state.login).toBeNull();
    expect(state.note).toContain('UNKNOWN');
  });

  it('completeConnection REFUSES without a completed real handshake — never fabricates CONNECTED', () => {
    const { provider } = scriptedProvider([]);
    const result = provider.completeConnection({
      authorization_ref: 'ref-1',
      authorization_code: 'a-real-looking-code',
      completed_at: NOW,
    });
    expect(result.status).toBe('REFUSED');
    if (result.status === 'REFUSED') {
      expect(result.reason).toContain('never fabricated');
    }
  });

  it('completeConnection REFUSES an empty authorization code (fail closed)', () => {
    const { provider } = scriptedProvider([]);
    const result = provider.completeConnection({ authorization_ref: 'ref-1', authorization_code: '', completed_at: NOW });
    expect(result.status).toBe('REFUSED');
  });

  it('verifyToken probes the REAL /user endpoint; success is the only path to CONNECTED', async () => {
    const { provider, port } = scriptedProvider([
      { status: 200, body: { login: 'payswapdotorg' }, oauthScopes: ['repo'], apiRevision: '2022-11-28', rateLimit: { limit: 5000, remaining: 4999, used: 1, reset: 1790000000 } },
    ]);
    const verification = await provider.verifyToken(NOW);
    expect(verification.verified).toBe(true);
    expect(verification.login).toBe('payswapdotorg');
    expect(port.requests[0]?.path).toBe('/user');
    const connection = provider.connection();
    expect(connection.status).toBe('CONNECTED');
    expect(connection.simulated).toBe(false);
    expect(connection.connected_at).toBe(NOW);
    expect(connection.granted_scopes).toEqual([
      'repository:metadata:read',
      'repository:contents:read',
      'repository:contents:write',
      'repository:pull-requests:write',
    ]);
    const state = provider.providerState();
    expect(state.state).toBe('CONNECTED');
    expect(state.login).toBe('payswapdotorg');
    expect(state.api_revision).toBe('2022-11-28');
    expect(state.rate_limit?.remaining).toBe(4999);
    // The frozen contract surface completes only after the real probe.
    const completed = provider.completeConnection({ authorization_ref: 'ref-1', authorization_code: 'the-pat', completed_at: NOW });
    expect(completed.status).toBe('CONNECTED');
  });

  it('a rejected credential stays NOT_YET_CONNECTED and the provider state is UNAVAILABLE', async () => {
    const { provider } = scriptedProvider([{ status: 401, body: { message: 'Bad credentials' } }]);
    const verification = await provider.verifyToken(NOW);
    expect(verification.verified).toBe(false);
    expect(verification.failure).toContain('Bad credentials');
    expect(provider.connection().status).toBe('NOT_YET_CONNECTED');
    const state = provider.providerState();
    expect(state.state).toBe('UNAVAILABLE');
    const completed = provider.completeConnection({ authorization_ref: 'ref-1', authorization_code: 'the-pat', completed_at: NOW });
    expect(completed.status).toBe('REFUSED');
  });

  it('a rate-limited probe surfaces DEGRADED with the REAL reset epoch (never a fake success)', async () => {
    const { provider } = scriptedProvider([
      { status: 403, body: { message: 'API rate limit exceeded' }, rateLimit: { limit: 5000, remaining: 0, used: 5000, reset: 1790001200 } },
    ]);
    await provider.verifyToken(NOW);
    const state = provider.providerState();
    expect(state.state).toBe('DEGRADED');
    expect(state.rate_limit?.reset_epoch_s).toBe(1790001200);
    expect(state.note).toContain('1790001200');
  });

  it('the OAuth app authorization surface is implemented: beginConnection builds the real authorize URL', () => {
    const { provider } = scriptedProvider([], { oauth: { clientId: 'Iv1.client123', redirectUri: 'https://sos.invalid/callback' } });
    const authorization = provider.beginConnection({ scopes: ['repository:contents:write'], state_token: 'csrf-state-42' });
    expect(authorization.simulated).toBe(false);
    const url = new URL(authorization.authorization_url);
    expect(url.origin + url.pathname).toBe(GITHUB_OAUTH_AUTHORIZE_URL);
    expect(url.searchParams.get('client_id')).toBe('Iv1.client123');
    expect(url.searchParams.get('state')).toBe('csrf-state-42');
    expect(url.searchParams.get('scope')).toBe('repo');
    expect(authorization.note).toContain('PAT-backed');
  });

  it('beginConnection without a bound OAuth app stays honest (no fabricated URL)', () => {
    const { provider } = scriptedProvider([]);
    const authorization = provider.beginConnection({ scopes: [], state_token: 'csrf-state-42' });
    expect(authorization.authorization_url).toBe('');
    expect(authorization.requested_scopes).toEqual(['repository:metadata:read', 'repository:contents:read']);
    expect(authorization.note).toContain('this instance has none bound');
  });
});

describe('REST request/response mapping (exact method + path + query + body)', () => {
  it('discoverRepositories pages GET /user/repos and maps the summary fields (empty detection included)', async () => {
    const { provider, port } = scriptedProvider([
      {
        status: 200,
        body: [
          {
            id: 901,
            name: 'sos-connectivity-scratch',
            owner: { login: 'payswapdotorg' },
            private: true,
            description: 'P17-B scratch',
            default_branch: 'main',
            size: 2,
            pushed_at: '2026-09-25T11:00:00Z',
            html_url: 'https://github.com/payswapdotorg/sos-connectivity-scratch',
          },
          {
            id: 902,
            name: 'empty-one',
            owner: { login: 'payswapdotorg' },
            private: true,
            description: null,
            default_branch: null,
            size: 0,
            pushed_at: null,
            html_url: 'https://github.com/payswapdotorg/empty-one',
          },
        ],
      },
    ]);
    const outcome = await provider.discoverRepositories();
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result).toHaveLength(2);
      expect(outcome.result[0]).toEqual({
        id: REPO,
        visibility: 'private',
        description: 'P17-B scratch',
        default_branch: 'main',
        is_empty: false,
        webhooks_supported: true,
        pushed_at: '2026-09-25T11:00:00Z',
      });
      expect(outcome.result[1]?.is_empty).toBe(true);
      expect(outcome.result[1]?.default_branch).toBeNull();
    }
    const request = requestOf(port, 0);
    expect(request.method).toBe('GET');
    expect(request.path).toBe('/user/repos');
    expect(request.query).toMatchObject({ per_page: '100', sort: 'pushed', page: '1' });
  });

  it('listBranches maps branch records; a missing repository answers the typed UNSUPPORTED with the truthful status', async () => {
    const { provider, port } = scriptedProvider([
      { status: 200, body: [{ name: 'main', commit: { sha: HEAD_SHA }, protected: true }] },
      { status: 404, body: { message: 'Not Found' } },
    ]);
    const ok = await provider.listBranches(REPO);
    expect(ok.status).toBe('OK');
    if (ok.status === 'OK') {
      expect(ok.result[0]).toEqual({ name: 'main', head_sha: HEAD_SHA, is_protected: true });
    }
    expect(requestOf(port, 0).path).toBe('/repos/payswapdotorg/sos-connectivity-scratch/branches');
    const missing = await provider.listBranches({ owner: 'payswapdotorg', name: 'does-not-exist' });
    expect(missing.status).toBe('UNSUPPORTED');
    if (missing.status === 'UNSUPPORTED') {
      expect(missing.capability).toBe('branch-selection');
      expect(missing.provider_id).toBe(REAL_GITHUB_PROVIDER_ID);
      expect(missing.reason).toContain('404');
      expect(missing.reason).toContain('Not Found');
      expect(missing.reason).toContain('never a fabricated success');
    }
  });

  it('getRepositorySnapshot: empty detection (the real branches probe) answers the empty snapshot', async () => {
    const { provider } = scriptedProvider([
      { status: 200, body: { name: REPO.name, owner: { login: REPO.owner }, private: true, description: 'empty scratch', default_branch: null, size: 0, pushed_at: null } },
      { status: 200, body: [] },
    ]);
    const outcome = await provider.getRepositorySnapshot(REPO, {}, NOW);
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result.is_empty).toBe(true);
      expect(outcome.result.tree).toEqual([]);
      expect(outcome.result.file_count).toBe(0);
      expect(outcome.result.ref).toEqual({ branch: '', sha: '' });
      expect(outcome.result.captured_at).toBe(NOW);
      const imported = provider.importSnapshot(outcome.result);
      expect(imported.revision).toEqual({ kind: 'git-sha', value: '' });
    }
  });

  it('getRepositorySnapshot: an empty repository with an explicit branch answers the typed revision-selection refusal', async () => {
    const { provider } = scriptedProvider([
      { status: 200, body: { name: REPO.name, owner: { login: REPO.owner }, private: true, description: null, default_branch: null, size: 0, pushed_at: null } },
      { status: 200, body: [] },
    ]);
    const outcome = await provider.getRepositorySnapshot(REPO, { branch: 'main' }, NOW);
    expect(outcome.status).toBe('UNSUPPORTED');
    if (outcome.status === 'UNSUPPORTED') {
      expect(outcome.capability).toBe('revision-selection');
      expect(outcome.reason).toContain('empty');
    }
  });

  it('getRepositorySnapshot: resolves the branch head and imports the recursive tree (blob -> file, tree -> dir)', async () => {
    const { provider, port } = scriptedProvider([
      { status: 200, body: { name: REPO.name, owner: { login: REPO.owner }, private: true, description: 'scratch', default_branch: 'main', size: 8, pushed_at: '2026-09-25T11:00:00Z' } },
      { status: 200, body: [{ name: 'main', commit: { sha: HEAD_SHA }, protected: false }] },
      { status: 200, body: { ref: 'refs/heads/main', object: { sha: HEAD_SHA, type: 'commit' } } },
      {
        status: 200,
        body: {
          sha: 'tree-sha-1',
          truncated: false,
          tree: [
            { path: 'README.md', type: 'blob', size: 1204, sha: 'b1' },
            { path: 'src', type: 'tree', sha: 't1' },
            { path: 'src/index.ts', type: 'blob', size: 8211, sha: 'b2' },
          ],
        },
      },
    ]);
    const outcome = await provider.getRepositorySnapshot(REPO, { branch: 'main' }, NOW);
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result.ref).toEqual({ branch: 'main', sha: HEAD_SHA });
      expect(outcome.result.is_empty).toBe(false);
      expect(outcome.result.tree).toEqual([
        { path: 'README.md', type: 'file', size_bytes: 1204 },
        { path: 'src', type: 'dir', size_bytes: null },
        { path: 'src/index.ts', type: 'file', size_bytes: 8211 },
      ]);
      expect(outcome.result.file_count).toBe(2);
      const imported = provider.importSnapshot(outcome.result);
      expect(imported).toEqual({ repository: REPO, branch: 'main', revision: { kind: 'git-sha', value: HEAD_SHA } });
    }
    expect(requestOf(port, 2).path).toBe(`/repos/payswapdotorg/sos-connectivity-scratch/git/ref/heads/main`);
    expect(requestOf(port, 3).query).toEqual({ recursive: '1' });
  });

  it('createBranch POSTs the exact git/refs body and answers the new BranchRef', async () => {
    const { provider, port } = scriptedProvider([
      { status: 201, body: { ref: 'refs/heads/wo/p17b-probe', object: { sha: HEAD_SHA, type: 'commit' } } },
    ]);
    const outcome = await provider.createBranch({ repository: REPO, name: 'wo/p17b-probe', from_sha: HEAD_SHA });
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result).toEqual({ name: 'wo/p17b-probe', head_sha: HEAD_SHA, is_protected: false });
    }
    const request = requestOf(port, 0);
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/repos/payswapdotorg/sos-connectivity-scratch/git/refs');
    expect(request.body).toEqual({ ref: 'refs/heads/wo/p17b-probe', sha: HEAD_SHA });
  });

  it('commitFiles on a non-empty repository walks the Git Data API and returns ONE CommitRef with the resulting sha', async () => {
    const { provider, port } = scriptedProvider([
      { status: 200, body: [{ name: 'main', commit: { sha: HEAD_SHA }, protected: false }] },
      { status: 200, body: { ref: 'refs/heads/main', object: { sha: HEAD_SHA, type: 'commit' } } },
      { status: 200, body: { sha: HEAD_SHA, tree: { sha: 'base-tree-sha' }, commit: { message: 'init', committer: { date: '2026-09-25T11:00:00Z' } } } },
      { status: 201, body: { sha: 'blob-sha-1' } },
      { status: 201, body: { sha: 'new-tree-sha' } },
      { status: 201, body: { sha: 'new-commit-sha', tree: { sha: 'new-tree-sha' }, commit: { message: 'P17-B deterministic commit', committer: { date: '2026-09-25T12:00:01Z' } } } },
      { status: 200, body: { ref: 'refs/heads/main', object: { sha: 'new-commit-sha', type: 'commit' } } },
    ]);
    const outcome = await provider.commitFiles({
      repository: REPO,
      branch: 'main',
      message: 'P17-B deterministic commit',
      files: [{ path: 'evidence.md', contents: '# deterministic\n' }],
    });
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result.sha).toBe('new-commit-sha');
      expect(outcome.result.branch).toBe('main');
      expect(outcome.result.message).toBe('P17-B deterministic commit');
      // committed_at carries the REAL provider committer date (documented adapter decision).
      expect(outcome.result.committed_at).toBe('2026-09-25T12:00:01Z');
    }
    // The exact Git Data API walk, in order.
    expect(requestOf(port, 0).path).toBe('/repos/payswapdotorg/sos-connectivity-scratch/branches');
    expect(requestOf(port, 1).path).toBe(`/repos/payswapdotorg/sos-connectivity-scratch/git/ref/heads/main`);
    expect(requestOf(port, 2).path).toBe(`/repos/payswapdotorg/sos-connectivity-scratch/git/commits/${HEAD_SHA}`);
    expect(requestOf(port, 3)).toMatchObject({ method: 'POST', path: '/repos/payswapdotorg/sos-connectivity-scratch/git/blobs' });
    expect(requestOf(port, 3).body).toEqual({ content: 'IyBkZXRlcm1pbmlzdGljCg==', encoding: 'base64' });
    expect(requestOf(port, 4).body).toEqual({
      base_tree: 'base-tree-sha',
      tree: [{ path: 'evidence.md', mode: '100644', type: 'blob', sha: 'blob-sha-1' }],
    });
    expect(requestOf(port, 5).body).toEqual({ message: 'P17-B deterministic commit', tree: 'new-tree-sha', parents: [HEAD_SHA] });
    expect(requestOf(port, 6)).toMatchObject({ method: 'PATCH', path: '/repos/payswapdotorg/sos-connectivity-scratch/git/refs/heads/main' });
  });

  it('commitFiles on an EMPTY repository uses the contents-API initial-commit path (the first branch)', async () => {
    const { provider, port } = scriptedProvider([
      { status: 200, body: [] },
      { status: 201, body: { commit: { sha: 'initial-commit-sha', tree: { sha: 't' }, commit: { message: 'initial', committer: { date: '2026-09-25T12:00:00Z' } } } } },
    ]);
    const outcome = await provider.commitFiles({
      repository: REPO,
      branch: 'main',
      message: 'P17-B initial commit',
      files: [{ path: 'README.md', contents: '# scratch\n' }],
    });
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result.sha).toBe('initial-commit-sha');
      expect(outcome.result.branch).toBe('main');
      expect(outcome.result.message).toBe('P17-B initial commit');
    }
    const request = requestOf(port, 1);
    expect(request.method).toBe('PUT');
    expect(request.path).toBe('/repos/payswapdotorg/sos-connectivity-scratch/contents/README.md');
    expect(request.body).toEqual({
      message: 'P17-B initial commit',
      content: Buffer.from('# scratch\n', 'utf8').toString('base64'),
      branch: 'main',
    });
  });

  it('createPullRequest POSTs the exact pulls body and maps the PR record', async () => {
    const { provider, port } = scriptedProvider([
      {
        status: 201,
        body: {
          number: 7,
          title: 'P17-B connectivity probe',
          state: 'open',
          head: { ref: 'wo/p17b-probe', sha: 'new-commit-sha' },
          base: { ref: 'main' },
          html_url: 'https://github.com/payswapdotorg/sos-connectivity-scratch/pull/7',
        },
      },
    ]);
    const outcome = await provider.createPullRequest({
      repository: REPO,
      title: 'P17-B connectivity probe',
      head_branch: 'wo/p17b-probe',
      base_branch: 'main',
      body: 'deterministic probe',
    });
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result).toEqual({
        repository: REPO,
        number: 7,
        title: 'P17-B connectivity probe',
        head_branch: 'wo/p17b-probe',
        base_branch: 'main',
        head_sha: 'new-commit-sha',
        state: 'open',
        url: 'https://github.com/payswapdotorg/sos-connectivity-scratch/pull/7',
      });
    }
    const request = requestOf(port, 0);
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/repos/payswapdotorg/sos-connectivity-scratch/pulls');
    expect(request.body).toEqual({
      title: 'P17-B connectivity probe',
      head: 'wo/p17b-probe',
      base: 'main',
      body: 'deterministic probe',
    });
  });

  it('registerWebhook POSTs the exact hooks body and maps the registration', async () => {
    const { provider, port } = scriptedProvider([
      { status: 201, body: { id: 424242, active: true, events: ['push'], config: { url: 'https://sos.invalid/hooks/github' } } },
    ]);
    const outcome = await provider.registerWebhook({
      repository: REPO,
      url: 'https://sos.invalid/hooks/github',
      events: ['push'],
    });
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result).toEqual({
        webhook_id: '424242',
        repository: REPO,
        url: 'https://sos.invalid/hooks/github',
        events: ['push'],
        active: true,
      });
    }
    expect(requestOf(port, 0).body).toEqual({
      name: 'web',
      config: { url: 'https://sos.invalid/hooks/github' },
      events: ['push'],
      active: true,
    });
  });
});

describe('honest error mapping (never a fabricated success)', () => {
  it('a rate-limited operation carries the REAL reset epoch in the typed refusal', async () => {
    const { provider } = scriptedProvider([
      { status: 403, body: { message: 'API rate limit exceeded' }, rateLimit: { limit: 5000, remaining: 0, used: 5000, reset: 1790001200 } },
    ]);
    const outcome = await provider.listBranches(REPO);
    expect(outcome.status).toBe('UNSUPPORTED');
    if (outcome.status === 'UNSUPPORTED') {
      expect(outcome.reason).toContain('rate limited');
      expect(outcome.reason).toContain('1790001200');
      expect(outcome.reason).toContain('DEGRADED');
    }
  });

  it('a provider 5xx answers the typed refusal with the truthful status', async () => {
    const { provider } = scriptedProvider([{ status: 503, body: { message: 'Service Unavailable' } }]);
    const outcome = await provider.discoverRepositories();
    expect(outcome.status).toBe('UNSUPPORTED');
    if (outcome.status === 'UNSUPPORTED') {
      expect(outcome.capability).toBe('repository-discovery');
      expect(outcome.reason).toContain('503');
    }
  });

  it('a missing branch answers the typed revision-selection refusal', async () => {
    const { provider } = scriptedProvider([
      { status: 200, body: { name: REPO.name, owner: { login: REPO.owner }, private: true, description: null, default_branch: 'main', size: 8, pushed_at: null } },
      { status: 200, body: [{ name: 'main', commit: { sha: HEAD_SHA }, protected: false }] },
      { status: 404, body: { message: 'Not Found' } },
    ]);
    const outcome = await provider.getRepositorySnapshot(REPO, { branch: 'missing-branch' }, NOW);
    expect(outcome.status).toBe('UNSUPPORTED');
    if (outcome.status === 'UNSUPPORTED') {
      expect(outcome.capability).toBe('revision-selection');
      expect(outcome.reason).toContain('missing-branch');
    }
  });

  it('a 422 (GitHub refused the write) answers the typed refusal with the provider message', async () => {
    const { provider } = scriptedProvider([
      { status: 422, body: { message: 'Reference already exists' } },
    ]);
    const outcome = await provider.createBranch({ repository: REPO, name: 'wo/p17b-probe', from_sha: HEAD_SHA });
    expect(outcome.status).toBe('UNSUPPORTED');
    if (outcome.status === 'UNSUPPORTED') {
      expect(outcome.reason).toContain('422');
      expect(outcome.reason).toContain('Reference already exists');
    }
  });
});

describe('the secret redaction discipline (the credential never appears)', () => {
  const TOKEN = 'ghp_SECRET-never-echo-anywhere-0123456789';

  it('the real fetch transport injects the Authorization header and never leaks the token anywhere', async () => {
    const fetch = new ScriptedFetch([
      { status: 200, body: JSON.stringify({ login: 'payswapdotorg' }), headers: { 'x-oauth-scopes': 'repo', 'x-github-api-version-selected': '2022-11-28' } },
    ]);
    const port = new FetchGitHubRequestPort({ token: TOKEN, fetchImpl: fetch.asFetchImpl(), baseUrl: 'https://api.github.com' });
    const provider = createRealGitHubProvider({ requestPort: port, credentialEnv: 'PAYSWAP_GITHUB_TOKEN' });
    await provider.verifyToken(NOW);
    // The credential IS in the outgoing request (correct injection)...
    expect(fetch.requests[0]?.headers['authorization']).toBe(`Bearer ${TOKEN}`);
    expect(fetch.requests[0]?.url).toBe('https://api.github.com/user');
    expect(fetch.requests[0]?.headers['x-github-api-version']).toBe('2022-11-28');
    // ...and NEVER in any honest surface the adapter produces.
    const telemetry = port.telemetry();
    expect(JSON.stringify(telemetry)).not.toContain(TOKEN);
    expect(JSON.stringify(provider.providerState())).not.toContain(TOKEN);
    expect(JSON.stringify(provider.connection())).not.toContain(TOKEN);
    expect(JSON.stringify(port.recordedRequests())).not.toContain(TOKEN);
  });

  it('a network failure surfaces as the honest status-0 fact (UNAVAILABLE, never a fabricated success)', async () => {
    const failingFetch = (async () => {
      throw new Error('deterministic offline failure');
    }) as unknown as typeof fetch;
    const port = new FetchGitHubRequestPort({ token: TOKEN, fetchImpl: failingFetch });
    const provider = createRealGitHubProvider({ requestPort: port, credentialEnv: 'PAYSWAP_GITHUB_TOKEN' });
    const verification = await provider.verifyToken(NOW);
    expect(verification.verified).toBe(false);
    expect(verification.failure).toContain('network failure');
    expect(provider.providerState().state).toBe('UNAVAILABLE');
    const outcome = await provider.discoverRepositories();
    expect(outcome.status).toBe('UNSUPPORTED');
    if (outcome.status === 'UNSUPPORTED') {
      expect(outcome.reason).toContain('HTTP 0');
    }
  });

  it('an empty token fails closed (a fabricated anonymous session is never constructed)', () => {
    expect(() => new FetchGitHubRequestPort({ token: '' })).toThrow('fail closed');
  });
});
