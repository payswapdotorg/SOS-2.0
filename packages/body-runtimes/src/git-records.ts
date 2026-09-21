/**
 * Typed git operation records (Work Order P8) — the simulated repository
 * state shared by the reference bodies.
 *
 * The bodies never shell out to git: branch/commit/push/PR operations are
 * TYPED RECORDS in an in-memory per-task repository state (deterministic
 * refs, deterministic diffs). Real provider repository operations (the
 * GitHub-aware body) map the SAME record shapes onto the P4 GitHubPort;
 * the disposable cloud body keeps them body-side (the advertisement
 * honestly carries no runtime/cloud integration).
 */

import type { JsonValue } from '@sos-2/semantic-spine';

/** One typed commit record. */
export interface GitCommitRecord {
  readonly commit_ref: string;
  readonly message: string;
  /** The committed paths (deterministic sorted order). */
  readonly paths: readonly string[];
}

/** One typed push record. */
export interface GitPushRecord {
  readonly remote: string;
  readonly ref: string;
  readonly pushed_ref: string;
}

/** One typed pull-request record. */
export interface GitPullRequestRecord {
  readonly pull_request_ref: string;
  readonly title: string;
  readonly source_branch: string;
  readonly target_branch: string;
  readonly url: string | null;
}

/** The per-task simulated repository state (typed records only). */
export interface GitSessionState {
  /** The current branch. */
  branch: string;
  /** The typed commit log (append-only, deterministic refs). */
  commits: GitCommitRecord[];
  /** The typed push log. */
  pushes: GitPushRecord[];
  /** The typed pull-request log. */
  pullRequests: GitPullRequestRecord[];
  /** The committed snapshot (path -> content at HEAD). */
  head: Map<string, string>;
}

/** Create a fresh git session state on a base branch. */
export function createGitSessionState(baseBranch: string, baseSnapshot: ReadonlyMap<string, string> = new Map()): GitSessionState {
  return {
    branch: baseBranch,
    commits: [],
    pushes: [],
    pullRequests: [],
    head: new Map(baseSnapshot),
  };
}

/** Deterministic commit ref for a session sequence number. */
export function commitRefFor(sequence: number): string {
  return `commit-${String(sequence).padStart(3, '0')}`;
}

/** Deterministic pull-request ref for a session sequence number. */
export function pullRequestRefFor(sequence: number): string {
  return `pr-${String(sequence).padStart(3, '0')}`;
}

/**
 * The deterministic working-tree diff between the sandbox workspace and
 * the HEAD snapshot — a stable unified-ish record (sorted paths; '-' for
 * removed lines, '+' for added lines).
 */
export function renderWorkspaceDiff(workspace: ReadonlyMap<string, string>, head: ReadonlyMap<string, string>): string {
  const paths = [...new Set([...workspace.keys(), ...head.keys()])].sort();
  const chunks: string[] = [];
  for (const path of paths) {
    const current = workspace.get(path);
    const previous = head.get(path);
    if (current === previous) {
      continue;
    }
    const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
    if (previous !== undefined) {
      for (const line of previous.split('\n')) {
        lines.push(`-${line}`);
      }
    }
    if (current !== undefined) {
      for (const line of current.split('\n')) {
        lines.push(`+${line}`);
      }
    }
    chunks.push(lines.join('\n'));
  }
  return chunks.join('\n');
}

/** The changed paths of the working tree versus HEAD (deterministic order). */
export function changedPaths(workspace: ReadonlyMap<string, string>, head: ReadonlyMap<string, string>): string[] {
  const paths = [...new Set([...workspace.keys(), ...head.keys()])].sort();
  return paths.filter((path) => workspace.get(path) !== head.get(path));
}

/** Serialize the typed git records as canonical-JSON-safe data (audit; never carries secret values). */
export function gitRecordsSummary(state: GitSessionState): JsonValue {
  return {
    branch: state.branch,
    commits: state.commits.map((commit) => ({ commit_ref: commit.commit_ref, message: commit.message, paths: [...commit.paths] })),
    pushes: state.pushes.map((push) => ({ pushed_ref: push.pushed_ref })),
    pull_requests: state.pullRequests.map((pr) => ({ pull_request_ref: pr.pull_request_ref, title: pr.title, url: pr.url })),
  };
}
