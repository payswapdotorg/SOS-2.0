/**
 * The REAL-PROVIDER INTEGRATION SUITE of the real GitHub adapter
 * (Work Order P17-B) — env-gated (RUN_REAL=1 AND PAYSWAP_GITHUB_TOKEN),
 * default OFF, strictly separated from the deterministic suite.
 *
 * The journey (REAL authenticated operations through the frozen
 * GitHubPort surface):
 *
 *   PAT-backed real handshake (verifyToken probes GET /user)
 *     -> provider state CONNECTED (login, API revision, rate limit)
 *     -> create the PRIVATE scratch repository
 *        payswapdotorg/sos-connectivity-scratch
 *     -> discover it (empty detection)
 *     -> initial commit through the contents-API path (first branch)
 *     -> snapshot import (exact SHA)
 *     -> create branch wo/p17b-connectivity-probe
 *     -> commit through the Git Data API single-commit path
 *     -> open a pull request
 *     -> read the PR state (open)
 *     -> close the PR (provider-side surface)
 *     -> delete the scratch repository (cleanup — recorded)
 *     -> machine-readable evidence with exact API revisions,
 *        timestamps, URLs, SHAs and provider states
 *
 * Credentials: env-only (PAYSWAP_GITHUB_TOKEN); the value NEVER appears
 * in evidence — env NAMES only. Honest outcomes: a failure fails this
 * suite truthfully (never a fabricated success).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FetchGitHubRequestPort,
  REAL_GITHUB_PROVIDER_ID,
  createRealGitHubProvider,
  resolveRealGitHubEnvironment,
} from '@sos-2/real-github';
import type { RealGitHubProvider } from '@sos-2/real-github';

const RUN_REAL = process.env['RUN_REAL'] === '1';
const EVIDENCE_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'evidence', 'production-connectivity', 'github-execution');
const EVIDENCE_FILE = join(EVIDENCE_DIR, 'github-integration.json');
const REPO = { owner: 'payswapdotorg', name: 'sos-connectivity-scratch' };
/** A unique per-run probe branch — resilient to an aborted earlier run (leftovers are removed by the repo deletion). */
const RUN_STAMP = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 17);
const BRANCH = `wo/p17b-connectivity-probe-${RUN_STAMP}`;
const INITIAL_FILE = { path: 'README.md', contents: '# sos-connectivity-scratch\n\nP17-B real GitHub connectivity evidence scratch repository (auto-cleanup).\n' };
const PROBE_FILE = { path: 'evidence/connectivity-probe.md', contents: '# P17-B real connectivity probe\n\nWritten by the SOS 2.0 real GitHub adapter through the frozen GitHubPort contract.\n' };

interface JourneyStep {
  readonly step: string;
  readonly ok: boolean;
  readonly at: string;
  readonly detail: Record<string, unknown>;
}

const suite = RUN_REAL ? describe : describe.skip;

suite('REAL GitHub integration (RUN_REAL=1): the scratch-repository journey through the frozen GitHubPort', () => {
  let provider: RealGitHubProvider;
  let transport: FetchGitHubRequestPort;
  const steps: JourneyStep[] = [];
  let pullRequestNumber: number | null = null;
  let repositoryDeleted = false;

  function record(step: string, ok: boolean, detail: Record<string, unknown>): void {
    steps.push({ step, ok, at: new Date().toISOString(), detail });
  }

  beforeAll(() => {
    // The composition boundary: the ambient environment is read HERE
    // (env-only, exactly once) and only the resolved value flows onward.
    const source: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        source[key] = value;
      }
    }
    const resolution = resolveRealGitHubEnvironment(source);
    expect(resolution.token, 'PAYSWAP_GITHUB_TOKEN must be set for the real integration suite').not.toBeNull();
    transport = new FetchGitHubRequestPort({ token: resolution.token });
    provider = createRealGitHubProvider({ requestPort: transport, credentialEnv: resolution.credential_env });
  });

  afterAll(() => {
    // Machine-readable evidence — real outcomes, exact revisions,
    // timestamps and URLs; credentials are env NAMES only.
    const login = provider === undefined ? null : (provider.providerState().login ?? null);
    const telemetry = transport === undefined ? null : transport.telemetry();
    const evidence = {
      schema: 'sos-2/p17b/github-integration',
      work_order: 'P17-B',
      provider_id: REAL_GITHUB_PROVIDER_ID,
      credential_env: 'PAYSWAP_GITHUB_TOKEN',
      credential_value_present: true,
      credential_redacted: true,
      provider_state: provider === undefined ? null : provider.providerState(),
      authenticated_login: login,
      api_revision: telemetry?.apiRevision ?? null,
      transport: telemetry === null ? null : { requests: telemetry.requests, last_status: telemetry.lastStatus },
      request_log: transport === undefined ? [] : transport.recordedRequests(),
      scratch_repository: REPO,
      cleanup: { strategy: 'delete', repository_deleted: repositoryDeleted },
      steps,
      honest_notes: [
        'OAuth app authorization surface: implemented (beginConnection builds the real github.com/login/oauth/authorize URL when a client id is bound); live operation in this program is PAT-backed — recorded honestly.',
        'committed_at carries the provider-reported committer date (real evidence, not a hidden clock).',
        'The scratch repository is deleted at journey end; the durable evidence is this transcript.',
      ],
    };
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
  });

  it('completes the real handshake (CONNECTED only after the authenticated /user probe)', async () => {
    const verification = await provider.verifyToken(new Date().toISOString());
    expect(verification.verified).toBe(true);
    record('verify-token', verification.verified, { login: verification.login, verified_at: verification.verified_at });
    const connection = provider.connection();
    expect(connection.status).toBe('CONNECTED');
    expect(connection.simulated).toBe(false);
    const state = provider.providerState();
    expect(state.state).toBe('CONNECTED');
    expect(state.login).toBe('payswapdotorg');
    expect(state.api_revision).not.toBeNull();
    record('provider-state', true, { state, connection_status: connection.status });
    const completed = provider.completeConnection({
      authorization_ref: verification.authorization_ref,
      authorization_code: 'PAT-backed',
      completed_at: verification.verified_at,
    });
    expect(completed.status).toBe('CONNECTED');
  });

  it('creates the PRIVATE scratch repository', async () => {
    const outcome = await provider.createRepository({
      name: REPO.name,
      private: true,
      description: 'SOS 2.0 P17-B real GitHub connectivity scratch (auto-cleanup evidence run)',
    });
    // 422 when it already exists from an earlier aborted run — the
    // journey continues on the existing repository either way.
    if (outcome.status === 'OK') {
      record('create-repository', true, { repository: outcome.result.id, visibility: outcome.result.visibility });
    } else {
      record('create-repository', false, { reason: outcome.reason, note: 'continuing on the existing repository (an earlier run may have left it)' });
    }
  });

  it('discovers the scratch repository with empty-repository detection', async () => {
    const outcome = await provider.discoverRepositories();
    expect(outcome.status).toBe('OK');
    if (outcome.status !== 'OK') {
      return;
    }
    const found = outcome.result.find((repo) => repo.id.owner === REPO.owner && repo.id.name === REPO.name);
    expect(found).toBeDefined();
    record('discover-repositories', true, {
      total_discovered: outcome.result.length,
      scratch: found,
    });
  });

  it('captures the EMPTY snapshot before the initial commit (empty-repository detection through the real branches probe)', async () => {
    const outcome = await provider.getRepositorySnapshot(REPO, {}, new Date().toISOString());
    expect(outcome.status).toBe('OK');
    if (outcome.status !== 'OK') {
      return;
    }
    if (!outcome.result.is_empty) {
      // An earlier aborted run left commits — honest continuation.
      record('empty-snapshot', false, { note: 'the repository already carries commits (an earlier run); the empty-detection path was exercised and reported honestly', snapshot: outcome.result });
      return;
    }
    expect(outcome.result.tree).toEqual([]);
    expect(outcome.result.file_count).toBe(0);
    record('empty-snapshot', true, { snapshot: outcome.result });
  });

  it('lands the initial commit (the contents-API path on a fresh repository; the Git Data path on a leftover)', async () => {
    const outcome = await provider.commitFiles({
      repository: REPO,
      branch: 'main',
      message: 'P17-B: scratch initial commit',
      files: [INITIAL_FILE],
    });
    expect(outcome.status).toBe('OK');
    if (outcome.status !== 'OK') {
      return;
    }
    record('initial-commit', true, { sha: outcome.result.sha, branch: outcome.result.branch, committed_at: outcome.result.committed_at });
  });

  it('imports the snapshot at the exact SHA (revision selection)', async () => {
    const snapshot = await provider.getRepositorySnapshot(REPO, { branch: 'main' }, new Date().toISOString());
    expect(snapshot.status).toBe('OK');
    if (snapshot.status !== 'OK') {
      return;
    }
    expect(snapshot.result.is_empty).toBe(false);
    expect(snapshot.result.ref.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.result.tree.some((entry) => entry.path === 'README.md')).toBe(true);
    const imported = provider.importSnapshot(snapshot.result);
    expect(imported.revision).toEqual({ kind: 'git-sha', value: snapshot.result.ref.sha });
    record('import-snapshot', true, {
      imported,
      file_count: snapshot.result.file_count,
      tree: snapshot.result.tree,
    });
  });

  it('creates the probe branch from the imported revision', async () => {
    const snapshot = await provider.getRepositorySnapshot(REPO, { branch: 'main' }, new Date().toISOString());
    expect(snapshot.status).toBe('OK');
    if (snapshot.status !== 'OK') {
      return;
    }
    const fromSha = snapshot.result.ref.sha;
    const outcome = await provider.createBranch({ repository: REPO, name: BRANCH, from_sha: fromSha });
    expect(outcome.status === 'OK' || (outcome.status === 'UNSUPPORTED' && outcome.reason.includes('already exists'))).toBe(true);
    record('create-branch', outcome.status === 'OK', {
      branch: BRANCH,
      from_sha: fromSha,
      status: outcome.status,
      reason: outcome.status === 'UNSUPPORTED' ? outcome.reason : null,
    });
  });

  it('commits through the Git Data API single-commit path (one CommitRef with the resulting sha)', async () => {
    const outcome = await provider.commitFiles({
      repository: REPO,
      branch: BRANCH,
      message: 'P17-B: real connectivity probe commit (Git Data API single-commit path)',
      files: [PROBE_FILE],
    });
    expect(outcome.status).toBe('OK');
    if (outcome.status !== 'OK') {
      return;
    }
    expect(outcome.result.sha).toMatch(/^[0-9a-f]{40}$/);
    record('probe-commit', true, { sha: outcome.result.sha, branch: BRANCH, committed_at: outcome.result.committed_at });
  });

  it('opens a pull request through the frozen contract surface', async () => {
    const outcome = await provider.createPullRequest({
      repository: REPO,
      title: 'P17-B real GitHub connectivity probe',
      head_branch: BRANCH,
      base_branch: 'main',
      body: 'Opened by the SOS 2.0 real GitHub adapter (P17-B) through the frozen GitHubPort contract. Auto-cleanup run.',
    });
    expect(outcome.status).toBe('OK');
    if (outcome.status !== 'OK') {
      return;
    }
    pullRequestNumber = outcome.result.number;
    expect(outcome.result.state).toBe('open');
    expect(outcome.result.url).toContain('github.com');
    expect(outcome.result.head_sha).toMatch(/^[0-9a-f]{40}$/);
    record('create-pull-request', true, {
      number: outcome.result.number,
      url: outcome.result.url,
      head_sha: outcome.result.head_sha,
      head_branch: outcome.result.head_branch,
      base_branch: outcome.result.base_branch,
    });
  });

  it('reads the REAL pull-request state (open) through the provider-side surface', async () => {
    expect(pullRequestNumber).not.toBeNull();
    const state = await provider.getPullRequestState(REPO, pullRequestNumber!);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('open');
    expect(state!.merged).toBe(false);
    record('read-pr-state', true, { number: state!.number, state: state!.state, merged: state!.merged, url: state!.url });
  });

  it('closes the pull request (the journey cleanup path)', async () => {
    expect(pullRequestNumber).not.toBeNull();
    const state = await provider.closePullRequest(REPO, pullRequestNumber!);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('closed');
    record('close-pr', true, { number: state!.number, state: state!.state, url: state!.url });
  });

  it('deletes the scratch repository (cleanup — the deletion is recorded)', async () => {
    const deleted = await provider.deleteRepository(REPO);
    expect(deleted).toBe(true);
    repositoryDeleted = true;
    record('delete-repository', deleted, { repository: REPO, note: 'the scratch repository was deleted; the durable evidence is the transcript (github-integration.json)' });
  });
});
