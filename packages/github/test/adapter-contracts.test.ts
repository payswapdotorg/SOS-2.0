/**
 * The GitHub adapter contract tests (Work Order P4): discovery,
 * empty-repository detection, branch/revision selection, snapshot
 * import, webhook registration (where supported) and the typed
 * capability surface — with the in-memory reference provider and the
 * transport-backed provider over a scripted request port. Unsupported
 * operations answer EXPLICIT typed UNSUPPORTED outcomes, never silent
 * failures (pinned).
 */

import {
  GITHUB_CAPABILITIES,
  GITHUB_ONBOARDING_READ_SCOPES,
  GITHUB_REFERENCE_PROVIDER_ID,
  InMemoryGitHubProvider,
  capabilityLabel,
  createInMemoryGitHubProvider,
  createRequestPortGitHubProvider,
  repositorySlug,
} from '../src/index.ts';
import type { GitHubRequestPort } from '../src/index.ts';

const NOW = '2025-06-15T12:00:00Z';

describe('the capability surface', () => {
  test('the reference provider supports every capability and reports the unsupported remainder explicitly', () => {
    const provider = createInMemoryGitHubProvider();
    const surface = provider.capabilities();
    expect(surface.provider_id).toBe(GITHUB_REFERENCE_PROVIDER_ID);
    expect([...surface.supported]).toEqual([...GITHUB_CAPABILITIES]);
    expect(surface.unsupported).toEqual([]);
  });

  test('a reduced-capability provider reports its unsupported set explicitly (never silent)', () => {
    const provider = createInMemoryGitHubProvider({
      supportedCapabilities: ['repository-discovery', 'empty-repository-detection'],
    });
    const surface = provider.capabilities();
    expect(surface.supported).toEqual(['repository-discovery', 'empty-repository-detection']);
    expect(surface.unsupported).toContain('webhook-registration');
    expect(surface.unsupported).toContain('commit-operations');
    expect(capabilityLabel('webhook-registration')).toBe('Webhook registration (where supported)');
  });

  test('a malformed capability surface is rejected (fail-closed)', () => {
    expect(() =>
      createInMemoryGitHubProvider({
        // @ts-expect-error deliberately malformed input
        supportedCapabilities: ['not-a-capability'],
      }),
    ).toThrow(/unknown capability/);
  });
});

describe('repository discovery + empty-repository detection (reference provider)', () => {
  test('discovery lists the fixture repositories with empty detection', async () => {
    const provider = createInMemoryGitHubProvider();
    const outcome = await provider.discoverRepositories();
    expect(outcome.status).toBe('OK');
    if (outcome.status !== 'OK') {
      throw new Error('unreachable');
    }
    const slugs = outcome.result.map((repository) => repositorySlug(repository.id));
    expect(slugs).toEqual(['acme/legacy-checkout', 'acme/empty-repo', 'acme/archived-docs']);
    const empty = outcome.result.find((repository) => repository.id.name === 'empty-repo');
    expect(empty?.is_empty).toBe(true);
    expect(empty?.default_branch).toBeNull();
    expect(empty?.pushed_at).toBeNull();
    const legacy = outcome.result.find((repository) => repository.id.name === 'legacy-checkout');
    expect(legacy?.is_empty).toBe(false);
    expect(legacy?.default_branch).toBe('main');
  });

  test('discovery on a provider without the capability is a typed UNSUPPORTED, never a silent failure', async () => {
    const provider = createInMemoryGitHubProvider({ supportedCapabilities: ['connection'] });
    const outcome = await provider.discoverRepositories();
    expect(outcome.status).toBe('UNSUPPORTED');
    if (outcome.status === 'UNSUPPORTED') {
      expect(outcome.capability).toBe('repository-discovery');
      expect(outcome.provider_id).toBe(GITHUB_REFERENCE_PROVIDER_ID);
      expect(outcome.reason).toContain('without repository discovery');
    }
  });
});

describe('branch + revision selection and snapshot import (reference provider)', () => {
  test('branch listing returns the exact fixture heads', async () => {
    const provider = createInMemoryGitHubProvider();
    const outcome = await provider.listBranches({ owner: 'acme', name: 'legacy-checkout' });
    expect(outcome.status).toBe('OK');
    if (outcome.status !== 'OK') {
      throw new Error('unreachable');
    }
    expect(outcome.result.map((branch) => branch.name)).toEqual(['main', 'release/1.2', 'feature/beta-optin']);
    expect(outcome.result[0]?.head_sha).toBe('c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7');
    expect(outcome.result[0]?.is_protected).toBe(true);
  });

  test('a snapshot captures the default branch head with the imported metadata', async () => {
    const provider = createInMemoryGitHubProvider();
    const outcome = await provider.getRepositorySnapshot({ owner: 'acme', name: 'legacy-checkout' }, {}, NOW);
    expect(outcome.status).toBe('OK');
    if (outcome.status !== 'OK') {
      throw new Error('unreachable');
    }
    expect(outcome.result.ref).toEqual({ branch: 'main', sha: 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7' });
    expect(outcome.result.is_empty).toBe(false);
    expect(outcome.result.captured_at).toBe(NOW);
    expect(outcome.result.file_count).toBe(5);
    expect(outcome.result.tree.map((entry) => entry.path)).toContain('src/checkout.ts');
  });

  test('an explicit branch + sha selection pins the exact revision', async () => {
    const provider = createInMemoryGitHubProvider();
    const outcome = await provider.getRepositorySnapshot(
      { owner: 'acme', name: 'legacy-checkout' },
      { branch: 'release/1.2', sha: 'dead00beef1234567890abcdef0123456789abcd' },
      NOW,
    );
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result.ref).toEqual({ branch: 'release/1.2', sha: 'dead00beef1234567890abcdef0123456789abcd' });
    }
  });

  test('an empty repository snapshot is honestly empty (detection carried through)', async () => {
    const provider = createInMemoryGitHubProvider();
    const outcome = await provider.getRepositorySnapshot({ owner: 'acme', name: 'empty-repo' }, {}, NOW);
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result.is_empty).toBe(true);
      expect(outcome.result.tree).toEqual([]);
      expect(outcome.result.file_count).toBe(0);
      expect(outcome.result.default_branch).toBeNull();
    }
  });

  test('selecting a branch on an EMPTY repository is a typed UNSUPPORTED (empty-repository detection)', async () => {
    const provider = createInMemoryGitHubProvider();
    const outcome = await provider.getRepositorySnapshot({ owner: 'acme', name: 'empty-repo' }, { branch: 'main' }, NOW);
    expect(outcome.status).toBe('UNSUPPORTED');
    if (outcome.status === 'UNSUPPORTED') {
      expect(outcome.capability).toBe('revision-selection');
      expect(outcome.reason).toContain('empty');
    }
  });

  test('an unknown branch or revision is a typed UNSUPPORTED', async () => {
    const provider = createInMemoryGitHubProvider();
    const branchOutcome = await provider.getRepositorySnapshot({ owner: 'acme', name: 'legacy-checkout' }, { branch: 'nope' }, NOW);
    expect(branchOutcome.status).toBe('UNSUPPORTED');
    const shaOutcome = await provider.getRepositorySnapshot({ owner: 'acme', name: 'legacy-checkout' }, { sha: 'f'.repeat(40) }, NOW);
    expect(shaOutcome.status).toBe('UNSUPPORTED');
  });

  test('importSnapshot returns the exact repository identity/revision link (the System State shape)', async () => {
    const provider = createInMemoryGitHubProvider();
    const snapshot = await provider.getRepositorySnapshot({ owner: 'acme', name: 'legacy-checkout' }, {}, NOW);
    if (snapshot.status !== 'OK') {
      throw new Error('unreachable');
    }
    const imported = provider.importSnapshot(snapshot.result);
    expect(imported).toEqual({
      repository: { owner: 'acme', name: 'legacy-checkout' },
      branch: 'main',
      revision: { kind: 'git-sha', value: 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7' },
    });
  });
});

describe('webhook registration (where supported)', () => {
  test('a supported repository registers its webhook deterministically', async () => {
    const provider = createInMemoryGitHubProvider();
    const outcome = await provider.registerWebhook({
      repository: { owner: 'acme', name: 'legacy-checkout' },
      url: 'https://example.invalid/hooks/sos',
      events: ['push', 'pull_request'],
    });
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result.webhook_id).toBe('ref-hook-41');
      expect(outcome.result.events).toEqual(['push', 'pull_request']);
      expect(outcome.result.active).toBe(true);
    }
  });

  test('a repository without webhook support answers a typed UNSUPPORTED — never a silent failure', async () => {
    const provider = createInMemoryGitHubProvider();
    const outcome = await provider.registerWebhook({
      repository: { owner: 'acme', name: 'archived-docs' },
      url: 'https://example.invalid/hooks/sos',
      events: ['push'],
    });
    expect(outcome.status).toBe('UNSUPPORTED');
    if (outcome.status === 'UNSUPPORTED') {
      expect(outcome.capability).toBe('webhook-registration');
      expect(outcome.reason).toContain('does not support webhook registration');
    }
  });
});

describe('the simulated connection contract (never a real connection)', () => {
  test('the reference provider starts NOT_YET_CONNECTED and its handshake is explicitly simulated', () => {
    const provider = createInMemoryGitHubProvider();
    expect(provider.connection()).toMatchObject({ status: 'NOT_YET_CONNECTED', simulated: true });
    const authorization = provider.beginConnection({ scopes: GITHUB_ONBOARDING_READ_SCOPES, state_token: 'st4te' });
    expect(authorization.simulated).toBe(true);
    expect(authorization.authorization_url).toContain('simulated.github.invalid');
    const completion = provider.completeConnection({ authorization_ref: authorization.authorization_ref, authorization_code: 'simulated-code', completed_at: NOW });
    expect(completion.status).toBe('CONNECTED');
    if (completion.status === 'CONNECTED') {
      expect(completion.connection.simulated).toBe(true);
      expect(completion.connection.granted_scopes).toEqual([...GITHUB_ONBOARDING_READ_SCOPES]);
      expect(completion.connection.connected_at).toBe(NOW);
    }
  });

  test('an empty authorization code is a typed REFUSED (fail-closed)', () => {
    const provider = createInMemoryGitHubProvider();
    const result = provider.completeConnection({ authorization_ref: 'ref', authorization_code: '', completed_at: NOW });
    expect(result.status).toBe('REFUSED');
  });

  test('the transport provider never fabricates a connection: NOT_YET_CONNECTED + REFUSED handshake', () => {
    const provider = createRequestPortGitHubProvider({
      requestPort: { request: async () => ({ status: 200, body: null }) },
    });
    expect(provider.connection()).toMatchObject({ status: 'NOT_YET_CONNECTED', simulated: false });
    const result = provider.completeConnection({ authorization_ref: 'ref', authorization_code: 'anything', completed_at: NOW });
    expect(result.status).toBe('REFUSED');
    expect(provider.beginConnection({ scopes: [], state_token: 'x' }).note).toContain('fabricated');
  });
});

describe('the transport-backed provider over an injected scripted request port', () => {
  function scriptedPort(responses: Record<string, { status: number; body: unknown }>): GitHubRequestPort & { requests: unknown[] } {
    const requests: unknown[] = [];
    const port: GitHubRequestPort & { requests: unknown[] } = {
      requests,
      async request(request) {
        requests.push(request);
        const response = responses[request.path];
        if (response === undefined) {
          return { status: 404, body: null };
        }
        return { status: response.status, body: response.body } as { status: number; body: never };
      },
    };
    return port;
  }

  test('discovery maps the provider-neutral request onto the port and decodes the response', async () => {
    const port = scriptedPort({
      '/repositories': {
        status: 200,
        body: [
          { owner: 'octo', name: 'app', visibility: 'public', description: null, default_branch: 'main', is_empty: false, webhooks_supported: true, pushed_at: '2025-06-01T00:00:00Z' },
        ],
      },
    });
    const provider = createRequestPortGitHubProvider({ requestPort: port });
    const outcome = await provider.discoverRepositories();
    expect(outcome.status).toBe('OK');
    if (outcome.status === 'OK') {
      expect(outcome.result[0]?.id).toEqual({ owner: 'octo', name: 'app' });
      expect(outcome.result[0]?.is_empty).toBe(false);
    }
    expect(port.requests[0]).toMatchObject({ method: 'GET', path: '/repositories' });
  });

  test('a port failure is an honest typed UNSUPPORTED, never a fabricated list', async () => {
    const port = scriptedPort({});
    const provider = createRequestPortGitHubProvider({ requestPort: port });
    const outcome = await provider.discoverRepositories();
    expect(outcome.status).toBe('UNSUPPORTED');
    if (outcome.status === 'UNSUPPORTED') {
      expect(outcome.reason).toContain('status 404');
    }
  });

  test('write operations are typed UNSUPPORTED on the transport provider until the vendor-backed implementation lands', async () => {
    const provider = createRequestPortGitHubProvider({ requestPort: scriptedPort({}) });
    const branch = await provider.createBranch({ repository: { owner: 'o', name: 'r' }, name: 'x', from_sha: 'a'.repeat(40) });
    expect(branch.status).toBe('UNSUPPORTED');
    const commit = await provider.commitFiles({ repository: { owner: 'o', name: 'r' }, branch: 'main', message: 'm', files: [] });
    expect(commit.status).toBe('UNSUPPORTED');
    const pr = await provider.createPullRequest({ repository: { owner: 'o', name: 'r' }, title: 't', head_branch: 'h', base_branch: 'b', body: null });
    expect(pr.status).toBe('UNSUPPORTED');
    const hook = await provider.registerWebhook({ repository: { owner: 'o', name: 'r' }, url: 'https://x.invalid', events: ['push'] });
    expect(hook.status).toBe('UNSUPPORTED');
  });
});

describe('the write path on the reference provider (branch/commit/PR, deterministically)', () => {
  test('an initial commit on an EMPTY repository creates the first branch (the greenfield flagship path)', async () => {
    const provider = createInMemoryGitHubProvider();
    const commit = await provider.commitFiles({
      repository: { owner: 'acme', name: 'empty-repo' },
      branch: 'main',
      message: 'Mission marker: the initial commit',
      files: [{ path: 'SOS-MISSION.md', contents: '# mission' }],
    });
    expect(commit.status).toBe('OK');
    if (commit.status === 'OK') {
      expect(commit.result.branch).toBe('main');
      expect(commit.result.sha).toMatch(/^[0-9a-f]{40}$/);
    }
    const snapshot = await provider.getRepositorySnapshot({ owner: 'acme', name: 'empty-repo' }, {}, NOW);
    expect(snapshot.status).toBe('OK');
    if (snapshot.status === 'OK') {
      expect(snapshot.result.is_empty).toBe(false);
      expect(snapshot.result.ref.branch).toBe('main');
      expect(snapshot.result.file_count).toBe(1);
    }
  });

  test('branch creation + commit + pull request compose deterministically', async () => {
    const provider = createInMemoryGitHubProvider();
    const branch = await provider.createBranch({ repository: { owner: 'acme', name: 'legacy-checkout' }, name: 'sos/mission', from_sha: 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7' });
    expect(branch.status).toBe('OK');
    const commit = await provider.commitFiles({
      repository: { owner: 'acme', name: 'legacy-checkout' },
      branch: 'sos/mission',
      message: 'Link the mission',
      files: [{ path: 'SOS-MISSION.md', contents: '# linked' }],
    });
    expect(commit.status).toBe('OK');
    const pr = await provider.createPullRequest({
      repository: { owner: 'acme', name: 'legacy-checkout' },
      title: 'Link the mission',
      head_branch: 'sos/mission',
      base_branch: 'main',
      body: 'From the onboarding journey',
    });
    expect(pr.status).toBe('OK');
    if (pr.status === 'OK') {
      expect(pr.result.number).toBe(3);
      expect(pr.result.url).toContain('simulated.github.invalid');
    }
  });
});

describe('determinism of the reference provider', () => {
  test('two fresh providers produce identical discovery results (fixtures are static)', async () => {
    const first = await createInMemoryGitHubProvider().discoverRepositories();
    const second = await createInMemoryGitHubProvider().discoverRepositories();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test('the constructor class is exported for direct construction (parity with the factory)', () => {
    const provider = new InMemoryGitHubProvider({});
    expect(provider.descriptor.adapter_contract).toBe('ProjectAdapter');
  });
});
