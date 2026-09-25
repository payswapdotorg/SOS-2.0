/**
 * The minimal typed shapes of the GitHub REST API responses the real
 * adapter consumes (Work Order P17-B). Only the fields actually read
 * are typed — everything else is ignored honestly.
 *
 * These are ADAPTER-SIDE provider record types (the P4/W12 adapter
 * precedent): they never redefine frozen SOS semantics; they exist so
 * the real API responses are consumed through validated shapes instead
 * of blind casts.
 */

/** GET /user */
export interface GitHubUserRecord {
  readonly login: string;
}

/** One entry of GET /user/repos and POST /user/repos. */
export interface GitHubRepoRecord {
  readonly id: number;
  readonly name: string;
  readonly owner: { readonly login: string };
  readonly private: boolean;
  readonly description: string | null;
  /** Null for an empty repository (no commits yet). */
  readonly default_branch: string | null;
  readonly size: number;
  readonly pushed_at: string | null;
  readonly html_url: string;
  readonly created_at: string | null;
}

/** One entry of GET /repos/{o}/{r}/branches. */
export interface GitHubBranchRecord {
  readonly name: string;
  readonly commit: { readonly sha: string } | null;
  readonly protected: boolean;
}

/** GET /repos/{o}/{r}/git/ref/{ref} — the resolved ref. */
export interface GitHubRefRecord {
  readonly ref: string;
  readonly object: { readonly sha: string; readonly type: string };
}

/** One entry of the git trees API. */
export interface GitHubTreeEntryRecord {
  readonly path: string;
  readonly type: 'blob' | 'tree' | 'commit';
  readonly size?: number;
  readonly sha: string;
}

/** GET /repos/{o}/{r}/git/trees/{sha} (with ?recursive=1). */
export interface GitHubTreeRecord {
  readonly sha: string;
  readonly tree: readonly GitHubTreeEntryRecord[];
  readonly truncated: boolean;
}

/** POST /repos/{o}/{r}/git/blobs — the created blob. */
export interface GitHubBlobRecord {
  readonly sha: string;
}

/** POST /repos/{o}/{r}/git/commits — the created commit. */
export interface GitHubCommitRecord {
  readonly sha: string;
  readonly tree: { readonly sha: string } | null;
  readonly commit: { readonly message: string; readonly committer: { readonly date: string } };
  readonly html_url?: string;
}

/** The commit payload of PUT /repos/{o}/{r}/contents/{path} (201). */
export interface GitHubContentsCommitPayload {
  readonly commit: GitHubCommitRecord;
}

/** One file of the contents API GET. */
export interface GitHubContentsRecord {
  readonly path: string;
  readonly sha: string;
  readonly content?: string;
  readonly encoding?: string;
}

/** POST /repos/{o}/{r}/pulls and GET /repos/{o}/{r}/pulls/{n}. */
export interface GitHubPullRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly head: { readonly ref: string; readonly sha: string };
  readonly base: { readonly ref: string };
  readonly html_url: string;
  readonly merged_at: string | null;
  readonly created_at: string | null;
}

/** POST /repos/{o}/{r}/hooks — the created webhook. */
export interface GitHubHookRecord {
  readonly id: number;
  readonly active: boolean;
  readonly events: readonly string[];
  readonly config: { readonly url?: string };
}

/** GET /rate_limit — the resources the adapter probes. */
export interface GitHubRateLimitRecord {
  readonly resources: {
    readonly core?: { readonly limit: number; readonly remaining: number; readonly used: number; readonly reset: number };
  };
}

/** A GitHub API error body (message always present). */
export interface GitHubApiErrorRecord {
  readonly message: string;
  readonly documentation_url?: string;
}
