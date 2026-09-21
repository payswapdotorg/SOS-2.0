/**
 * The P4 provider-neutral GitHub repository vocabulary, carried
 * STRUCTURALLY (Work Order P8).
 *
 * @sos-2/github is a frozen zero-dependency, no-build package (the P4
 * lockfile byte-identity rule): built workspace packages cannot link it
 * as a dependency. The repository-sanctioned pattern (the
 * web-contracts/onboarding precedent, and the P3/P5 by-spec alignment
 * precedent) is to carry the provider-neutral shapes STRUCTURALLY with
 * NO dependency edge and pin the alignment by test — the acceptance
 * suite (tests/harness-adapters) imports the REAL P4 github sources and
 * asserts field-for-field structural compatibility.
 *
 * The shapes mirror @sos-2/github exactly:
 *   RepositoryId, BranchRef, CreateBranchInput, CommitFilesInput,
 *   CommitRef, CreatePullRequestInput, PullRequestRef,
 *   GitHubConnectionState (+ GITHUB_CONNECTION_STATUSES),
 *   GitHubOperationOutcome, GITHUB_ONBOARDING_WRITE_SCOPES,
 *   repositorySlug — the provider-neutral repository vocabulary the
 *   GitHub-aware project body executes typed records through.
 */

/** The provider-neutral repository coordinates { owner, name }. */
export interface RepositoryId {
  readonly owner: string;
  readonly name: string;
}

/** A branch reference (branch + revision selection). */
export interface BranchRef {
  readonly name: string;
  readonly head_sha: string;
  readonly is_protected: boolean;
}

/** Input for creating a branch. */
export interface CreateBranchInput {
  readonly repository: RepositoryId;
  readonly name: string;
  /** The sha to branch from (revision selection); must exist. */
  readonly from_sha: string;
}

/** Input for committing files to a branch (the contents-API write path). */
export interface CommitFilesInput {
  readonly repository: RepositoryId;
  readonly branch: string;
  readonly message: string;
  readonly files: readonly { path: string; contents: string }[];
}

/** A created commit (a typed record). */
export interface CommitRef {
  readonly repository: RepositoryId;
  readonly branch: string;
  readonly sha: string;
  readonly message: string;
  readonly committed_at: string;
}

/** Input for opening a pull request. */
export interface CreatePullRequestInput {
  readonly repository: RepositoryId;
  readonly title: string;
  readonly head_branch: string;
  readonly base_branch: string;
  readonly body: string | null;
}

/** An opened pull request (a typed record). */
export interface PullRequestRef {
  readonly repository: RepositoryId;
  readonly number: number;
  readonly title: string;
  readonly head_branch: string;
  readonly base_branch: string;
  readonly head_sha: string;
  readonly state: 'open' | 'closed';
  readonly url: string;
}

/**
 * The connection statuses (the P4 vocabulary). NOT_YET_CONNECTED is the
 * honest real-system state until a real handshake completes; UNAVAILABLE
 * and UNKNOWN remain the truthful provider-outage/undetermined states.
 */
export const GITHUB_CONNECTION_STATUSES = [
  'NOT_YET_CONNECTED',
  'CONNECTED',
  'EXPIRED',
  'REVOKED',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;

export type GitHubConnectionStatus = (typeof GITHUB_CONNECTION_STATUSES)[number];

/** The least-privilege provider-neutral repository scope tokens (the P4 vocabulary). */
export const GITHUB_CONNECTION_SCOPES = [
  'repository:metadata:read',
  'repository:contents:read',
  'repository:contents:write',
  'repository:pull-requests:write',
  'repository:webhooks:manage',
] as const;

export type GitHubConnectionScope = (typeof GITHUB_CONNECTION_SCOPES)[number];

/** The write preset for the implementation journey (branch/commit/PR). */
export const GITHUB_ONBOARDING_WRITE_SCOPES: readonly GitHubConnectionScope[] = [
  'repository:metadata:read',
  'repository:contents:read',
  'repository:contents:write',
  'repository:pull-requests:write',
];

/** The connection state of the backing provider (simulated is the honesty marker). */
export interface GitHubConnectionState {
  readonly status: GitHubConnectionStatus;
  /** True when this state comes from a reference/simulated provider (never a real connection). */
  readonly simulated: boolean;
  readonly provider_id: string;
  readonly granted_scopes: readonly GitHubConnectionScope[];
  readonly connected_at: string | null;
  readonly note: string;
}

/**
 * The typed outcome of one repository operation: OK with the typed
 * record, or an EXPLICIT UNSUPPORTED answer naming the missing provider
 * capability (never a silent failure, never a fabricated success).
 */
export type GitHubOperationOutcome<T> =
  | { status: 'OK'; result: T }
  | { status: 'UNSUPPORTED'; capability: string; provider_id: string; reason: string };

/** Render the provider-neutral repository slug 'owner/name'. */
export function repositorySlug(id: RepositoryId): string {
  return `${id.owner}/${id.name}`;
}

/** Parse the provider-neutral repository slug 'owner/name' (throws on malformed input). */
export function parseRepositorySlug(slug: string): RepositoryId {
  const parts = slug.split('/');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw new Error(`repository slug must be 'owner/name', received: ${JSON.stringify(slug)}`);
  }
  const [owner, name] = parts;
  if (owner.length === 0 || name.length === 0 || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(`repository slug must be 'owner/name' with owner/name of [A-Za-z0-9_.-], received: ${JSON.stringify(slug)}`);
  }
  return { owner, name };
}
