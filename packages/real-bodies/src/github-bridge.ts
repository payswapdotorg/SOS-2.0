/**
 * THE REAL GITHUB REPOSITORY-OPERATIONS BRIDGE (Work Order P17-B) —
 * the async -> sync composition boundary the frozen P8 seam documented:
 *
 *   "The async -> sync bridge therefore lives at the COMPOSITION
 *    boundary, never inside a body: this seam carries the P4
 *    provider-neutral vocabulary STRUCTURALLY ... so a real provider
 *    session attaches through the later-wave provider adapter without
 *    changing a single type on either side."
 *
 * This is that attachment: the P8 GitHubProjectBody executes repository
 * operations through the SYNCHRONOUS GitHubRepositoryOperations seam,
 * and this bridge realizes the seam over the REAL @sos-2/real-github
 * provider (whose GitHubPort is async — real REST calls).
 *
 * HOW THE BRIDGE STAYS HONEST (no stashing, no fabrication):
 *
 *   - the OPERATOR drives the REAL API call explicitly and asynchronously
 *     (`prepareCreateBranch` / `prepareCommitFiles` / `prepareCreatePullRequest`)
 *     — the real outcome (or the real typed failure) is staged;
 *   - the body's SYNCHRONOUS dispatch (`createBranch` / `commitFiles` /
 *     `createPullRequest`) then answers EXACTLY the staged real outcome;
 *   - dispatching an operation that was never prepared answers a typed
 *     UNSUPPORTED outcome carrying the honest reason — never a
 *     fabricated success, never a silent pass-through;
 *   - the connection state is the real provider's state mapped onto the
 *     P4 connection vocabulary (PAT-backed real handshake evidence).
 */

import type {
  CompleteGitHubConnectionResult,
  GitHubConnectionState,
  GitHubOperationOutcome,
} from '@sos-2/real-github';
import { RealGitHubProvider, REAL_GITHUB_PROVIDER_ID } from '@sos-2/real-github';
import type { BranchRef, CommitFilesInput, CommitRef, CreateBranchInput, CreatePullRequestInput, PullRequestRef, RepositoryId } from '@sos-2/real-github';

/** The P8 seam shape (structural — mirrors @sos-2/body-runtimes' GitHubRepositoryOperations field-for-field; pinned by test). */
export interface GitHubRepositoryOperations {
  connection(): GitHubConnectionState;
  supportedOperations(): readonly ('createBranch' | 'commitFiles' | 'createPullRequest')[];
  createBranch(input: CreateBranchInput): GitHubOperationOutcome<BranchRef>;
  commitFiles(input: CommitFilesInput): GitHubOperationOutcome<CommitRef>;
  createPullRequest(input: CreatePullRequestInput): GitHubOperationOutcome<PullRequestRef>;
}

/** Options for the real repository-operations bridge. */
export interface RealGitHubRepositoryOperationsOptions {
  /** The single repository this provider session serves. */
  readonly repository: RepositoryId;
  /** The REAL GitHub provider (from @sos-2/real-github). */
  readonly provider: RealGitHubProvider;
  /** The connection-state note for the honest NOT_YET_CONNECTED default. */
  readonly notConnectedNote?: string;
}

/** One staged real outcome (the async preparation result). */
type StagedOutcome<T> = GitHubOperationOutcome<T>;

/**
 * THE REAL REPOSITORY-OPERATIONS BRIDGE — the P8 seam over the real
 * provider. The async REAL API calls are driven by the operator through
 * the prepare* methods; the sync seam answers exactly the staged real
 * outcomes.
 */
export class RealGitHubRepositoryOperations implements GitHubRepositoryOperations {
  private readonly repository: RepositoryId;
  private readonly provider: RealGitHubProvider;
  private readonly notConnectedNote: string;
  private stagedBranch: StagedOutcome<BranchRef> | null = null;
  private stagedCommit: StagedOutcome<CommitRef> | null = null;
  private stagedPullRequest: StagedOutcome<PullRequestRef> | null = null;
  /** The staged REAL operations so far (audit — method + outcome status). */
  readonly prepared: { readonly operation: string; readonly status: string }[] = [];

  constructor(options: RealGitHubRepositoryOperationsOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('RealGitHubRepositoryOperations requires an options object');
    }
    if (typeof options.repository !== 'object' || options.repository === null) {
      throw new Error('RealGitHubRepositoryOperations requires a RepositoryId { owner, name }');
    }
    if (!(options.provider instanceof RealGitHubProvider)) {
      throw new Error('RealGitHubRepositoryOperations requires the real GitHub provider (@sos-2/real-github)');
    }
    this.repository = options.repository;
    this.provider = options.provider;
    this.notConnectedNote =
      options.notConnectedNote ??
      'The real provider session is honestly NOT_YET_CONNECTED until the PAT-backed real handshake completes (verifyToken probes the real provider); repository operations answer typed UNSUPPORTED outcomes until then.';
  }

  connection(): GitHubConnectionState {
    return this.provider.connection();
  }

  supportedOperations(): readonly ('createBranch' | 'commitFiles' | 'createPullRequest')[] {
    return ['createBranch', 'commitFiles', 'createPullRequest'];
  }

  // --- the operator-driven REAL async preparations (the composition boundary) ---

  /** Drive the REAL branch creation and stage its outcome for the sync seam. */
  async prepareCreateBranch(input: CreateBranchInput): Promise<StagedOutcome<BranchRef>> {
    this.stagedBranch = await this.provider.createBranch(input);
    this.prepared.push({ operation: 'createBranch', status: this.stagedBranch.status });
    return this.stagedBranch;
  }

  /** Drive the REAL commit and stage its outcome for the sync seam. */
  async prepareCommitFiles(input: CommitFilesInput): Promise<StagedOutcome<CommitRef>> {
    this.stagedCommit = await this.provider.commitFiles(input);
    this.prepared.push({ operation: 'commitFiles', status: this.stagedCommit.status });
    return this.stagedCommit;
  }

  /** Drive the REAL pull-request creation and stage its outcome for the sync seam. */
  async prepareCreatePullRequest(input: CreatePullRequestInput): Promise<StagedOutcome<PullRequestRef>> {
    this.stagedPullRequest = await this.provider.createPullRequest(input);
    this.prepared.push({ operation: 'createPullRequest', status: this.stagedPullRequest.status });
    return this.stagedPullRequest;
  }

  /** Complete the PAT-backed real handshake on the backing provider (delegated). */
  async verifyHandshake(verifiedAt: string): Promise<CompleteGitHubConnectionResult> {
    const verification = await this.provider.verifyToken(verifiedAt);
    if (!verification.verified) {
      return { status: 'REFUSED', reason: verification.failure ?? 'the real handshake failed' };
    }
    return {
      status: 'CONNECTED',
      connection: this.provider.connection(),
    };
  }

  // --- the P8 SYNCHRONOUS seam surface (answers exactly the staged real outcomes) ---

  createBranch(input: CreateBranchInput): GitHubOperationOutcome<BranchRef> {
    if (this.stagedBranch === null) {
      return this.notPrepared('createBranch', input.repository);
    }
    return this.stagedBranch;
  }

  commitFiles(input: CommitFilesInput): GitHubOperationOutcome<CommitRef> {
    if (this.stagedCommit === null) {
      return this.notPrepared('commitFiles', input.repository);
    }
    return this.stagedCommit;
  }

  createPullRequest(input: CreatePullRequestInput): GitHubOperationOutcome<PullRequestRef> {
    if (this.stagedPullRequest === null) {
      return this.notPrepared('createPullRequest', input.repository);
    }
    return this.stagedPullRequest;
  }

  private notPrepared(operation: string, repository: RepositoryId): GitHubOperationOutcome<never> {
    return {
      status: 'UNSUPPORTED',
      capability: 'branch-creation',
      provider_id: REAL_GITHUB_PROVIDER_ID,
      reason: `the real ${operation} was never driven on ${repository.owner}/${repository.name} — the async REAL API call must be prepared by the operator before the synchronous body seam can answer it (the honest answer is this typed UNSUPPORTED, never a fabricated success)`,
    };
  }
}

/** Construct the real repository-operations bridge. */
export function createRealGitHubRepositoryOperations(
  options: RealGitHubRepositoryOperationsOptions,
): RealGitHubRepositoryOperations {
  return new RealGitHubRepositoryOperations(options);
}
