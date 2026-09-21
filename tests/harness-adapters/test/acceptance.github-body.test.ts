/**
 * ACCEPTANCE (Work Order P8): the GITHUB-AWARE PROJECT BODY — repository
 * operations as typed records through the P4 provider-neutral github
 * adapter vocabulary, honest NOT_YET_CONNECTED without credentials, and
 * the field-for-field P4 vocabulary alignment (the body-runtimes
 * structural vocabulary vs the REAL P4 package sources, pinned by test).
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { acceptanceWorld, SECRET_TOKEN_VALUE } from './acceptance-world.js';
import {
  GITHUB_CONNECTION_STATUSES,
  GITHUB_CONNECTION_SCOPES,
  GITHUB_ONBOARDING_WRITE_SCOPES,
  repositorySlug,
} from '@sos-2/body-runtimes';

/** The structural shape of the real P4 github module surface this suite pins (runtime-typed, not tsc-typed). */
interface P4GithubModule {
  readonly GITHUB_CONNECTION_STATUSES: readonly string[];
  readonly GITHUB_CONNECTION_SCOPES: readonly string[];
  readonly GITHUB_ONBOARDING_WRITE_SCOPES: readonly string[];
  repositorySlug(id: { owner: string; name: string }): string;
  createInMemoryGitHubProvider(): {
    connection(): Record<string, unknown> & { status: string };
    createBranch(input: { repository: { owner: string; name: string }; name: string; from_sha: string }): Promise<{ status: string; result?: Record<string, unknown> }>;
    commitFiles(input: { repository: { owner: string; name: string }; branch: string; message: string; files: { path: string; contents: string }[] }): Promise<{ status: string; result?: Record<string, unknown> }>;
    createPullRequest(input: { repository: { owner: string; name: string }; title: string; head_branch: string; base_branch: string; body: string | null }): Promise<{ status: string; result?: Record<string, unknown> }>;
  };
}

const REPOSITORY_STEPS = [
  { kind: 'workspace.write', path: 'src/checkout.ts', content: 'export const checkout = 2;\n' },
  { kind: 'git.createBranch', name: 'feature/checkout-v2', from_ref: null },
  { kind: 'git.commit', message: 'feat: checkout v2', paths: [] },
  { kind: 'git.push', remote: 'origin', ref: 'feature/checkout-v2' },
  { kind: 'git.createPullRequest', title: 'feat: checkout v2', source_branch: 'feature/checkout-v2', target_branch: 'main' },
] as const;

describe('acceptance: the GitHub-aware project body', () => {
  it('executes the connected repository journey as typed records behind the broker', async () => {
    const world = acceptanceWorld();
    const { operations } = world.registerGitHubBody({ connected: true });
    const task = await world.createTask({
      task_id: 'task-github-journey-0001',
      requirements: { requiredCapabilities: ['filesystem', 'repository-operations'], placement: 'cloud' },
    });
    expect(task.status).toBe('RUNNING');

    for (const step of REPOSITORY_STEPS) {
      const result = await world.fabric.execute('task-github-journey-0001', step);
      expect(result.status).toBe('EXECUTED');
      if (result.status === 'EXECUTED') {
        expect(result.availability).toBe('SUCCESS');
      }
    }

    // The typed records landed: the provider branch moved to the commit sha,
    // and the durable task carries the journey's observations + artifact.
    const branch = operations.branchState().find((entry) => entry.name === 'feature/checkout-v2');
    expect(branch).toBeDefined();
    expect(branch?.head_sha).toMatch(/^[0-9a-f]{40}$/);
    const prOutcome = await world.fabric.execute('task-github-journey-0001', {
      kind: 'observations.emit',
      observation_kind: 'body.progress',
      payload: { stage: 'pr-opened' },
    });
    expect(prOutcome.status).toBe('EXECUTED');

    const completion = await world.fabric.completeTask('task-github-journey-0001', {
      verified: true,
      recorded_at: '2026-01-15T10:00:00Z',
      evidence_refs: [],
      summary: 'repository journey completed through the provider-neutral typed records',
    });
    expect(completion.status).toBe('TRANSITIONED');
    const lease = await world.store.bodyLeases.get('lease:task-github-journey-0001:0001');
    expect(lease?.state).toBe('RELEASED');
  });

  it('fails provider-backed write operations honestly while NOT_YET_CONNECTED (never fabricated)', async () => {
    const world = acceptanceWorld();
    const { body } = world.registerGitHubBody({ connected: false });
    await world.createTask({
      task_id: 'task-github-unc-0001',
      requirements: { requiredCapabilities: ['filesystem', 'repository-operations'], placement: 'cloud' },
    });
    // The honest advertisement: the github integration surface is NOT available.
    const integration = body.capabilitiesValue.runtimeIntegrations[0];
    expect(integration?.integrations[0]?.available).toBe(false);

    await world.fabric.execute('task-github-unc-0001', { kind: 'workspace.write', path: 'src/x.ts', content: 'x' });
    const commit = await world.fabric.execute('task-github-unc-0001', { kind: 'git.commit', message: 'm', paths: [] });
    expect(commit.status).toBe('EXECUTED');
    if (commit.status === 'EXECUTED') {
      expect(commit.availability).toBe('FAILURE');
      expect(commit.error).toContain('NOT_YET_CONNECTED');
    }
    for (const step of [
      { kind: 'git.createBranch', name: 'x/y', from_ref: null },
      { kind: 'git.push', remote: 'origin', ref: 'main' },
      { kind: 'git.createPullRequest', title: 't', source_branch: 'a', target_branch: 'b' },
    ] as const) {
      const result = await world.fabric.execute('task-github-unc-0001', step);
      expect(result.status === 'EXECUTED' && result.availability).toBe('FAILURE');
      if (result.status === 'EXECUTED' && result.error) {
        expect(result.error).toContain('NOT_YET_CONNECTED');
      }
    }
    // Body-side status/diff still answer honestly (the staging view).
    const status = await world.fabric.execute('task-github-unc-0001', { kind: 'git.status' });
    expect(status.status === 'EXECUTED' && status.availability).toBe('SUCCESS');
  });

  it('never echoes the credential value across the full connected journey (output scan)', async () => {
    const world = acceptanceWorld();
    world.registerGitHubBody({ connected: true, credentialName: 'github-token' });
    await world.createTask({
      task_id: 'task-github-secrets-0001',
      requirements: { requiredCapabilities: ['filesystem', 'repository-operations'], placement: 'cloud' },
    });
    const outputs: string[] = [];
    for (const step of REPOSITORY_STEPS) {
      outputs.push(JSON.stringify(await world.fabric.execute('task-github-secrets-0001', step)));
    }
    const events = await world.store.observationEvents.list({ limit: null });
    for (const event of events.items) {
      outputs.push(JSON.stringify(event));
    }
    outputs.push(JSON.stringify(await world.store.tasks.get('task-github-secrets-0001')));
    for (const output of outputs) {
      expect(output).not.toContain(SECRET_TOKEN_VALUE);
    }
  });
});

describe('acceptance: the P4 github vocabulary alignment (structural, pinned by test)', () => {
  /**
   * The body-runtimes github vocabulary is carried STRUCTURALLY (the P4
   * package is a frozen zero-dependency, no-build package — the
   * web-contracts/onboarding precedent). This suite imports the REAL P4
   * package sources through a non-literal dynamic import (vitest
   * transforms them; the tsc build never sees the specifier) and pins
   * field-for-field compatibility: the status/scope vocabularies are
   * deep-equal, the slug function behaves identically, and the P4
   * reference provider's typed records (BranchRef / CommitRef /
   * PullRequestRef / GitHubConnectionState) carry exactly the field sets
   * the body-runtimes structural vocabulary declares.
   */
  it('the vocabularies are field-for-field compatible with the real P4 package sources', async () => {
    // Non-literal specifier: resolved by vitest at runtime, invisible to tsc.
    const githubUrl = join(import.meta.dirname, '..', '..', '..', 'packages', 'github', 'src', 'index.ts');
    const github = (await import(/* @vite-ignore */ githubUrl)) as unknown as P4GithubModule;

    expect([...github.GITHUB_CONNECTION_STATUSES]).toEqual([...GITHUB_CONNECTION_STATUSES]);
    expect([...github.GITHUB_CONNECTION_SCOPES]).toEqual([...GITHUB_CONNECTION_SCOPES]);
    expect([...github.GITHUB_ONBOARDING_WRITE_SCOPES]).toEqual([...GITHUB_ONBOARDING_WRITE_SCOPES]);
    expect(github.repositorySlug({ owner: 'acme', name: 'legacy-checkout' })).toBe(repositorySlug({ owner: 'acme', name: 'legacy-checkout' }));

    // The P4 reference provider's typed records carry exactly the
    // field sets the structural vocabulary declares.
    const provider = github.createInMemoryGitHubProvider();
    const repository = { owner: 'acme', name: 'legacy-checkout' };
    const connection = provider.connection();
    expect(Object.keys(connection).sort()).toEqual(['connected_at', 'granted_scopes', 'note', 'provider_id', 'simulated', 'status'].sort());
    expect(connection.status).toBe('NOT_YET_CONNECTED');

    const branch = await provider.createBranch({ repository, name: 'align/branch', from_sha: 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7' });
    expect(branch.status).toBe('OK');
    if (branch.status === 'OK' && branch.result !== undefined) {
      expect(Object.keys(branch.result).sort()).toEqual(['head_sha', 'is_protected', 'name'].sort());
    }
    const commit = await provider.commitFiles({
      repository,
      branch: 'align/branch',
      message: 'alignment',
      files: [{ path: 'a.ts', contents: 'a' }],
    });
    expect(commit.status).toBe('OK');
    if (commit.status === 'OK' && commit.result !== undefined) {
      expect(Object.keys(commit.result).sort()).toEqual(['branch', 'committed_at', 'message', 'repository', 'sha'].sort());
    }
    const pullRequest = await provider.createPullRequest({
      repository,
      title: 'alignment pr',
      head_branch: 'align/branch',
      base_branch: 'main',
      body: null,
    });
    expect(pullRequest.status).toBe('OK');
    if (pullRequest.status === 'OK' && pullRequest.result !== undefined) {
      expect(Object.keys(pullRequest.result).sort()).toEqual(
        ['base_branch', 'head_branch', 'head_sha', 'number', 'repository', 'state', 'title', 'url'].sort(),
      );
    }
  });
});
