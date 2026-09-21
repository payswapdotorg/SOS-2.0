/**
 * The GitHubPort — the provider-neutral project adapter contract (Work
 * Order P4): connection, repository discovery, branch/revision
 * selection, empty-repository detection, snapshot/metadata import,
 * webhook registration (where supported) and PR/commit operations, all
 * behind one typed interface with an INJECTABLE request/transport port.
 *
 * Zero vendor SDK, zero external dependencies: a real backing provider
 * is a GitHubPort implementation over an injected GitHubRequestPort
 * (the HTTP seam); the in-memory reference provider (./reference.ts)
 * serves deterministic tests and local development. Every operation
 * answers with a typed GitHubOperationOutcome — unsupported operations
 * are EXPLICIT UNSUPPORTED, never silent failures.
 *
 * Determinism discipline: no Date.now / Math.random / fetch / ambient
 * process.env anywhere in this package. Every instant is a
 * caller-supplied RFC3339 literal; every id is either caller-supplied or
 * a static fixture literal.
 */

import type {
  BeginGitHubConnectionInput,
  CompleteGitHubConnectionInput,
  CompleteGitHubConnectionResult,
  GitHubConnectionAuthorization,
  GitHubConnectionState,
} from './connection.ts';
import type { GitHubCapabilitySurface, GitHubOperationOutcome } from './capabilities.ts';

/**
 * The injectable HTTP/request transport seam. A real provider maps each
 * GitHubPort operation onto typed requests through this port; tests
 * inject a scripted port with deterministic responses. NO network call
 * is ever made by this package itself.
 */
export interface GitHubRequestPort {
  request<TBody, TResult>(
    request: GitHubProviderRequest<TBody>,
  ): Promise<GitHubProviderResponse<TResult>>;
}

/** One typed provider request (method + path + query + body + headers). */
export interface GitHubProviderRequest<TBody> {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** The provider's request path (e.g. '/repos/{owner}/{repo}/branches'). */
  path: string;
  /** Query parameters, or null. */
  query: Record<string, string> | null;
  /** The request body, or null. */
  body: TBody | null;
  /** Request headers (secret values are injected by the transport adapter, never logged). */
  headers: Record<string, string>;
}

/** One typed provider response. */
export interface GitHubProviderResponse<TResult> {
  status: number;
  body: TResult | null;
}

/** The adapter descriptor — the W12 adapter-descriptor precedent, provider-neutral. */
export interface GitHubAdapterDescriptor {
  /** The backing provider's stable id (e.g. 'github-reference', 'github-real'). */
  provider_id: string;
  /** The adapter contract this implementation realizes. */
  adapter_contract: 'ProjectAdapter';
  /** One honest sentence about the backing provider. */
  note: string;
}

/** Provider-neutral repository coordinates. */
export interface RepositoryId {
  owner: string;
  name: string;
}

/** A discovered repository summary (discovery + empty detection live here). */
export interface RepositorySummary {
  id: RepositoryId;
  visibility: 'public' | 'private';
  description: string | null;
  /** The default branch name, or null when the repository is empty. */
  default_branch: string | null;
  /** True when the repository has no commits (empty-repository detection). */
  is_empty: boolean;
  /** Whether this repository supports webhook registration. */
  webhooks_supported: boolean;
  /** Last-push instant, RFC3339 literal, or null when empty/unknown. */
  pushed_at: string | null;
}

/** A branch reference (branch selection). */
export interface BranchRef {
  name: string;
  /** The exact head commit sha of the branch (revision selection). */
  head_sha: string;
  is_protected: boolean;
}

/** A single snapshot tree entry (metadata import). */
export interface SnapshotTreeEntry {
  path: string;
  type: 'file' | 'dir';
  size_bytes: number | null;
}

/** The snapshot/metadata import result — the exact repository identity + revision. */
export interface RepositorySnapshot {
  repository: RepositoryId;
  /** The exact ref the snapshot was captured from. */
  ref: { branch: string; sha: string };
  /** Empty-repository detection carried into the snapshot. */
  is_empty: boolean;
  /** The caller-supplied capture instant (RFC3339 literal; no hidden clocks). */
  captured_at: string;
  /** Imported metadata: the file tree summary (empty for an empty repository). */
  tree: SnapshotTreeEntry[];
  /** The number of files in the tree (derived, present for the view layer). */
  file_count: number;
  /** The repository description, or null. */
  description: string | null;
  /** The default branch name, or null when empty. */
  default_branch: string | null;
}

/** The imported revision link — the exact shape the onboarding journey links into System State. */
export interface ImportedRevision {
  repository: RepositoryId;
  branch: string;
  /** The revision kind is pinned by test to @sos-2/system-state's 'git-sha' (IMPLEMENTATION_REVISION_KIND). */
  revision: { kind: 'git-sha'; value: string };
}

/** Input for registering a webhook (where supported). */
export interface RegisterWebhookInput {
  repository: RepositoryId;
  /** The webhook receiver URL. */
  url: string;
  /** The events to subscribe to (e.g. push, pull_request). */
  events: string[];
}

/** A registered webhook. */
export interface WebhookRegistration {
  webhook_id: string;
  repository: RepositoryId;
  url: string;
  events: string[];
  active: boolean;
}

/** Input for creating a branch. */
export interface CreateBranchInput {
  repository: RepositoryId;
  /** The new branch name. */
  name: string;
  /** The sha to branch from (revision selection); must exist. */
  from_sha: string;
}

/** Input for committing files to a branch. */
export interface CommitFilesInput {
  repository: RepositoryId;
  branch: string;
  message: string;
  /** The files to write (path + exact contents). */
  files: { path: string; contents: string }[];
}

/** A created commit. */
export interface CommitRef {
  repository: RepositoryId;
  branch: string;
  sha: string;
  message: string;
  /** The caller-supplied commit instant (RFC3339 literal). */
  committed_at: string;
}

/** Input for opening a pull request. */
export interface CreatePullRequestInput {
  repository: RepositoryId;
  title: string;
  /** The branch to merge from. */
  head_branch: string;
  /** The branch to merge into. */
  base_branch: string;
  body: string | null;
}

/** An opened pull request. */
export interface PullRequestRef {
  repository: RepositoryId;
  number: number;
  title: string;
  head_branch: string;
  base_branch: string;
  head_sha: string;
  state: 'open' | 'closed';
  url: string;
}

/** The ref selection for a snapshot capture. */
export interface SnapshotRefSelection {
  branch?: string;
  sha?: string;
}

/**
 * The provider-neutral project adapter port. Implementations MUST:
 *
 *   - answer capabilities() honestly (the typed surface is the truth
 *     about what the backing provider can do);
 *   - return typed UNSUPPORTED outcomes for unsupported operations —
 *     never throw for an honest refusal, never fake a success;
 *   - carry empty-repository detection through discovery AND snapshots;
 *   - keep every instant caller-supplied (no hidden clocks).
 */
export interface GitHubPort {
  readonly descriptor: GitHubAdapterDescriptor;

  /** The typed capability surface of the backing provider. */
  capabilities(): GitHubCapabilitySurface;

  /** The current connection state (honestly NOT_YET_CONNECTED until a real handshake completes). */
  connection(): GitHubConnectionState;

  /** Begin the least-privilege connection handshake (the CONNECTION CONTRACT, not a live vendor flow). */
  beginConnection(input: BeginGitHubConnectionInput): GitHubConnectionAuthorization;

  /** Complete the handshake (CONNECTED with the granted scopes, or a typed REFUSED). */
  completeConnection(input: CompleteGitHubConnectionInput): CompleteGitHubConnectionResult;

  /** Discover repositories visible to the connection (empty detection included). */
  discoverRepositories(): Promise<GitHubOperationOutcome<RepositorySummary[]>>;

  /** List the branches of one repository (branch selection). */
  listBranches(repository: RepositoryId): Promise<GitHubOperationOutcome<BranchRef[]>>;

  /**
   * Capture the snapshot/metadata of one repository at an exact ref
   * (revision selection + empty detection + metadata import).
   */
  getRepositorySnapshot(
    repository: RepositoryId,
    ref: SnapshotRefSelection,
    capturedAt: string,
  ): Promise<GitHubOperationOutcome<RepositorySnapshot>>;

  /**
   * Import a snapshot: returns the exact repository identity/revision
   * link the journey persists into System State (the spine's identity
   * discipline owns the artifact side; this is the provider side).
   */
  importSnapshot(snapshot: RepositorySnapshot): ImportedRevision;

  /** Register a webhook (typed UNSUPPORTED where the repository or provider does not support it). */
  registerWebhook(input: RegisterWebhookInput): Promise<GitHubOperationOutcome<WebhookRegistration>>;

  /** Create a branch (revision selection + write path). */
  createBranch(input: CreateBranchInput): Promise<GitHubOperationOutcome<BranchRef>>;

  /** Commit files to a branch (write path). */
  commitFiles(input: CommitFilesInput): Promise<GitHubOperationOutcome<CommitRef>>;

  /** Open a pull request (write path). */
  createPullRequest(input: CreatePullRequestInput): Promise<GitHubOperationOutcome<PullRequestRef>>;
}

/** Parse a provider-neutral repository slug 'owner/name' (throws on malformed input). */
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

/** Render the provider-neutral repository slug 'owner/name'. */
export function repositorySlug(id: RepositoryId): string {
  return `${id.owner}/${id.name}`;
}
