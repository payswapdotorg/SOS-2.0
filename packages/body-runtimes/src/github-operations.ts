/**
 * The GitHub repository-operations seam (Work Order P8) — the SYNCHRONOUS
 * provider-neutral repository port the GitHub-aware project body executes
 * repository operations through.
 *
 * WHY A SYNC SEAM: the frozen P5 §9 HarnessContract is synchronous by
 * design (bodies are in-process mechanisms; the ASYNC fabric/broker wrap
 * them), while the P4 GitHubPort surface is async (the onboarding/
 * project-adapter world). The async -> sync bridge therefore lives at the
 * COMPOSITION boundary, never inside a body: this seam carries the P4
 * provider-neutral vocabulary STRUCTURALLY (RepositoryId, BranchRef,
 * CreateBranchInput, CommitFilesInput, CommitRef, CreatePullRequestInput,
 * PullRequestRef, GitHubOperationOutcome, GitHubConnectionState — see
 * github-vocabulary.ts; the field-for-field alignment with the real P4
 * package is PINNED BY TEST in tests/harness-adapters) so a real provider
 * session attaches through the later-wave provider adapter
 * (@sos-2/harness-adapters) without changing a single type on either
 * side.
 *
 * The reference implementation (InMemoryGitHubRepositoryOperations) is a
 * deterministic in-memory repository with the P4 honesty markers: every
 * connection state it produces is explicitly SIMULATED, and the honest
 * real-system status is NOT_YET_CONNECTED until (a simulated) handshake
 * completes — connection evidence is NEVER fabricated.
 */

import { InvalidBodyRuntimeOptionsError } from './errors.js';
import type {
  BranchRef,
  CommitFilesInput,
  CommitRef,
  CreateBranchInput,
  CreatePullRequestInput,
  GitHubConnectionState,
  GitHubOperationOutcome,
  PullRequestRef,
  RepositoryId,
} from './github-vocabulary.js';
import { GITHUB_ONBOARDING_WRITE_SCOPES, repositorySlug } from './github-vocabulary.js';

/**
 * THE REPOSITORY OPERATIONS SEAM — branch/commit/PR operations as typed
 * records through the P4 provider-neutral github adapter vocabulary.
 */
export interface GitHubRepositoryOperations {
  /** The current connection state (honest NOT_YET_CONNECTED until a real handshake completes). */
  connection(): GitHubConnectionState;
  /** The write operations this provider session honestly supports (the binding subset). */
  supportedOperations(): readonly ('createBranch' | 'commitFiles' | 'createPullRequest')[];
  /** Create a branch (revision selection + write path). */
  createBranch(input: CreateBranchInput): GitHubOperationOutcome<BranchRef>;
  /** Commit files to a branch (the contents-API write path). */
  commitFiles(input: CommitFilesInput): GitHubOperationOutcome<CommitRef>;
  /** Open a pull request. */
  createPullRequest(input: CreatePullRequestInput): GitHubOperationOutcome<PullRequestRef>;
}

/** One branch fixture of the in-memory repository. */
export interface RepositoryBranchFixture {
  readonly name: string;
  readonly head_sha: string;
  readonly is_protected: boolean;
}

/** Options for the in-memory repository operations. */
export interface InMemoryRepositoryOperationsOptions {
  /** The single repository this provider session serves. */
  readonly repository: RepositoryId;
  /** The branch fixtures (deterministic, revision-pinned). */
  readonly branches: readonly RepositoryBranchFixture[];
  /** The backing provider id (default "github-repository-reference"). */
  readonly providerId?: string;
  /** Static fixture instant for simulated connection/commit records (caller-supplied literal). */
  readonly simulatedTimestamp?: string;
  /** Restrict the write capabilities (typed UNSUPPORTED outcomes for the rest). */
  readonly supportedOperations?: readonly ('createBranch' | 'commitFiles' | 'createPullRequest')[];
}

const DEFAULT_SIMULATED_TIMESTAMP = '2025-06-15T12:00:00Z';

/**
 * The in-memory reference repository operations — deterministic, offline,
 * every state explicitly SIMULATED (never a real GitHub connection).
 */
export class InMemoryGitHubRepositoryOperations implements GitHubRepositoryOperations {
  private readonly repository: RepositoryId;
  private readonly providerId: string;
  private readonly simulatedTimestamp: string;
  private readonly supported: ReadonlySet<string>;
  private readonly branches: { name: string; head_sha: string; is_protected: boolean }[];
  private readonly tree = new Map<string, number>();
  private connectionState: GitHubConnectionState;
  private nextPullRequestNumber = 7;
  private nextCommitSequence = 11;

  constructor(options: InMemoryRepositoryOperationsOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new InvalidBodyRuntimeOptionsError('repository-operations', 'repository operations options must be an object');
    }
    if (typeof options.repository !== 'object' || options.repository === null || typeof options.repository.owner !== 'string' || typeof options.repository.name !== 'string') {
      throw new InvalidBodyRuntimeOptionsError('repository-operations', 'repository operations require a RepositoryId { owner, name }');
    }
    if (
      !Array.isArray(options.branches) ||
      options.branches.length === 0 ||
      !options.branches.every(
        (branch) =>
          typeof branch.name === 'string' && branch.name.length > 0 && typeof branch.head_sha === 'string' && branch.head_sha.length > 0 && typeof branch.is_protected === 'boolean',
      )
    ) {
      throw new InvalidBodyRuntimeOptionsError('repository-operations', 'repository operations require at least one well-formed branch fixture');
    }
    this.repository = options.repository;
    this.providerId = options.providerId ?? 'github-repository-reference';
    this.simulatedTimestamp = options.simulatedTimestamp ?? DEFAULT_SIMULATED_TIMESTAMP;
    this.supported = new Set(options.supportedOperations ?? ['createBranch', 'commitFiles', 'createPullRequest']);
    this.branches = options.branches.map((branch) => ({ ...branch }));
    this.connectionState = {
      status: 'NOT_YET_CONNECTED',
      simulated: true,
      provider_id: this.providerId,
      granted_scopes: [],
      connected_at: null,
      note: 'The reference repository provider is not connected yet — complete the simulated handshake to connect it (this is never a real GitHub connection; real provider accounts are pending).',
    };
  }

  connection(): GitHubConnectionState {
    return this.connectionState;
  }

  supportedOperations(): readonly ('createBranch' | 'commitFiles' | 'createPullRequest')[] {
    return (['createBranch', 'commitFiles', 'createPullRequest'] as const).filter((operation) => this.supported.has(operation));
  }

  /**
   * Complete the (simulated) connection handshake — the P4 contract
   * shape: an empty authorization code is REFUSED (fail closed).
   */
  completeConnection(input: { authorization_code: string; completed_at: string }): { status: 'CONNECTED'; connection: GitHubConnectionState } | { status: 'REFUSED'; reason: string } {
    if (typeof input.authorization_code !== 'string' || input.authorization_code.length === 0) {
      return { status: 'REFUSED', reason: 'The simulated handshake refused an empty authorization code (fail closed).' };
    }
    this.connectionState = {
      status: 'CONNECTED',
      simulated: true,
      provider_id: this.providerId,
      granted_scopes: [...GITHUB_ONBOARDING_WRITE_SCOPES],
      connected_at: input.completed_at,
      note: 'SIMULATED connection over the in-memory reference repository provider — least-privilege write scopes granted. This is never presented as a real GitHub connection.',
    };
    return { status: 'CONNECTED', connection: this.connectionState };
  }

  createBranch(input: CreateBranchInput): GitHubOperationOutcome<BranchRef> {
    if (!this.supported.has('createBranch')) {
      return { status: 'UNSUPPORTED', capability: 'branch-creation', provider_id: this.providerId, reason: 'This reference repository provider was built without branch creation.' };
    }
    if (input.repository.owner !== this.repository.owner || input.repository.name !== this.repository.name) {
      return { status: 'UNSUPPORTED', capability: 'branch-creation', provider_id: this.providerId, reason: `Repository not served by this provider session: ${repositorySlug(input.repository)}` };
    }
    if (!this.branches.some((branch) => branch.head_sha === input.from_sha)) {
      return { status: 'UNSUPPORTED', capability: 'branch-creation', provider_id: this.providerId, reason: `Revision to branch from not found: ${input.from_sha}` };
    }
    if (this.branches.some((branch) => branch.name === input.name)) {
      return { status: 'UNSUPPORTED', capability: 'branch-creation', provider_id: this.providerId, reason: `Branch already exists: ${input.name}` };
    }
    const branch: BranchRef = { name: input.name, head_sha: input.from_sha, is_protected: false };
    this.branches.push({ ...branch });
    return { status: 'OK', result: { ...branch } };
  }

  commitFiles(input: CommitFilesInput): GitHubOperationOutcome<CommitRef> {
    if (!this.supported.has('commitFiles')) {
      return { status: 'UNSUPPORTED', capability: 'commit-operations', provider_id: this.providerId, reason: 'This reference repository provider was built without commit operations.' };
    }
    if (input.repository.owner !== this.repository.owner || input.repository.name !== this.repository.name) {
      return { status: 'UNSUPPORTED', capability: 'commit-operations', provider_id: this.providerId, reason: `Repository not served by this provider session: ${repositorySlug(input.repository)}` };
    }
    if (!Array.isArray(input.files) || input.files.length === 0) {
      return { status: 'UNSUPPORTED', capability: 'commit-operations', provider_id: this.providerId, reason: 'A commit requires at least one file (the contents-API write path).' };
    }
    const branch = this.branches.find((candidate) => candidate.name === input.branch);
    if (branch === undefined) {
      return { status: 'UNSUPPORTED', capability: 'commit-operations', provider_id: this.providerId, reason: `Branch not found in ${repositorySlug(this.repository)}: ${input.branch}` };
    }
    const sha = this.deterministicCommitSha(branch.head_sha, input.files.map((file) => file.path).join('|'));
    const commit: CommitRef = {
      repository: this.repository,
      branch: input.branch,
      sha,
      message: input.message,
      committed_at: this.simulatedTimestamp,
    };
    branch.head_sha = sha;
    for (const file of input.files) {
      this.tree.set(file.path, file.contents.length);
    }
    return { status: 'OK', result: commit };
  }

  createPullRequest(input: CreatePullRequestInput): GitHubOperationOutcome<PullRequestRef> {
    if (!this.supported.has('createPullRequest')) {
      return { status: 'UNSUPPORTED', capability: 'pull-request-operations', provider_id: this.providerId, reason: 'This reference repository provider was built without pull-request operations.' };
    }
    if (input.repository.owner !== this.repository.owner || input.repository.name !== this.repository.name) {
      return { status: 'UNSUPPORTED', capability: 'pull-request-operations', provider_id: this.providerId, reason: `Repository not served by this provider session: ${repositorySlug(input.repository)}` };
    }
    const head = this.branches.find((candidate) => candidate.name === input.head_branch);
    const base = this.branches.find((candidate) => candidate.name === input.base_branch);
    if (head === undefined || base === undefined) {
      return {
        status: 'UNSUPPORTED',
        capability: 'pull-request-operations',
        provider_id: this.providerId,
        reason: `Head or base branch not found in ${repositorySlug(this.repository)}: ${input.head_branch} -> ${input.base_branch}`,
      };
    }
    const pullRequest: PullRequestRef = {
      repository: this.repository,
      number: this.nextPullRequestNumber,
      title: input.title,
      head_branch: input.head_branch,
      base_branch: input.base_branch,
      head_sha: head.head_sha,
      state: 'open',
      url: `https://simulated.github.invalid/${repositorySlug(this.repository)}/pull/${this.nextPullRequestNumber}`,
    };
    this.nextPullRequestNumber += 1;
    return { status: 'OK', result: pullRequest };
  }

  /** The current branch fixtures (audit; deterministic order). */
  branchState(): readonly BranchRef[] {
    return this.branches.map((branch) => ({ ...branch }));
  }

  /**
   * A deterministic commit sha derivation over the parent sha + touched
   * paths (a stable fixture derivation — NOT a cryptographic claim).
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
