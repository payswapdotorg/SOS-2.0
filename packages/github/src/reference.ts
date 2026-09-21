/**
 * The in-memory reference implementation of the GitHubPort (Work Order
 * P4): deterministic, offline, zero network — used by the deterministic
 * test suites and local development. Its connection state and handshake
 * are explicitly SIMULATED (the honesty marker on every state it
 * produces); it can never be mistaken for a real GitHub connection.
 *
 * The fixture dataset is static and revision-pinned: fixed repository
 * slugs, fixed branch heads, fixed 40-hex commit shas, fixed trees. No
 * Date.now, no Math.random — every instant is caller-supplied.
 */

import type {
  GitHubCapabilitySurface,
  GitHubOperationOutcome,
} from './capabilities.ts';
import { buildCapabilitySurface, unsupportedOutcome } from './capabilities.ts';
import type {
  BeginGitHubConnectionInput,
  CompleteGitHubConnectionInput,
  CompleteGitHubConnectionResult,
  GitHubConnectionAuthorization,
  GitHubConnectionScope,
  GitHubConnectionState,
} from './connection.ts';
import { GITHUB_ONBOARDING_READ_SCOPES } from './connection.ts';
import type {
  BranchRef,
  CommitFilesInput,
  CommitRef,
  CreateBranchInput,
  CreatePullRequestInput,
  GitHubAdapterDescriptor,
  GitHubPort,
  ImportedRevision,
  PullRequestRef,
  RegisterWebhookInput,
  RepositoryId,
  RepositorySnapshot,
  RepositorySummary,
  SnapshotRefSelection,
  SnapshotTreeEntry,
  WebhookRegistration,
} from './port.ts';
import { repositorySlug } from './port.ts';

/** The reference provider's stable id. */
export const GITHUB_REFERENCE_PROVIDER_ID = 'github-reference';

/** One in-memory fixture repository. */
export interface ReferenceRepositoryFixture {
  id: RepositoryId;
  visibility: 'public' | 'private';
  description: string | null;
  /** Branch heads in display order; empty for an empty repository. */
  branches: { name: string; head_sha: string; is_protected: boolean }[];
  /** The file tree of the default branch head (empty for an empty repository). */
  tree: SnapshotTreeEntry[];
  webhooks_supported: boolean;
  pushed_at: string | null;
}

/**
 * The reference fixture dataset — static, deterministic, revision-pinned
 * (the DEMO discipline of the view layer; this is the provider layer's
 * equivalent). 'acme/empty-repo' exercises empty-repository detection;
 * 'acme/archived-docs' exercises typed UNSUPPORTED webhook registration
 * (webhooks not supported); 'acme/legacy-checkout' is the full journey
 * repository.
 */
export function referenceRepositoryFixtures(): ReferenceRepositoryFixture[] {
  return [
    {
      id: { owner: 'acme', name: 'legacy-checkout' },
      visibility: 'private',
      description: 'The existing checkout service (brownfield journey fixture).',
      branches: [
        { name: 'main', head_sha: 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7', is_protected: true },
        { name: 'release/1.2', head_sha: 'dead00beef1234567890abcdef0123456789abcd', is_protected: true },
        { name: 'feature/beta-optin', head_sha: 'feedface0011223344556677889900aabbccdde0', is_protected: false },
      ],
      tree: [
        { path: 'README.md', type: 'file', size_bytes: 1204 },
        { path: 'package.json', type: 'file', size_bytes: 742 },
        { path: 'src', type: 'dir', size_bytes: null },
        { path: 'src/checkout.ts', type: 'file', size_bytes: 8211 },
        { path: 'src/payments.ts', type: 'file', size_bytes: 12045 },
        { path: 'tests', type: 'dir', size_bytes: null },
        { path: 'tests/checkout.test.ts', type: 'file', size_bytes: 5033 },
      ],
      webhooks_supported: true,
      pushed_at: '2025-06-10T09:30:00Z',
    },
    {
      id: { owner: 'acme', name: 'empty-repo' },
      visibility: 'private',
      description: 'A freshly-created empty repository (greenfield journey fixture).',
      branches: [],
      tree: [],
      webhooks_supported: true,
      pushed_at: null,
    },
    {
      id: { owner: 'acme', name: 'archived-docs' },
      visibility: 'public',
      description: 'An archived docs mirror (webhooks NOT supported — the typed UNSUPPORTED fixture).',
      branches: [{ name: 'gh-pages', head_sha: 'abc123def4567890abcdef0123456789abcdef01', is_protected: false }],
      tree: [
        { path: 'index.html', type: 'file', size_bytes: 2048 },
        { path: 'guide.md', type: 'file', size_bytes: 5110 },
      ],
      webhooks_supported: false,
      pushed_at: '2025-05-02T14:00:00Z',
    },
  ];
}

/** Options for the reference provider. */
export interface InMemoryGitHubProviderOptions {
  /** The repositories to serve (defaults to referenceRepositoryFixtures()). */
  repositories?: ReferenceRepositoryFixture[];
  /**
   * The capability mask (defaults to every capability). Pass a reduced
   * set (e.g. the read preset) to exercise typed UNSUPPORTED outcomes.
   */
  supportedCapabilities?: readonly GitHubCapabilityName[];
  /** The connected_at literal handed to simulated handshakes (default: a static fixture instant). */
  simulatedConnectedAt?: string;
}

type GitHubCapabilityName = Parameters<GitHubCapabilitySurface['supported']['includes']>[0];

const ALL_CAPABILITIES = [
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
] as const;

/**
 * The in-memory reference GitHubPort. Deterministic; no network; every
 * state it produces carries simulated: true.
 */
export class InMemoryGitHubProvider implements GitHubPort {
  readonly descriptor: GitHubAdapterDescriptor;
  private readonly repositories: ReferenceRepositoryFixture[];
  private readonly capabilitySurface: GitHubCapabilitySurface;
  private readonly simulatedConnectedAt: string;
  private connectionState: GitHubConnectionState;
  private readonly webhooks: WebhookRegistration[] = [];
  private readonly openPullRequests: PullRequestRef[] = [];
  private nextPullRequestNumber = 3;
  private nextWebhookId = 41;
  private nextCommitSequence = 7;

  constructor(options: InMemoryGitHubProviderOptions = {}) {
    this.repositories = options.repositories ?? referenceRepositoryFixtures();
    this.simulatedConnectedAt = options.simulatedConnectedAt ?? '2025-06-15T12:00:00Z';
    const supported = options.supportedCapabilities ?? ALL_CAPABILITIES;
    this.capabilitySurface = buildCapabilitySurface({
      provider_id: GITHUB_REFERENCE_PROVIDER_ID,
      supported,
      note: supported.length === ALL_CAPABILITIES.length
        ? 'The in-memory reference provider supports every GitHubPort capability; all of its states are SIMULATED (never a real GitHub connection).'
        : 'A reduced-capability reference provider: the missing capabilities answer with explicit typed UNSUPPORTED outcomes (never silent failures).',
    });
    this.descriptor = {
      provider_id: GITHUB_REFERENCE_PROVIDER_ID,
      adapter_contract: 'ProjectAdapter',
      note: 'In-memory deterministic reference provider (SIMULATED states; no network; fixtures revision-pinned).',
    };
    this.connectionState = {
      status: 'NOT_YET_CONNECTED',
      simulated: true,
      provider_id: GITHUB_REFERENCE_PROVIDER_ID,
      granted_scopes: [],
      connected_at: null,
      note: 'The reference provider is not connected yet — begin the simulated handshake to connect it (this is never a real GitHub connection).',
    };
  }

  capabilities(): GitHubCapabilitySurface {
    return this.capabilitySurface;
  }

  connection(): GitHubConnectionState {
    return this.connectionState;
  }

  beginConnection(input: BeginGitHubConnectionInput): GitHubConnectionAuthorization {
    if (!this.capabilitySurface.supported.includes('connection')) {
      throw new Error('beginConnection: the connection capability is not supported by this provider');
    }
    for (const scope of input.scopes) {
      if (scope === undefined) {
        throw new Error('beginConnection: scopes must be well-formed scope tokens');
      }
    }
    const requestedScopes: GitHubConnectionScope[] =
      input.scopes.length > 0 ? [...input.scopes] : [...GITHUB_ONBOARDING_READ_SCOPES];
    return {
      authorization_ref: `ref-auth-${requestedScopes.length}-${input.state_token.length}`,
      authorization_url: `https://simulated.github.invalid/authorize?state=${encodeURIComponent(input.state_token)}`,
      requested_scopes: requestedScopes,
      simulated: true,
      note: 'SIMULATED authorization surface — the reference provider completes the handshake deterministically; no real GitHub consent page is involved.',
    };
  }

  completeConnection(input: CompleteGitHubConnectionInput): CompleteGitHubConnectionResult {
    if (!this.capabilitySurface.supported.includes('connection')) {
      throw new Error('completeConnection: the connection capability is not supported by this provider');
    }
    if (input.authorization_code.length === 0) {
      return { status: 'REFUSED', reason: 'The simulated handshake refused an empty authorization code (fail-closed).' };
    }
    this.connectionState = {
      status: 'CONNECTED',
      simulated: true,
      provider_id: GITHUB_REFERENCE_PROVIDER_ID,
      granted_scopes: [...GITHUB_ONBOARDING_READ_SCOPES],
      connected_at: input.completed_at,
      note: 'SIMULATED connection over the in-memory reference provider — least-privilege read scopes granted. This is never presented as a real GitHub connection.',
    };
    return { status: 'CONNECTED', connection: this.connectionState };
  }

  async discoverRepositories(): Promise<GitHubOperationOutcome<RepositorySummary[]>> {
    if (!this.capabilitySurface.supported.includes('repository-discovery')) {
      return unsupportedOutcome('repository-discovery', GITHUB_REFERENCE_PROVIDER_ID, 'This reference provider was built without repository discovery.');
    }
    const summaries: RepositorySummary[] = this.repositories.map((repo) => {
      const defaultBranch = repo.branches[0]?.name ?? null;
      return {
        id: repo.id,
        visibility: repo.visibility,
        description: repo.description,
        default_branch: defaultBranch,
        is_empty: repo.branches.length === 0,
        webhooks_supported: repo.webhooks_supported,
        pushed_at: repo.pushed_at,
      };
    });
    return { status: 'OK', result: summaries };
  }

  async listBranches(repository: RepositoryId): Promise<GitHubOperationOutcome<BranchRef[]>> {
    if (!this.capabilitySurface.supported.includes('branch-selection')) {
      return unsupportedOutcome('branch-selection', GITHUB_REFERENCE_PROVIDER_ID, 'This reference provider was built without branch selection.');
    }
    const repo = this.findRepository(repository);
    if (repo === null) {
      return unsupportedOutcome('branch-selection', GITHUB_REFERENCE_PROVIDER_ID, `Repository not found: ${repositorySlug(repository)}`);
    }
    return { status: 'OK', result: repo.branches.map((branch) => ({ ...branch })) };
  }

  async getRepositorySnapshot(
    repository: RepositoryId,
    ref: SnapshotRefSelection,
    capturedAt: string,
  ): Promise<GitHubOperationOutcome<RepositorySnapshot>> {
    if (!this.capabilitySurface.supported.includes('revision-selection') || !this.capabilitySurface.supported.includes('snapshot-import')) {
      return unsupportedOutcome('snapshot-import', GITHUB_REFERENCE_PROVIDER_ID, 'This reference provider was built without snapshot import.');
    }
    const repo = this.findRepository(repository);
    if (repo === null) {
      return unsupportedOutcome('snapshot-import', GITHUB_REFERENCE_PROVIDER_ID, `Repository not found: ${repositorySlug(repository)}`);
    }
    if (repo.branches.length === 0) {
      if (ref.branch !== undefined && ref.branch !== null) {
        return unsupportedOutcome('revision-selection', GITHUB_REFERENCE_PROVIDER_ID, `Repository ${repositorySlug(repository)} is empty — no branch or revision exists to select (empty-repository detection).`);
      }
      return {
        status: 'OK',
        result: {
          repository: repo.id,
          ref: { branch: '', sha: '' },
          is_empty: true,
          captured_at: capturedAt,
          tree: [],
          file_count: 0,
          description: repo.description,
          default_branch: null,
        },
      };
    }
    const branch =
      ref.branch !== undefined && ref.branch !== null
        ? repo.branches.find((candidate) => candidate.name === ref.branch)
        : repo.branches[0];
    if (branch === undefined) {
      return unsupportedOutcome('revision-selection', GITHUB_REFERENCE_PROVIDER_ID, `Branch not found in ${repositorySlug(repository)}: ${JSON.stringify(ref.branch ?? '(default)')}`);
    }
    let sha = branch.head_sha;
    if (ref.sha !== undefined && ref.sha !== null) {
      const known = repo.branches.some((candidate) => candidate.head_sha === ref.sha);
      if (!known) {
        return unsupportedOutcome('revision-selection', GITHUB_REFERENCE_PROVIDER_ID, `Revision not found in ${repositorySlug(repository)}: ${ref.sha}`);
      }
      sha = ref.sha;
    }
    return {
      status: 'OK',
      result: {
        repository: repo.id,
        ref: { branch: branch.name, sha },
        is_empty: false,
        captured_at: capturedAt,
        tree: repo.tree.map((entry) => ({ ...entry })),
        file_count: repo.tree.filter((entry) => entry.type === 'file').length,
        description: repo.description,
        default_branch: repo.branches[0]?.name ?? null,
      },
    };
  }

  importSnapshot(snapshot: RepositorySnapshot): ImportedRevision {
    if (snapshot.is_empty) {
      return {
        repository: snapshot.repository,
        branch: '',
        revision: { kind: 'git-sha', value: '' },
      };
    }
    return {
      repository: snapshot.repository,
      branch: snapshot.ref.branch,
      revision: { kind: 'git-sha', value: snapshot.ref.sha },
    };
  }

  async registerWebhook(input: RegisterWebhookInput): Promise<GitHubOperationOutcome<WebhookRegistration>> {
    if (!this.capabilitySurface.supported.includes('webhook-registration')) {
      return unsupportedOutcome('webhook-registration', GITHUB_REFERENCE_PROVIDER_ID, 'This reference provider was built without webhook registration.');
    }
    const repo = this.findRepository(input.repository);
    if (repo === null) {
      return unsupportedOutcome('webhook-registration', GITHUB_REFERENCE_PROVIDER_ID, `Repository not found: ${repositorySlug(input.repository)}`);
    }
    if (!repo.webhooks_supported) {
      return unsupportedOutcome(
        'webhook-registration',
        GITHUB_REFERENCE_PROVIDER_ID,
        `Repository ${repositorySlug(input.repository)} does not support webhook registration (where supported — an explicit UNSUPPORTED, never a silent failure).`,
      );
    }
    const registration: WebhookRegistration = {
      webhook_id: `ref-hook-${this.nextWebhookId}`,
      repository: repo.id,
      url: input.url,
      events: [...input.events],
      active: true,
    };
    this.nextWebhookId += 1;
    this.webhooks.push(registration);
    return { status: 'OK', result: registration };
  }

  async createBranch(input: CreateBranchInput): Promise<GitHubOperationOutcome<BranchRef>> {
    if (!this.capabilitySurface.supported.includes('branch-creation')) {
      return unsupportedOutcome('branch-creation', GITHUB_REFERENCE_PROVIDER_ID, 'This reference provider was built without branch creation.');
    }
    const repo = this.findRepository(input.repository);
    if (repo === null) {
      return unsupportedOutcome('branch-creation', GITHUB_REFERENCE_PROVIDER_ID, `Repository not found: ${repositorySlug(input.repository)}`);
    }
    if (repo.branches.length === 0) {
      return unsupportedOutcome('branch-creation', GITHUB_REFERENCE_PROVIDER_ID, `Repository ${repositorySlug(input.repository)} is empty — there is no revision to branch from.`);
    }
    if (!repo.branches.some((candidate) => candidate.head_sha === input.from_sha)) {
      return unsupportedOutcome('branch-creation', GITHUB_REFERENCE_PROVIDER_ID, `Revision to branch from not found: ${input.from_sha}`);
    }
    if (repo.branches.some((candidate) => candidate.name === input.name)) {
      return unsupportedOutcome('branch-creation', GITHUB_REFERENCE_PROVIDER_ID, `Branch already exists: ${input.name}`);
    }
    const branch: BranchRef = { name: input.name, head_sha: input.from_sha, is_protected: false };
    repo.branches.push(branch);
    return { status: 'OK', result: { ...branch } };
  }

  async commitFiles(input: CommitFilesInput): Promise<GitHubOperationOutcome<CommitRef>> {
    if (!this.capabilitySurface.supported.includes('commit-operations')) {
      return unsupportedOutcome('commit-operations', GITHUB_REFERENCE_PROVIDER_ID, 'This reference provider was built without commit operations.');
    }
    const repo = this.findRepository(input.repository);
    if (repo === null) {
      return unsupportedOutcome('commit-operations', GITHUB_REFERENCE_PROVIDER_ID, `Repository not found: ${repositorySlug(input.repository)}`);
    }
    const branch = repo.branches.find((candidate) => candidate.name === input.branch);
    if (branch === undefined) {
      // The initial commit on an EMPTY repository creates its first branch
      // (the provider-neutral contents-API behavior): an empty repository
      // has no branch to select until its first commit lands.
      if (repo.branches.length !== 0) {
        return unsupportedOutcome('commit-operations', GITHUB_REFERENCE_PROVIDER_ID, `Branch not found in ${repositorySlug(input.repository)}: ${input.branch}`);
      }
    }
    const parentSha = branch === undefined ? '' : branch.head_sha;
    const sha = this.deterministicCommitSha(parentSha, input.files.map((file) => file.path).join('|'));
    const commit: CommitRef = {
      repository: repo.id,
      branch: input.branch,
      sha,
      message: input.message,
      committed_at: '2025-06-15T12:00:00Z',
    };
    if (branch === undefined) {
      repo.branches.push({ name: input.branch, head_sha: sha, is_protected: false });
    } else {
      branch.head_sha = sha;
    }
    for (const file of input.files) {
      const existing = repo.tree.find((entry) => entry.path === file.path);
      if (existing === undefined) {
        repo.tree.push({ path: file.path, type: 'file', size_bytes: file.contents.length });
      } else {
        existing.size_bytes = file.contents.length;
      }
    }
    return { status: 'OK', result: commit };
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<GitHubOperationOutcome<PullRequestRef>> {
    if (!this.capabilitySurface.supported.includes('pull-request-operations')) {
      return unsupportedOutcome('pull-request-operations', GITHUB_REFERENCE_PROVIDER_ID, 'This reference provider was built without pull-request operations.');
    }
    const repo = this.findRepository(input.repository);
    if (repo === null) {
      return unsupportedOutcome('pull-request-operations', GITHUB_REFERENCE_PROVIDER_ID, `Repository not found: ${repositorySlug(input.repository)}`);
    }
    const head = repo.branches.find((candidate) => candidate.name === input.head_branch);
    const base = repo.branches.find((candidate) => candidate.name === input.base_branch);
    if (head === undefined || base === undefined) {
      return unsupportedOutcome('pull-request-operations', GITHUB_REFERENCE_PROVIDER_ID, `Head or base branch not found in ${repositorySlug(input.repository)}: ${input.head_branch} -> ${input.base_branch}`);
    }
    const pullRequest: PullRequestRef = {
      repository: repo.id,
      number: this.nextPullRequestNumber,
      title: input.title,
      head_branch: input.head_branch,
      base_branch: input.base_branch,
      head_sha: head.head_sha,
      state: 'open',
      url: `https://simulated.github.invalid/${repositorySlug(repo.id)}/pull/${this.nextPullRequestNumber}`,
    };
    this.nextPullRequestNumber += 1;
    this.openPullRequests.push(pullRequest);
    return { status: 'OK', result: pullRequest };
  }

  /** The webhook registrations recorded so far (deterministic, ordered). */
  recordedWebhooks(): WebhookRegistration[] {
    return this.webhooks.map((webhook) => ({ ...webhook }));
  }

  /** The pull requests opened so far (deterministic, ordered). */
  recordedPullRequests(): PullRequestRef[] {
    return this.openPullRequests.map((pullRequest) => ({ ...pullRequest }));
  }

  private findRepository(repository: RepositoryId): ReferenceRepositoryFixture | null {
    return this.repositories.find((repo) => repo.id.owner === repository.owner && repo.id.name === repository.name) ?? null;
  }

  /**
   * A deterministic commit sha derivation over the parent sha + touched
   * paths (a stable fixture derivation — NOT a cryptographic claim; the
   * reference provider never pretends otherwise).
   */
  private deterministicCommitSha(parentSha: string, touchedPaths: string): string {
    let hash = 0;
    const input = `${parentSha}:${touchedPaths}:${this.nextCommitSequence}`;
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      hash = (hash * 31 + code) % 0xffffffff;
    }
    this.nextCommitSequence += 1;
    return hash.toString(16).padStart(8, '0').repeat(5).slice(0, 40);
  }
}

/** Construct the in-memory reference provider (the ergonomic factory). */
export function createInMemoryGitHubProvider(options: InMemoryGitHubProviderOptions = {}): InMemoryGitHubProvider {
  return new InMemoryGitHubProvider(options);
}
