/**
 * THE REAL GITHUB ADAPTER (Work Order P17-B) — the vendor-backed
 * realization of the frozen @sos-2/github GitHubPort over the REAL
 * GitHub REST API, attached through the injectable GitHubRequestPort
 * HTTP seam (fetch-transport.ts) — exactly the attachment P4 designed:
 * "a real backing provider is a GitHubPort implementation over an
 * injected GitHubRequestPort".
 *
 * HONESTY DISCIPLINE (program-defining):
 *   - CONNECTED is only ever claimed after a REAL authenticated probe
 *     (verifyToken probes GET /user on the backing provider — the
 *     PAT-backed real handshake); configuration alone is PREPARED,
 *     never CONNECTED (the P4 rule).
 *   - the OAuth authorization surface is IMPLEMENTED (beginConnection
 *     builds the real github.com/login/oauth/authorize URL from a
 *     configured OAuth app client id) while LIVE OPERATION in this
 *     program is PAT-backed — recorded honestly everywhere.
 *   - provider failures map to typed UNSUPPORTED outcomes carrying the
 *     truthful status and message (the P4 precedent: "the honest answer
 *     is UNSUPPORTED, never a fabricated list") PLUS the P17-B
 *     provider-state surface records UNAVAILABLE / DEGRADED with REAL
 *     rate-limit reset data.
 *   - secrets never appear: the token is injected into the transport at
 *     the composition boundary; outcomes, notes, telemetry and evidence
 *     carry the credential env NAME only.
 *
 * DETERMINISM DISCIPLINE: the provider logic itself has NO hidden
 * clocks (instants are caller-supplied literals; provider-reported
 * instants come from real API responses); the deterministic suites
 * inject a scripted request port — the network happens only in the
 * env-gated integration suite (RUN_REAL=1).
 */

import type {
  GitHubCapabilitySurface,
  GitHubCapability,
  GitHubOperationOutcome,
} from './github-vocabulary.js';
import { buildCapabilitySurface, unsupportedOutcome } from './github-vocabulary.js';
import type {
  BeginGitHubConnectionInput,
  CompleteGitHubConnectionInput,
  CompleteGitHubConnectionResult,
  GitHubConnectionAuthorization,
  GitHubConnectionScope,
  GitHubConnectionState,
} from './github-vocabulary.js';
import { GITHUB_ONBOARDING_READ_SCOPES, GITHUB_ONBOARDING_WRITE_SCOPES } from './github-vocabulary.js';
import type {
  BranchRef,
  CommitFilesInput,
  CommitRef,
  CreateBranchInput,
  CreatePullRequestInput,
  GitHubAdapterDescriptor,
  GitHubPort,
  GitHubProviderResponse,
  GitHubRequestPort,
  ImportedRevision,
  PullRequestRef,
  RegisterWebhookInput,
  RepositoryId,
  RepositorySnapshot,
  RepositorySummary,
  SnapshotRefSelection,
  SnapshotTreeEntry,
  WebhookRegistration,
} from './github-vocabulary.js';
import { repositorySlug } from './github-vocabulary.js';
import type {
  GitHubBranchRecord,
  GitHubCommitRecord,
  GitHubContentsCommitPayload,
  GitHubPullRequestRecord,
  GitHubRefRecord,
  GitHubRepoRecord,
  GitHubTreeRecord,
  GitHubUserRecord,
} from './api-records.js';
import type {
  GitHubRateLimitSnapshot,
  RealGitHubProviderStateReport,
} from './provider-state.js';
import { unprobedProviderStateReport } from './provider-state.js';

/** The real provider's stable id. */
export const REAL_GITHUB_PROVIDER_ID = 'github-real';

/** The real GitHub authorize surface (the implemented OAuth app flow). */
export const GITHUB_OAUTH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

/** Options for the real GitHub provider. */
export interface RealGitHubProviderOptions {
  /** The injected request port — the REAL HTTP seam (fetch-backed in production). */
  readonly requestPort: GitHubRequestPort;
  /** The credential environment variable NAME recorded in provider-state reports (the value never appears). */
  readonly credentialEnv?: string | null;
  /**
   * The OAuth app configuration for the implemented authorization surface
   * (beginConnection builds the real authorize URL). Null (default) when
   * no OAuth app is configured — the honest note says so; live operation
   * is PAT-backed either way.
   */
  readonly oauth?: { readonly clientId: string; readonly redirectUri?: string } | null;
  /** The maximum discovery/branch pages followed (default 10 — a bounded, honest walk). */
  readonly maxPages?: number;
}

/** The real-verification record of the PAT-backed handshake. */
export interface RealHandshakeVerification {
  readonly verified: boolean;
  readonly authorization_ref: string;
  readonly verified_at: string;
  readonly login: string | null;
  readonly failure: string | null;
}

/** The provider-side (non-contract) read of one pull request's REAL state. */
export interface RealPullRequestState {
  readonly repository: RepositoryId;
  readonly number: number;
  readonly state: 'open' | 'closed';
  readonly head_branch: string;
  readonly head_sha: string;
  readonly base_branch: string;
  readonly merged: boolean;
  readonly url: string;
}

const DEFAULT_MAX_PAGES = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBase64(contents: string): string {
  return typeof Buffer !== 'undefined'
    ? Buffer.from(contents, 'utf8').toString('base64')
    : btoa(contents);
}

/**
 * THE REAL GITHUB PROVIDER — GitHubPort over the real REST API. The
 * frozen contract is the ONLY semantic surface; the P17-B provider-state
 * probe and the provider-side PR-state/cleanup surfaces are adapter
 * control-plane additions (P4/W12 adapter precedent) that never redefine
 * frozen semantics.
 */
export class RealGitHubProvider implements GitHubPort {
  readonly descriptor: GitHubAdapterDescriptor;
  private readonly requestPort: GitHubRequestPort;
  private readonly credentialEnv: string | null;
  private readonly oauth: { clientId: string; redirectUri?: string } | null;
  private readonly maxPages: number;
  private readonly capabilitySurface: GitHubCapabilitySurface;
  private connectionState: GitHubConnectionState;
  private stateReport: RealGitHubProviderStateReport;
  private lastVerification: RealHandshakeVerification | null = null;

  constructor(options: RealGitHubProviderOptions) {
    if (typeof options !== 'object' || options === null || typeof options.requestPort !== 'object' || options.requestPort === null) {
      throw new Error('RealGitHubProvider requires an injected GitHubRequestPort (the real HTTP seam)');
    }
    this.requestPort = options.requestPort;
    this.credentialEnv = options.credentialEnv ?? null;
    this.oauth = options.oauth ?? null;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.capabilitySurface = buildCapabilitySurface({
      provider_id: REAL_GITHUB_PROVIDER_ID,
      supported: [
        'connection',
        'repository-discovery',
        'branch-selection',
        'revision-selection',
        'empty-repository-detection',
        'snapshot-import',
        'webhook-registration',
        'branch-creation',
        'commit-operations',
        'pull-request-operations',
      ],
      note: 'The real GitHub REST API supports the full GitHubPort surface behind the injected request seam; failures answer typed UNSUPPORTED outcomes carrying the truthful provider status (never a fabricated success).',
    });
    this.descriptor = {
      provider_id: REAL_GITHUB_PROVIDER_ID,
      adapter_contract: 'ProjectAdapter',
      note: 'Real GitHub adapter behind the frozen provider-neutral GitHubPort (P17-B). Connection evidence is only ever claimed after a real authenticated probe; live operation is PAT-backed (the OAuth app surface is implemented).',
    };
    this.connectionState = {
      status: 'NOT_YET_CONNECTED',
      simulated: false,
      provider_id: REAL_GITHUB_PROVIDER_ID,
      granted_scopes: [],
      connected_at: null,
      note: this.credentialEnv === null
        ? 'The real GitHub provider is honestly NOT_YET_CONNECTED — no credential env was bound (names only, never values).'
        : `The real GitHub provider is honestly NOT_YET_CONNECTED — the credential ${this.credentialEnv} is configured (PREPARED, never CONNECTED) until verifyToken completes a real authenticated probe.`,
    };
    this.stateReport = unprobedProviderStateReport({ provider_id: REAL_GITHUB_PROVIDER_ID, credential_env: this.credentialEnv });
  }

  // -------------------------------------------------------------------------
  // Frozen GitHubPort surface: identity + capabilities + connection
  // -------------------------------------------------------------------------

  capabilities(): GitHubCapabilitySurface {
    return this.capabilitySurface;
  }

  connection(): GitHubConnectionState {
    return this.connectionState;
  }

  /**
   * The REAL handshake verification (the PAT-backed real probe). This is
   * the async preparation step for the frozen (synchronous)
   * completeConnection: it probes GET /user on the backing provider and
   * records the verified result. CONNECTED is only ever claimed after
   * this real probe succeeds — configuration alone is never enough.
   */
  async verifyToken(verifiedAt: string): Promise<RealHandshakeVerification> {
    const response = await this.send<null, GitHubUserRecord>('GET', '/user', null, null);
    const failure = this.describeFailure(response);
    if (response.status !== 200 || response.body === null || typeof response.body.login !== 'string') {
      const reason = failure ?? `unexpected response shape (status ${response.status})`;
      this.lastVerification = {
        verified: false,
        authorization_ref: 'real-handshake',
        verified_at: verifiedAt,
        login: null,
        failure: reason,
      };
      this.stateReport = this.stateFromProbe(verifiedAt, response.status, null, reason);
      return this.lastVerification;
    }
    const login = response.body.login;
    this.lastVerification = {
      verified: true,
      authorization_ref: `real-handshake:${login}`,
      verified_at: verifiedAt,
      login,
      failure: null,
    };
    this.stateReport = this.stateFromProbe(verifiedAt, 200, login, null);
    this.connectionState = {
      status: 'CONNECTED',
      simulated: false,
      provider_id: REAL_GITHUB_PROVIDER_ID,
      granted_scopes: this.grantedScopesFromTelemetry(),
      connected_at: verifiedAt,
      note: `PAT-backed real handshake verified on the backing provider (login ${login} answered GET /user); the OAuth app surface is implemented, live operation is PAT-backed — recorded honestly.`,
    };
    return this.lastVerification;
  }

  /** beginConnection: the implemented OAuth app authorization surface (real authorize URL). */
  beginConnection(input: BeginGitHubConnectionInput): GitHubConnectionAuthorization {
    if (typeof input.state_token !== 'string' || input.state_token.length === 0) {
      throw new Error('beginConnection requires a non-empty state_token (the CSRF-discipline field)');
    }
    const requestedScopes: GitHubConnectionScope[] =
      input.scopes.length > 0 ? [...input.scopes] : [...GITHUB_ONBOARDING_READ_SCOPES];
    if (this.oauth === null) {
      // The honest not-configured surface (the P4 transport precedent: no
      // URL is fabricated) — the flow is implemented; this instance has
      // no OAuth app client id bound; live operation is PAT-backed.
      return {
        authorization_ref: `real-oauth-pending:${input.state_token.length}`,
        authorization_url: '',
        requested_scopes: requestedScopes,
        simulated: false,
        note: 'The OAuth app authorization surface is implemented (the provider builds the real github.com/login/oauth/authorize URL when an OAuth app client id is bound); this instance has none bound — live operation is PAT-backed (verifyToken probes the real provider; CONNECTED is never fabricated).',
      };
    }
    const url = new URL(GITHUB_OAUTH_AUTHORIZE_URL);
    url.searchParams.set('client_id', this.oauth.clientId);
    if (this.oauth.redirectUri !== undefined) {
      url.searchParams.set('redirect_uri', this.oauth.redirectUri);
    }
    // The least-privilege provider-neutral tokens map onto the classic
    // 'repo' scope only when a write token is requested (the connection
    // contract's documented mapping of its vocabulary onto GitHub).
    const writeRequested = requestedScopes.some((scope) => scope.endsWith(':write') || scope.endsWith(':manage'));
    if (writeRequested) {
      url.searchParams.set('scope', 'repo');
    }
    url.searchParams.set('state', input.state_token);
    return {
      authorization_ref: `real-oauth:${input.state_token.length}:${requestedScopes.length}`,
      authorization_url: url.toString(),
      requested_scopes: requestedScopes,
      simulated: false,
      note: 'The REAL GitHub OAuth app authorization surface (github.com/login/oauth/authorize with the CSRF state token). Implemented flow; live operation in this program is PAT-backed — recorded honestly.',
    };
  }

  /** completeConnection: CONNECTED only after the real handshake (verifyToken) succeeded. */
  completeConnection(input: CompleteGitHubConnectionInput): CompleteGitHubConnectionResult {
    if (typeof input.authorization_code !== 'string' || input.authorization_code.length === 0) {
      return { status: 'REFUSED', reason: 'The real handshake refused an empty authorization code (fail-closed).' };
    }
    if (this.lastVerification === null || !this.lastVerification.verified) {
      const failure = this.lastVerification?.failure ?? 'no real handshake has run yet';
      return {
        status: 'REFUSED',
        reason: `No completed real handshake backs this connection (${failure}). Call verifyToken to run the real authenticated probe — CONNECTED is never fabricated.`,
      };
    }
    return { status: 'CONNECTED', connection: this.connectionState };
  }

  // -------------------------------------------------------------------------
  // Frozen GitHubPort surface: read operations (REAL REST calls)
  // -------------------------------------------------------------------------

  async discoverRepositories(): Promise<GitHubOperationOutcome<RepositorySummary[]>> {
    const summaries: RepositorySummary[] = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      const response = await this.send<null, GitHubRepoRecord[]>('GET', '/user/repos', null, {
        per_page: '100',
        sort: 'pushed',
        direction: 'desc',
        page: String(page),
      });
      if (response.status !== 200 || !Array.isArray(response.body)) {
        return this.refusal('repository-discovery', response, 'Repository discovery failed');
      }
      for (const repo of response.body) {
        summaries.push(this.repoToSummary(repo));
      }
      if (response.body.length < 100) {
        break;
      }
    }
    return { status: 'OK', result: summaries };
  }

  async listBranches(repository: RepositoryId): Promise<GitHubOperationOutcome<BranchRef[]>> {
    const branches: BranchRef[] = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      const response = await this.send<null, GitHubBranchRecord[]>(
        'GET',
        `/repos/${repository.owner}/${repository.name}/branches`,
        null,
        { per_page: '100', page: String(page) },
      );
      if (response.status === 404) {
        return this.refusal('branch-selection', response, `Repository not found: ${repositorySlug(repository)}`);
      }
      if (response.status !== 200 || !Array.isArray(response.body)) {
        return this.refusal('branch-selection', response, `Branch listing failed for ${repositorySlug(repository)}`);
      }
      for (const branch of response.body) {
        branches.push({
          name: branch.name,
          head_sha: branch.commit === null ? '' : branch.commit.sha,
          is_protected: branch.protected,
        });
      }
      if (response.body.length < 100) {
        break;
      }
    }
    return { status: 'OK', result: branches };
  }

  async getRepositorySnapshot(
    repository: RepositoryId,
    ref: SnapshotRefSelection,
    capturedAt: string,
  ): Promise<GitHubOperationOutcome<RepositorySnapshot>> {
    const repoResponse = await this.send<null, GitHubRepoRecord>('GET', `/repos/${repository.owner}/${repository.name}`, null, null);
    if (repoResponse.status === 404) {
      return this.refusal('snapshot-import', repoResponse, `Repository not found: ${repositorySlug(repository)}`);
    }
    if (repoResponse.status !== 200 || repoResponse.body === null || !isRecord(repoResponse.body)) {
      return this.refusal('snapshot-import', repoResponse, `Snapshot capture failed for ${repositorySlug(repository)}`);
    }
    const repo = repoResponse.body;

    // Empty-repository detection: the REAL probe is the branches listing
    // (an empty repository has no branches at all).
    const branchesProbe = await this.send<null, GitHubBranchRecord[]>(
      'GET',
      `/repos/${repository.owner}/${repository.name}/branches`,
      null,
      { per_page: '1' },
    );
    const isEmpty = branchesProbe.status === 200 && Array.isArray(branchesProbe.body) && branchesProbe.body.length === 0;
    if (isEmpty) {
      if (ref.branch !== undefined && ref.branch !== null) {
        return this.refusal(
          'revision-selection',
          { status: 404, body: null },
          `Repository ${repositorySlug(repository)} is empty — no branch or revision exists to select (empty-repository detection)`,
        );
      }
      return {
        status: 'OK',
        result: {
          repository,
          ref: { branch: '', sha: '' },
          is_empty: true,
          captured_at: capturedAt,
          tree: [],
          file_count: 0,
          description: repo.description ?? null,
          default_branch: null,
        },
      };
    }

    const branchName = ref.branch ?? repo.default_branch ?? 'main';
    let sha: string | null = null;
    if (ref.sha !== undefined && ref.sha !== null && ref.sha.length > 0) {
      sha = ref.sha;
    } else {
      const refResponse = await this.send<null, GitHubRefRecord>(
        'GET',
        `/repos/${repository.owner}/${repository.name}/git/ref/heads/${branchName}`,
        null,
        null,
      );
      if (refResponse.status === 404) {
        return this.refusal('revision-selection', refResponse, `Branch not found in ${repositorySlug(repository)}: ${JSON.stringify(branchName)}`);
      }
      if (refResponse.status !== 200 || refResponse.body === null || !isRecord(refResponse.body)) {
        return this.refusal('revision-selection', refResponse, `Revision resolution failed for ${repositorySlug(repository)}:${branchName}`);
      }
      sha = refResponse.body.object?.sha ?? null;
    }
    if (sha === null || sha.length === 0) {
      return this.refusal('revision-selection', { status: 404, body: null }, `Revision not found in ${repositorySlug(repository)}`);
    }

    const treeResponse = await this.send<null, GitHubTreeRecord>(
      'GET',
      `/repos/${repository.owner}/${repository.name}/git/trees/${sha}`,
      null,
      { recursive: '1' },
    );
    if (treeResponse.status === 404) {
      return this.refusal('revision-selection', treeResponse, `Revision not found in ${repositorySlug(repository)}: ${sha}`);
    }
    if (treeResponse.status !== 200 || treeResponse.body === null || !Array.isArray(treeResponse.body.tree)) {
      return this.refusal('snapshot-import', treeResponse, `Tree import failed for ${repositorySlug(repository)} at ${sha}`);
    }
    const tree: SnapshotTreeEntry[] = treeResponse.body.tree
      .filter((entry) => entry.type === 'blob' || entry.type === 'tree')
      .map((entry) => ({
        path: entry.path,
        type: entry.type === 'blob' ? 'file' : 'dir',
        size_bytes: entry.type === 'blob' ? entry.size ?? null : null,
      }));
    return {
      status: 'OK',
      result: {
        repository,
        ref: { branch: branchName, sha },
        is_empty: false,
        captured_at: capturedAt,
        tree,
        file_count: tree.filter((entry) => entry.type === 'file').length,
        description: repo.description ?? null,
        default_branch: repo.default_branch ?? null,
      },
    };
  }

  importSnapshot(snapshot: RepositorySnapshot): ImportedRevision {
    if (snapshot.is_empty) {
      return { repository: snapshot.repository, branch: '', revision: { kind: 'git-sha', value: '' } };
    }
    return {
      repository: snapshot.repository,
      branch: snapshot.ref.branch,
      revision: { kind: 'git-sha', value: snapshot.ref.sha },
    };
  }

  // -------------------------------------------------------------------------
  // Frozen GitHubPort surface: write operations (REAL REST calls)
  // -------------------------------------------------------------------------

  async registerWebhook(input: RegisterWebhookInput): Promise<GitHubOperationOutcome<WebhookRegistration>> {
    const response = await this.send<{ name: string; config: { url: string }; events: string[]; active: boolean }, { id: number }>(
      'POST',
      `/repos/${input.repository.owner}/${input.repository.name}/hooks`,
      {
        name: 'web',
        config: { url: input.url },
        events: [...input.events],
        active: true,
      },
      null,
    );
    if (response.status !== 201 || response.body === null || typeof response.body.id !== 'number') {
      return this.refusal('webhook-registration', response, `Webhook registration failed for ${repositorySlug(input.repository)}`);
    }
    return {
      status: 'OK',
      result: {
        webhook_id: String(response.body.id),
        repository: input.repository,
        url: input.url,
        events: [...input.events],
        active: true,
      },
    };
  }

  async createBranch(input: CreateBranchInput): Promise<GitHubOperationOutcome<BranchRef>> {
    const response = await this.send<{ ref: string; sha: string }, GitHubRefRecord>(
      'POST',
      `/repos/${input.repository.owner}/${input.repository.name}/git/refs`,
      { ref: `refs/heads/${input.name}`, sha: input.from_sha },
      null,
    );
    if (response.status !== 201 || response.body === null || !isRecord(response.body)) {
      return this.refusal('branch-creation', response, `Branch creation failed in ${repositorySlug(input.repository)}`);
    }
    return {
      status: 'OK',
      result: { name: input.name, head_sha: input.from_sha, is_protected: false },
    };
  }

  async commitFiles(input: CommitFilesInput): Promise<GitHubOperationOutcome<CommitRef>> {
    const owner = input.repository.owner;
    const name = input.repository.name;
    const branchesProbe = await this.send<null, GitHubBranchRecord[]>(
      'GET',
      `/repos/${owner}/${name}/branches`,
      null,
      { per_page: '1' },
    );
    const isEmpty = branchesProbe.status === 200 && Array.isArray(branchesProbe.body) && branchesProbe.body.length === 0;
    if (isEmpty) {
      return this.commitFilesOnEmptyRepository(input);
    }
    // The single-commit write path over the Git Data API (one CommitRef
    // with the exact resulting sha — the contract shape).
    const refResponse = await this.send<null, GitHubRefRecord>('GET', `/repos/${owner}/${name}/git/ref/heads/${input.branch}`, null, null);
    if (refResponse.status === 404) {
      return this.refusal('commit-operations', refResponse, `Branch not found in ${repositorySlug(input.repository)}: ${input.branch}`);
    }
    if (refResponse.status !== 200 || refResponse.body === null || !isRecord(refResponse.body)) {
      return this.refusal('commit-operations', refResponse, `Head resolution failed for ${repositorySlug(input.repository)}:${input.branch}`);
    }
    const headSha = refResponse.body.object?.sha;
    if (typeof headSha !== 'string' || headSha.length === 0) {
      return this.refusal('commit-operations', { status: 404, body: null }, `Head resolution failed for ${repositorySlug(input.repository)}:${input.branch}`);
    }
    const headCommit = await this.send<null, GitHubCommitRecord>('GET', `/repos/${owner}/${name}/git/commits/${headSha}`, null, null);
    if (headCommit.status !== 200 || headCommit.body === null || typeof headCommit.body.sha !== 'string' || !isRecord(headCommit.body)) {
      return this.refusal('commit-operations', headCommit, `Base commit read failed for ${headSha}`);
    }
    const headCommitRecord = headCommit.body as GitHubCommitRecord;
    const baseTree = headCommitRecord.tree?.sha;
    if (typeof baseTree !== 'string' || baseTree.length === 0) {
      return this.refusal('commit-operations', { status: 404, body: null }, `Base tree read failed for ${headSha}`);
    }
    const treeEntries: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
    for (const file of input.files) {
      const blob = await this.send<{ content: string; encoding: 'base64' }, { sha: string }>(
        'POST',
        `/repos/${owner}/${name}/git/blobs`,
        { content: toBase64(file.contents), encoding: 'base64' },
        null,
      );
      if (blob.status !== 201 || blob.body === null || typeof blob.body.sha !== 'string') {
        return this.refusal('commit-operations', blob, `Blob creation failed for ${JSON.stringify(file.path)}`);
      }
      treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.body.sha });
    }
    const tree = await this.send<{ base_tree: string; tree: typeof treeEntries }, { sha: string }>(
      'POST',
      `/repos/${owner}/${name}/git/trees`,
      { base_tree: baseTree, tree: treeEntries },
      null,
    );
    if (tree.status !== 201 || tree.body === null || typeof tree.body.sha !== 'string') {
      return this.refusal('commit-operations', tree, `Tree creation failed for ${repositorySlug(input.repository)}`);
    }
    const commit = await this.send<{ message: string; tree: string; parents: string[] }, GitHubCommitRecord>(
      'POST',
      `/repos/${owner}/${name}/git/commits`,
      { message: input.message, tree: tree.body.sha, parents: [headSha] },
      null,
    );
    if (commit.status !== 201 || commit.body === null || typeof commit.body.sha !== 'string') {
      return this.refusal('commit-operations', commit, `Commit creation failed for ${repositorySlug(input.repository)}`);
    }
    const update = await this.send<{ sha: string }, GitHubRefRecord>(
      'PATCH',
      `/repos/${owner}/${name}/git/refs/heads/${input.branch}`,
      { sha: commit.body.sha },
      null,
    );
    if (update.status !== 200) {
      return this.refusal('commit-operations', update, `Branch update failed for ${repositorySlug(input.repository)}:${input.branch}`);
    }
    // committed_at carries the REAL committer date from the provider
    // response — real evidence, not a hidden clock (documented adapter
    // decision; the deterministic suites script this response).
    return {
      status: 'OK',
      result: {
        repository: input.repository,
        branch: input.branch,
        sha: commit.body.sha,
        message: input.message,
        committed_at: commit.body.commit?.committer?.date ?? '',
      },
    };
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<GitHubOperationOutcome<PullRequestRef>> {
    const response = await this.send<{ title: string; head: string; base: string; body: string | null }, GitHubPullRequestRecord>(
      'POST',
      `/repos/${input.repository.owner}/${input.repository.name}/pulls`,
      {
        title: input.title,
        head: input.head_branch,
        base: input.base_branch,
        body: input.body ?? null,
      },
      null,
    );
    if (response.status !== 201 || response.body === null || !isRecord(response.body)) {
      return this.refusal('pull-request-operations', response, `Pull-request creation failed for ${repositorySlug(input.repository)}`);
    }
    const pr = response.body;
    return {
      status: 'OK',
      result: {
        repository: input.repository,
        number: pr.number,
        title: pr.title,
        head_branch: pr.head?.ref ?? input.head_branch,
        base_branch: pr.base?.ref ?? input.base_branch,
        head_sha: pr.head?.sha ?? '',
        state: pr.state,
        url: pr.html_url,
      },
    };
  }

  // -------------------------------------------------------------------------
  // P17-B provider-state + provider-side (non-contract) surfaces
  // -------------------------------------------------------------------------

  /** The last REAL provider-state report (UNKNOWN until probed). */
  providerState(): RealGitHubProviderStateReport {
    return this.stateReport;
  }

  /** Run the REAL provider probe (authenticated /user + transport telemetry). */
  async probeProvider(probedAt: string): Promise<RealGitHubProviderStateReport> {
    const response = await this.send<null, GitHubUserRecord>('GET', '/user', null, null);
    const login = response.status === 200 && response.body !== null && typeof response.body.login === 'string' ? response.body.login : null;
    this.stateReport = this.stateFromProbe(probedAt, response.status, login, this.describeFailure(response));
    return this.stateReport;
  }

  /** The REAL rate-limit snapshot from the transport telemetry (null when none observed). */
  rateLimitSnapshot(): GitHubRateLimitSnapshot | null {
    const telemetry = this.transportTelemetry();
    return telemetry.rateLimit;
  }

  /**
   * Provider-side (non-contract) read of one pull request's REAL state.
   * The frozen GitHubPort has no PR-read/close surface; the integration
   * journey needs the honest PR state — this adapter-side surface reads
   * it WITHOUT redefining the frozen contract.
   */
  async getPullRequestState(repository: RepositoryId, number: number): Promise<RealPullRequestState | null> {
    const response = await this.send<null, GitHubPullRequestRecord>(
      'GET',
      `/repos/${repository.owner}/${repository.name}/pulls/${number}`,
      null,
      null,
    );
    if (response.status !== 200 || response.body === null || !isRecord(response.body)) {
      return null;
    }
    const pr = response.body;
    return {
      repository,
      number: pr.number,
      state: pr.state,
      head_branch: pr.head?.ref ?? '',
      head_sha: pr.head?.sha ?? '',
      base_branch: pr.base?.ref ?? '',
      merged: pr.merged_at !== null && pr.merged_at !== undefined,
      url: pr.html_url,
    };
  }

  /** Provider-side (non-contract) close of one pull request (the journey's cleanup path). */
  async closePullRequest(repository: RepositoryId, number: number): Promise<RealPullRequestState | null> {
    const response = await this.send<{ state: 'closed' }, GitHubPullRequestRecord>(
      'PATCH',
      `/repos/${repository.owner}/${repository.name}/pulls/${number}`,
      { state: 'closed' },
      null,
    );
    if (response.status !== 200 || response.body === null || !isRecord(response.body)) {
      return null;
    }
    const pr = response.body;
    return {
      repository,
      number: pr.number,
      state: pr.state,
      head_branch: pr.head?.ref ?? '',
      head_sha: pr.head?.sha ?? '',
      base_branch: pr.base?.ref ?? '',
      merged: pr.merged_at !== null && pr.merged_at !== undefined,
      url: pr.html_url,
    };
  }

  /** Provider-side (non-contract) repository creation (the integration journey's scratch setup). */
  async createRepository(input: {
    name: string;
    private: boolean;
    description: string | null;
  }): Promise<GitHubOperationOutcome<RepositorySummary>> {
    const response = await this.send<{ name: string; private: boolean; description: string | null; auto_init: boolean }, GitHubRepoRecord>(
      'POST',
      '/user/repos',
      { name: input.name, private: input.private, description: input.description, auto_init: false },
      null,
    );
    if (response.status !== 201 || response.body === null || !isRecord(response.body)) {
      return this.refusal('repository-discovery', response, `Repository creation failed: ${input.name}`);
    }
    return { status: 'OK', result: this.repoToSummary(response.body) };
  }

  /** Provider-side (non-contract) repository deletion (the scratch cleanup path). */
  async deleteRepository(repository: RepositoryId): Promise<boolean> {
    const response = await this.send<null, null>('DELETE', `/repos/${repository.owner}/${repository.name}`, null, null);
    return response.status === 204;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private transportTelemetry(): {
    rateLimit: GitHubRateLimitSnapshot | null;
    oauthScopes: string[] | null;
    apiRevision: string | null;
  } {
    const port = this.requestPort as {
      telemetry?: () => { rateLimit?: GitHubRateLimitSnapshot | null; oauthScopes?: string[] | null; apiRevision?: string | null };
    };
    if (typeof port.telemetry !== 'function') {
      return { rateLimit: null, oauthScopes: null, apiRevision: null };
    }
    const telemetry = port.telemetry();
    return {
      rateLimit: telemetry.rateLimit ?? null,
      oauthScopes: telemetry.oauthScopes ?? null,
      apiRevision: telemetry.apiRevision ?? null,
    };
  }

  private grantedScopesFromTelemetry(): GitHubConnectionScope[] {
    const { oauthScopes } = this.transportTelemetry();
    if (oauthScopes === null || oauthScopes.length === 0) {
      // The provider did not report OAuth scopes (fine-grained PAT or
      // scripted transport): the honest grant set is the read preset —
      // never a fabricated write grant.
      return [...GITHUB_ONBOARDING_READ_SCOPES];
    }
    const write = oauthScopes.some((scope) => scope === 'repo' || scope === 'workflow');
    return write ? [...GITHUB_ONBOARDING_WRITE_SCOPES] : [...GITHUB_ONBOARDING_READ_SCOPES];
  }

  private stateFromProbe(
    probedAt: string,
    status: number,
    login: string | null,
    failure: string | null,
  ): RealGitHubProviderStateReport {
    const { rateLimit, apiRevision } = this.transportTelemetry();
    const rateLimited = status === 403 && rateLimit !== null && rateLimit.remaining === 0;
    if (status === 200 && login !== null) {
      return {
        state: 'CONNECTED',
        provider_id: REAL_GITHUB_PROVIDER_ID,
        probed_at: probedAt,
        credential_env: this.credentialEnv,
        api_revision: apiRevision,
        login,
        rate_limit: rateLimit,
        note: `The real GitHub provider answered an authenticated probe (login ${login}, HTTP ${status}, API revision ${apiRevision ?? 'unreported'}) — CONNECTED on real evidence.`,
      };
    }
    if (rateLimited) {
      return {
        state: 'DEGRADED',
        provider_id: REAL_GITHUB_PROVIDER_ID,
        probed_at: probedAt,
        credential_env: this.credentialEnv,
        api_revision: null,
        login,
        rate_limit: rateLimit,
        note: `The real GitHub provider is rate limited (HTTP ${status}; window resets at epoch ${rateLimit?.reset_epoch_s}) — DEGRADED with the REAL reset time, never a fake success.`,
      };
    }
    return {
      state: 'UNAVAILABLE',
      provider_id: REAL_GITHUB_PROVIDER_ID,
      probed_at: probedAt,
      credential_env: this.credentialEnv,
      api_revision: null,
      login,
      rate_limit: rateLimit,
      note: `The real GitHub provider was probed and is not usable (HTTP ${status}${failure === null ? '' : `: ${failure}`}) — UNAVAILABLE, the honest outage state.`,
    };
  }

  private describeFailure(response: GitHubProviderResponse<unknown>): string | null {
    if (response.status === 0) {
      return 'network failure (the provider could not be reached)';
    }
    const body = response.body;
    if (isRecord(body) && typeof body['message'] === 'string') {
      return body['message'];
    }
    return null;
  }

  private refusal<T>(
    capability: GitHubCapability,
    response: GitHubProviderResponse<unknown>,
    context: string,
  ): GitHubOperationOutcome<T> {
    const failure = this.describeFailure(response);
    const reason =
      response.status === 403 && this.rateLimitSnapshot()?.remaining === 0
        ? `${context}: the provider is rate limited (resets at epoch ${this.rateLimitSnapshot()?.reset_epoch_s}) — the honest answer is this typed UNSUPPORTED, never a fabricated success (provider state: DEGRADED).`
        : `${context} (HTTP ${response.status}${failure === null ? '' : `: ${failure}`}) — the honest answer is this typed UNSUPPORTED, never a fabricated success.`;
    return unsupportedOutcome(capability, REAL_GITHUB_PROVIDER_ID, reason);
  }

  private repoToSummary(repo: GitHubRepoRecord): RepositorySummary {
    // Empty-repository detection at discovery: a repository with zero
    // size and no pushes is empty (GitHub reports size in KB; an empty
    // repository has size 0 and pushed_at null). getRepositorySnapshot
    // verifies emptiness with the authoritative branches probe.
    const isEmpty = repo.size === 0 && repo.pushed_at === null;
    return {
      id: { owner: repo.owner?.login ?? '', name: repo.name },
      visibility: repo.private ? 'private' : 'public',
      description: repo.description ?? null,
      default_branch: isEmpty ? null : repo.default_branch ?? null,
      is_empty: isEmpty,
      webhooks_supported: true,
      pushed_at: repo.pushed_at ?? null,
    };
  }

  /**
   * The initial-commit path on an EMPTY repository: the contents API
   * creates the repository's first branch (the provider-neutral
   * contents-API behavior the P4 reference documented). One commit per
   * file is the real contents-API behavior; the returned CommitRef
   * carries the LAST commit (the resulting branch head) with the
   * contract's single message.
   */
  private async commitFilesOnEmptyRepository(input: CommitFilesInput): Promise<GitHubOperationOutcome<CommitRef>> {
    const owner = input.repository.owner;
    const name = input.repository.name;
    let lastSha = '';
    let lastDate = '';
    for (let index = 0; index < input.files.length; index += 1) {
      const file = input.files[index]!;
      const suffix = input.files.length > 1 ? ` (${index + 1}/${input.files.length})` : '';
      const response = await this.send<{ message: string; content: string; branch: string }, GitHubContentsCommitPayload>(
        'PUT',
        `/repos/${owner}/${name}/contents/${file.path}`,
        { message: `${input.message}${suffix}`, content: toBase64(file.contents), branch: input.branch },
        null,
      );
      if (response.status !== 201 || response.body === null || !isRecord(response.body) || !isRecord(response.body['commit'])) {
        return this.refusal('commit-operations', response, `Initial commit failed for ${repositorySlug(input.repository)}:${input.branch}`);
      }
      const commit = response.body['commit'] as { sha?: unknown; committer?: { date?: unknown } };
      if (typeof commit['sha'] === 'string') {
        lastSha = commit['sha'];
      }
      const date = commit['committer'];
      if (isRecord(date) && typeof date['date'] === 'string') {
        lastDate = date['date'];
      }
    }
    return {
      status: 'OK',
      result: {
        repository: input.repository,
        branch: input.branch,
        sha: lastSha,
        message: input.message,
        committed_at: lastDate,
      },
    };
  }

  private async send<TBody, TResult>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body: TBody | null,
    query: Record<string, string> | null,
  ): Promise<GitHubProviderResponse<TResult>> {
    return this.requestPort.request<TBody, TResult>({
      method,
      path,
      query,
      body,
      headers: { accept: 'application/vnd.github+json' },
    });
  }
}

/** Construct the real GitHub provider over the injected request port. */
export function createRealGitHubProvider(options: RealGitHubProviderOptions): RealGitHubProvider {
  return new RealGitHubProvider(options);
}
