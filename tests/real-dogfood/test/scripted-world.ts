/**
 * THE SCRIPTED DOGFOOD WORLD (Work Order P19) — the deterministic,
 * offline world of the real-dogfood suite: the REAL adapters' SEAMS
 * scripted at the dogfood adapter boundaries, exactly the way the
 * tests/real-github + tests/real-bodies worlds script theirs. The REAL
 * harness logic (packages/dogfood-live — the staged-outcome executors,
 * the drive loop, the evaluator probes) runs VERBATIM over these seams:
 *
 *   - ScriptedGitHubApi: an in-memory GitHub REST simulator over the
 *     frozen GitHubRequestPort seam — repo creation, discovery with
 *     empty-repository detection, the contents-API initial commit on
 *     the empty repository, the Git Data API single-commit path, ref
 *     reads, branch creation, pull requests, and the tree/content reads
 *     at EXACT revisions (deterministic content-addressed shas);
 *   - ScriptedVercelFetch: an in-memory Vercel simulator over the
 *     FetchPort seam — the §0b-verified shapes (POST /v9/projects with
 *     gitRepository, PATCH ssoProtection null, POST /v13/deployments
 *     with gitSource {repoId, ref}, the GET /v13/deployments poll to
 *     READY);
 *   - the ScriptedHostedModelPort of @sos-2/real-bodies (the model
 *     responses per work program);
 *   - a scripted runtime fetch (the deployed URL serves the repository
 *     content at the exact revision);
 *   - scripted DNS/key probes.
 *
 * NO network, NO ambient time (a ManualClock at the fixed P19 epoch),
 * fixed vitest seed 424242 — run-to-run identical.
 */

import { contentAddress } from '@sos-2/action-gateway';
import type { FetchPort, HttpRequest, HttpResponse } from '@sos-2/deployment-providers';
import { jsonBody, responseText } from '@sos-2/deployment-providers';
import { ManualClock, formatRfc3339 } from '@sos-2/live-store';
import { ScriptedHostedModelPort } from '@sos-2/real-bodies';
import type { HostedModelPort, ScriptedModelEntry } from '@sos-2/real-bodies';
import type { GitHubProviderResponse, GitHubRequestPort } from '@sos-2/real-github';
import { createRealDogfoodHarness } from '@sos-2/dogfood-live';
import type { RealDogfoodHarness, DogfoodRuntimeFetch } from '@sos-2/dogfood-live';

/** The fixed P19 deterministic epoch: 2026-09-27T12:00:00Z. */
export const DOGFOOD_SCRIPTED_T0 = Date.parse('2026-09-27T12:00:00Z');

/** The scripted GitHub login (the whoami answer). */
export const SCRIPTED_GITHUB_LOGIN = 'payswapdotorg';

// ---------------------------------------------------------------------------
// The scripted GitHub REST simulator
// ---------------------------------------------------------------------------

interface ScriptedCommit {
  readonly sha: string;
  readonly message: string;
  readonly parent: string | null;
  /** The full file map at this commit (path -> contents). */
  readonly files: ReadonlyMap<string, string>;
  readonly committedAt: string;
}

interface ScriptedRepo {
  readonly name: string;
  readonly description: string | null;
  readonly branches: Map<string, string>; // branch -> head sha
  readonly commits: Map<string, ScriptedCommit>;
  readonly pullRequests: { number: number; title: string; head: string; base: string; body: string | null; state: string; headSha: string }[];
}

/**
 * The scripted GitHub REST API — one in-memory GitHub over the frozen
 * GitHubRequestPort seam. Deterministic content-addressed commit shas;
 * honest 404s; the exact response shapes the real provider parses.
 */
export class ScriptedGitHubApi implements GitHubRequestPort {
  private readonly repos = new Map<string, ScriptedRepo>();
  /** blob sha -> contents (the POST /git/blobs record — the Git Data API path resolves trees through these). */
  private readonly blobs = new Map<string, string>();
  /** tree sha -> file map (the POST /git/trees record — merged over base_tree, exactly the real semantics). */
  private readonly trees = new Map<string, ReadonlyMap<string, string>>();
  private readonly requestLog: { method: string; path: string; status: number }[] = [];
  /** Fixture: fail every commit operation whose message starts with 'repair:' (the REPAIR_UNAVAILABLE fixture). */
  public failRepairCommits = false;
  /** Fixture: reject repository creation (the honest provider-failure path). */
  public failRepoCreation = false;

  constructor() {
    // A decoy NON-EMPTY repository (the honest NOT_EMPTY discrimination).
    const decoy = this.ensureRepo('busy-repo', 'a non-empty decoy repository (deterministic fixture)');
    const files = new Map<string, string>([['README.md', '# busy repo\n']]);
    const sha = this.mintCommit('busy-repo', 'initial', null, files);
    decoy.branches.set('main', sha);
  }

  /** The recorded request log (audit: method + path + status; never bodies). */
  recordedRequests(): readonly { method: string; path: string; status: number }[] {
    return [...this.requestLog];
  }

  /** The repository state (test assertions). */
  repo(name: string): ScriptedRepo | undefined {
    return this.repos.get(name);
  }

  async request<TBody, TResult>(request: { method: string; path: string; query: Record<string, string> | null; body: TBody | null; headers: Record<string, string> }): Promise<GitHubProviderResponse<TResult>> {
    const result = this.route(request.method, request.path, request.query ?? {}, request.body);
    this.requestLog.push({ method: request.method, path: request.path, status: result.status });
    return result as GitHubProviderResponse<TResult>;
  }

  private route(method: string, rawPath: string, query: Record<string, string>, body: unknown): GitHubProviderResponse<unknown> {
    const path = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;

    if (method === 'GET' && path === '/user') {
      return ok({ login: SCRIPTED_GITHUB_LOGIN, id: 1 });
    }
    if (method === 'POST' && path === '/user/repos') {
      if (this.failRepoCreation) {
        return { status: 422, body: { message: 'repository creation rejected (scripted fixture)' } };
      }
      const input = body as { name?: string; description?: string | null };
      if (typeof input?.name !== 'string' || input.name.length === 0) {
        return { status: 422, body: { message: 'name is required' } };
      }
      if (this.repos.has(input.name)) {
        return { status: 422, body: { message: `repository ${input.name} already exists (scripted)` } };
      }
      this.ensureRepo(input.name, input.description ?? null);
      return created(this.repoSummary(this.repos.get(input.name)!));
    }
    if (method === 'GET' && path === '/user/repos') {
      void query;
      return ok([...this.repos.values()].map((repo) => this.repoSummary(repo)));
    }

    const repoMatch = /^\/repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (repoMatch === null) {
      return { status: 404, body: { message: `unrouted scripted path: ${method} ${path}` } };
    }
    const owner = repoMatch[1] ?? '';
    const name = repoMatch[2] ?? '';
    const rest = repoMatch[3] ?? '';
    void owner;
    const repo = this.repos.get(name);
    if (repo === undefined) {
      return { status: 404, body: { message: 'Not Found' } };
    }

    if (method === 'GET' && rest === '') {
      return ok(this.repoSummary(repo));
    }
    if (method === 'GET' && rest === 'branches') {
      const branchNames = [...repo.branches.keys()];
      const perPage = Number.parseInt(query['per_page'] ?? '100', 10);
      const limited = perPage === 1 ? branchNames.slice(0, 1) : branchNames;
      return ok(limited.map((branch) => ({ name: branch, commit: { sha: repo.branches.get(branch) ?? '' }, protected: false })));
    }
    if (method === 'PUT' && rest.startsWith('contents/')) {
      const filePath = rest.slice('contents/'.length);
      return this.contentsPut(repo, filePath, body);
    }
    if (method === 'GET' && rest.startsWith('git/ref/heads/')) {
      const branch = rest.slice('git/ref/heads/'.length);
      const sha = repo.branches.get(branch);
      if (sha === undefined) {
        return { status: 404, body: { message: `ref not found: ${branch}` } };
      }
      return ok({ ref: `refs/heads/${branch}`, node_id: 'scripted', url: '', object: { sha, type: 'commit' } });
    }
    if (method === 'GET' && rest.startsWith('git/commits/')) {
      const sha = rest.slice('git/commits/'.length);
      const commit = repo.commits.get(sha);
      if (commit === undefined) {
        return { status: 404, body: { message: `commit not found: ${sha}` } };
      }
      return ok({ sha: commit.sha, commit: { committer: { date: commit.committedAt } }, tree: { sha: `tree:${commit.sha}` } });
    }
    if (method === 'POST' && rest === 'git/blobs') {
      const input = body as { content?: string; encoding?: string };
      // The REAL semantics: the blob is content-addressed over the DECODED
      // contents and becomes addressable for later tree entries (recorded).
      const contents = input?.encoding === 'base64' ? Buffer.from(input.content ?? '', 'base64').toString('utf8') : String(input?.content ?? '');
      const sha = contentAddress({ blob: contents }, 'scripted-github-blob');
      this.blobs.set(sha, contents);
      return created({ sha });
    }
    if (method === 'POST' && rest === 'git/trees') {
      const input = body as { base_tree?: string; tree?: { path?: string; sha?: string }[] };
      if (!Array.isArray(input?.tree)) {
        return { status: 422, body: { message: 'git trees requires tree[]' } };
      }
      // The REAL semantics: the new tree is the base tree MERGED with the
      // entry blobs (base_tree resolves to a commit's tree or a recorded tree).
      const baseTree = typeof input.base_tree === 'string' ? input.base_tree : '';
      const baseFiles = baseTree.length > 0 ? this.resolveTreeFiles(repo, baseTree) : new Map<string, string>();
      if (baseFiles === null) {
        return { status: 422, body: { message: `base tree not found: ${baseTree}` } };
      }
      const files = new Map(baseFiles);
      for (const entry of input.tree) {
        if (typeof entry?.path !== 'string' || typeof entry?.sha !== 'string') {
          return { status: 422, body: { message: 'tree entries require path + sha' } };
        }
        const contents = this.blobs.get(entry.sha);
        if (contents === undefined) {
          return { status: 422, body: { message: `blob not found: ${entry.sha}` } };
        }
        files.set(entry.path, contents);
      }
      const sha = contentAddress({ base: input.base_tree ?? '', tree: [...files.entries()].map(([path, contents]) => ({ path, contents })) }, 'scripted-github-tree');
      this.trees.set(sha, files);
      return created({ sha });
    }
    if (method === 'POST' && rest === 'git/commits') {
      return this.gitCommit(repo, body);
    }
    if (method === 'PATCH' && rest.startsWith('git/refs/heads/')) {
      const branch = rest.slice('git/refs/heads/'.length);
      const input = body as { sha?: string };
      if (typeof input?.sha !== 'string' || !repo.commits.has(input.sha)) {
        return { status: 422, body: { message: 'invalid ref update (scripted)' } };
      }
      repo.branches.set(branch, input.sha);
      return ok({ ref: `refs/heads/${branch}`, object: { sha: input.sha, type: 'commit' } });
    }
    if (method === 'POST' && rest === 'git/refs') {
      const input = body as { ref?: string; sha?: string };
      const branch = typeof input?.ref === 'string' ? input.ref.replace('refs/heads/', '') : '';
      if (branch.length === 0 || typeof input?.sha !== 'string' || !repo.commits.has(input.sha)) {
        return { status: 422, body: { message: 'invalid ref creation (scripted)' } };
      }
      if (repo.branches.has(branch)) {
        return { status: 422, body: { message: `ref already exists: ${branch}` } };
      }
      repo.branches.set(branch, input.sha);
      return created({ ref: `refs/heads/${branch}`, object: { sha: input.sha, type: 'commit' } });
    }
    if (method === 'POST' && rest === 'pulls') {
      const input = body as { title?: string; head?: string; base?: string; body?: string | null };
      if (typeof input?.head !== 'string' || typeof input?.base !== 'string' || !repo.branches.has(input.head) || !repo.branches.has(input.base)) {
        return { status: 422, body: { message: 'head/base branch missing (scripted)' } };
      }
      if (repo.branches.get(input.head) === repo.branches.get(input.base)) {
        return { status: 422, body: { message: 'No commits between ' + input.base + ' and ' + input.head } };
      }
      const number = repo.pullRequests.length + 1;
      const headSha = repo.branches.get(input.head) ?? '';
      repo.pullRequests.push({
        number,
        title: input.title ?? '',
        head: input.head,
        base: input.base,
        body: input.body ?? null,
        state: 'open',
        headSha,
      });
      return created({
        number,
        title: input.title ?? '',
        state: 'open',
        html_url: `https://github.com/${SCRIPTED_GITHUB_LOGIN}/${repo.name}/pull/${number}`,
        head: { ref: input.head, sha: headSha },
        base: { ref: input.base },
      });
    }
    if (method === 'GET' && rest.startsWith('git/trees/')) {
      const sha = rest.slice('git/trees/'.length);
      const files = this.resolveTreeFiles(repo, sha);
      if (files === null) {
        return { status: 404, body: { message: `tree not found: ${sha}` } };
      }
      return ok({
        sha,
        tree: [...files.entries()].map(([path, contents]) => ({ path, type: 'blob', size: contents.length, sha: contentAddress({ blob: contents }, 'scripted-github-blob') })),
      });
    }
    if (method === 'GET' && rest.startsWith('contents/')) {
      const filePath = rest.slice('contents/'.length);
      const ref = query['ref'];
      const commit = ref === undefined ? this.headCommitOf(repo) : repo.commits.get(ref);
      if (commit === undefined) {
        return { status: 404, body: { message: `no commit at ref ${ref ?? '(default)'}` } };
      }
      const contents = commit.files.get(filePath);
      if (contents === undefined) {
        return { status: 404, body: { message: `file not found: ${filePath}` } };
      }
      return ok({
        name: filePath,
        path: filePath,
        content: Buffer.from(contents, 'utf8').toString('base64'),
        encoding: 'base64',
        sha: contentAddress({ blob: contents }, 'scripted-github-blob'),
      });
    }
    return { status: 404, body: { message: `unrouted scripted repo path: ${method} ${path}` } };
  }

  private contentsPut(repo: ScriptedRepo, filePath: string, body: unknown): GitHubProviderResponse<unknown> {
    const input = body as { message?: string; content?: string; branch?: string };
    if (typeof input?.content !== 'string' || typeof input?.branch !== 'string' || typeof input?.message !== 'string') {
      return { status: 422, body: { message: 'contents PUT requires message/content/branch' } };
    }
    if (this.failRepairCommits && input.message.startsWith('repair:')) {
      return { status: 403, body: { message: 'repair commits rejected (scripted fixture)' } };
    }
    const contents = Buffer.from(input.content, 'base64').toString('utf8');
    const parent = repo.branches.get(input.branch) ?? null;
    const parentFiles = parent !== null ? new Map(repo.commits.get(parent)?.files ?? new Map()) : new Map<string, string>();
    parentFiles.set(filePath, contents);
    const sha = this.mintCommit(repo.name, input.message, parent, parentFiles);
    repo.branches.set(input.branch, sha);
    return created({ content: { path: filePath }, commit: { sha, committer: { date: repo.commits.get(sha)?.committedAt ?? '' } } });
  }

  private gitCommit(repo: ScriptedRepo, body: unknown): GitHubProviderResponse<unknown> {
    const input = body as { message?: string; tree?: string; parents?: string[] };
    if (typeof input?.message !== 'string' || typeof input?.tree !== 'string' || !Array.isArray(input?.parents)) {
      return { status: 422, body: { message: 'git commit requires message/tree/parents' } };
    }
    if (this.failRepairCommits && input.message.startsWith('repair:')) {
      return { status: 403, body: { message: 'repair commits rejected (scripted fixture)' } };
    }
    const parentSha = input.parents[0] ?? null;
    const parent = parentSha !== null ? repo.commits.get(parentSha) : undefined;
    if (parent === undefined) {
      return { status: 422, body: { message: `parent commit not found: ${String(parentSha)}` } };
    }
    // The REAL semantics: the commit's file map IS the recorded tree's
    // file map (the tree merged the blobs over the base tree — never the
    // bare parent files; the entry blobs are the commit's changes).
    const files = this.resolveTreeFiles(repo, input.tree);
    if (files === null) {
      return { status: 422, body: { message: `tree not found: ${input.tree}` } };
    }
    const sha = this.mintCommit(repo.name, input.message, parentSha, files);
    return created({ sha, commit: { committer: { date: repo.commits.get(sha)?.committedAt ?? '' } }, tree: { sha: `tree:${sha}` } });
  }

  /** Resolve a tree sha to its file map: a recorded tree, or the 'tree:<commitSha>' convention of the commit read. */
  private resolveTreeFiles(repo: ScriptedRepo, treeSha: string): ReadonlyMap<string, string> | null {
    if (treeSha.startsWith('tree:')) {
      const commit = repo.commits.get(treeSha.slice('tree:'.length));
      return commit !== undefined ? commit.files : null;
    }
    const recorded = this.trees.get(treeSha);
    if (recorded !== undefined) {
      return recorded;
    }
    const commit = repo.commits.get(treeSha);
    return commit !== undefined ? commit.files : null;
  }

  private headCommitOf(repo: ScriptedRepo): ScriptedCommit | undefined {
    const mainHead = repo.branches.get('main');
    if (mainHead !== undefined) {
      return repo.commits.get(mainHead);
    }
    const firstBranch = [...repo.branches.values()][0];
    return firstBranch !== undefined ? repo.commits.get(firstBranch) : undefined;
  }

  private mintCommit(repoName: string, message: string, parent: string | null, files: ReadonlyMap<string, string>): string {
    const repo = this.repos.get(repoName)!;
    const sha = contentAddress(
      { repo: repoName, message, parent, files: [...files.entries()].map(([path, contents]) => ({ path, contents })) },
      'scripted-github-commit',
    );
    const commit: ScriptedCommit = { sha, message, parent, files: new Map(files), committedAt: formatRfc3339(DOGFOOD_SCRIPTED_T0) };
    repo.commits.set(sha, commit);
    return sha;
  }

  private ensureRepo(name: string, description: string | null): ScriptedRepo {
    const existing = this.repos.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const repo: ScriptedRepo = { name, description, branches: new Map(), commits: new Map(), pullRequests: [] };
    this.repos.set(name, repo);
    return repo;
  }

  private repoSummary(repo: ScriptedRepo): Record<string, unknown> {
    const isEmpty = repo.branches.size === 0;
    const head = this.headCommitOf(repo);
    return {
      name: repo.name,
      full_name: `${SCRIPTED_GITHUB_LOGIN}/${repo.name}`,
      private: false,
      description: repo.description,
      size: isEmpty ? 0 : 1,
      pushed_at: isEmpty ? null : formatRfc3339(DOGFOOD_SCRIPTED_T0),
      default_branch: isEmpty ? null : 'main',
      owner: { login: SCRIPTED_GITHUB_LOGIN },
    };
  }
}

function ok(body: unknown): GitHubProviderResponse<unknown> {
  return { status: 200, body };
}

function created(body: unknown): GitHubProviderResponse<unknown> {
  return { status: 201, body };
}

// ---------------------------------------------------------------------------
// The scripted Vercel simulator (the §0b shapes over the FetchPort seam)
// ---------------------------------------------------------------------------

interface ScriptedVercelProjectState {
  readonly id: string;
  readonly name: string;
  readonly repoId: number;
  readonly org: string;
  readonly repo: string;
  ssoProtection: unknown;
}

interface ScriptedVercelDeploymentState {
  readonly id: string;
  readonly url: string;
  readyState: string;
  readonly ref: string;
  pollCount: number;
  readonly projectId: string;
}

/**
 * The scripted Vercel API — the §0b-verified shapes over the FetchPort
 * seam: /v2/user, /v9/projects (GET/POST/PATCH with ssoProtection null),
 * /v13/deployments (create with gitSource {repoId, ref} + the READY poll).
 */
export class ScriptedVercelFetch {
  private readonly projects = new Map<string, ScriptedVercelProjectState>();
  private readonly deployments = new Map<string, ScriptedVercelDeploymentState>();
  private readonly requestLog: { method: string; path: string; status: number }[] = [];
  /** The repo-content reader the runtime fetch serves (wired by the world). */
  public readRepoFile: ((path: string, ref: string | null) => string | null) | null = null;

  recordedRequests(): readonly { method: string; path: string; status: number }[] {
    return [...this.requestLog];
  }

  projectOf(name: string): ScriptedVercelProjectState | undefined {
    return this.projects.get(name);
  }

  deploymentOf(id: string): ScriptedVercelDeploymentState | undefined {
    return this.deployments.get(id);
  }

  /** The deployment serving a host (the runtime fetch routes through the deployed ref). */
  deploymentForUrl(host: string): ScriptedVercelDeploymentState | undefined {
    return [...this.deployments.values()].find((deployment) => deployment.url === host);
  }

  readonly fetch: FetchPort = async (request: HttpRequest): Promise<HttpResponse> => {
    const response = this.route(request);
    this.requestLog.push({ method: request.method, path: new URL(request.url).pathname, status: response.status });
    return response;
  };

  private route(request: HttpRequest): HttpResponse {
    const url = new URL(request.url);
    const path = url.pathname;
    const body: unknown = request.body === null ? null : JSON.parse(responseText({ status: 200, headers: {}, bytes: request.body }));

    if (request.method === 'GET' && path === '/v2/user') {
      return jsonResponse(200, { user: { id: 'usr_scripted_p19', username: 'scripted-p19', defaultTeamId: null, billing: { plan: ' hobby' } } });
    }
    if (request.method === 'GET' && path.startsWith('/v9/projects/')) {
      const name = decodeURIComponent(path.slice('/v9/projects/'.length));
      const project = this.projects.get(name);
      if (project === undefined) {
        return jsonResponse(404, { error: { code: 'not_found', message: 'project not found (scripted)' } });
      }
      return jsonResponse(200, this.projectBody(project));
    }
    if (request.method === 'POST' && path === '/v9/projects') {
      const input = body as { name?: string; gitRepository?: { type?: string; repo?: string } };
      if (typeof input?.name !== 'string' || typeof input?.gitRepository?.repo !== 'string' || input.gitRepository.type !== 'github') {
        return jsonResponse(400, { error: { code: 'bad_request', message: 'gitRepository {type: github, repo} is required (the §0b shape)' } });
      }
      if (this.projects.has(input.name)) {
        return jsonResponse(409, { error: { code: 'project_name_taken', message: 'project exists (scripted)' } });
      }
      const [org, repo] = input.gitRepository.repo.split('/');
      const project: ScriptedVercelProjectState = {
        id: `prj_${contentAddress({ name: input.name }, 'scripted-vercel-project')}`,
        name: input.name,
        repoId: 1377439400 + this.projects.size,
        org: org ?? 'payswapdotorg',
        repo: repo ?? input.name,
        ssoProtection: { deploymentType: 'all_except_custom_domains' },
      };
      this.projects.set(input.name, project);
      return jsonResponse(201, this.projectBody(project));
    }
    if (request.method === 'PATCH' && path.startsWith('/v9/projects/')) {
      const name = decodeURIComponent(path.slice('/v9/projects/'.length));
      const project = this.projects.get(name);
      if (project === undefined) {
        return jsonResponse(404, { error: { code: 'not_found', message: 'project not found (scripted)' } });
      }
      const input = body as { ssoProtection?: unknown };
      if ('ssoProtection' in (input ?? {})) {
        project.ssoProtection = input?.ssoProtection ?? null;
      }
      return jsonResponse(200, this.projectBody(project));
    }
    if (request.method === 'POST' && path === '/v13/deployments') {
      const input = body as { name?: string; gitSource?: { type?: string; repoId?: number; ref?: string }; target?: string };
      const project = typeof input?.name === 'string' ? this.projects.get(input.name) : undefined;
      if (project === undefined || input?.gitSource?.type !== 'github' || typeof input.gitSource.repoId !== 'number' || typeof input.gitSource.ref !== 'string') {
        return jsonResponse(400, { error: { code: 'bad_request', message: 'gitSource {type: github, repoId, ref} is required (the §0b shape)' } });
      }
      if (input.target !== 'production') {
        return jsonResponse(400, { error: { code: 'bad_request', message: 'target production is the §0b shape (scripted)' } });
      }
      const id = `dpl_${contentAddress({ project: input.name, ref: input.gitSource.ref, seq: this.deployments.size }, 'scripted-vercel-deployment')}`;
      const deployment: ScriptedVercelDeploymentState = {
        id,
        url: `${input.name}-scripted.vercel.app`,
        readyState: 'QUEUED',
        ref: input.gitSource.ref,
        pollCount: 0,
        projectId: project.id,
      };
      this.deployments.set(id, deployment);
      return jsonResponse(201, this.deploymentBody(deployment));
    }
    if (request.method === 'GET' && path.startsWith('/v13/deployments/')) {
      const id = decodeURIComponent(path.slice('/v13/deployments/'.length));
      const deployment = this.deployments.get(id);
      if (deployment === undefined) {
        return jsonResponse(404, { error: { code: 'not_found', message: 'deployment not found (scripted)' } });
      }
      deployment.pollCount += 1;
      // The static-content deployment turns READY after two polls (deterministic).
      if (deployment.pollCount >= 2) {
        deployment.readyState = 'READY';
      }
      return jsonResponse(200, this.deploymentBody(deployment));
    }
    return jsonResponse(404, { error: { code: 'not_found', message: `unrouted scripted vercel path: ${request.method} ${path}` } });
  }

  private projectBody(project: ScriptedVercelProjectState): Record<string, unknown> {
    return {
      id: project.id,
      name: project.name,
      framework: null,
      rootDirectory: null,
      createdAt: DOGFOOD_SCRIPTED_T0,
      nodeVersion: '24.x',
      link: { type: 'github', org: project.org, repo: project.repo, repoId: project.repoId },
      ssoProtection: project.ssoProtection,
    };
  }

  private deploymentBody(deployment: ScriptedVercelDeploymentState): Record<string, unknown> {
    return {
      uid: deployment.id,
      id: deployment.id,
      url: deployment.url,
      readyState: deployment.readyState,
      state: deployment.readyState,
      createdAt: DOGFOOD_SCRIPTED_T0,
      target: 'production',
      accountId: 'team_scripted_p19',
      teamId: 'team_scripted_p19',
      projectId: deployment.projectId,
      regions: ['iad1'],
      gitSource: { type: 'github', repoId: 1377439400, ref: deployment.ref, sha: deployment.ref },
      meta: { githubCommitSha: deployment.ref, githubCommitRef: deployment.ref },
    };
  }
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, bytes: jsonBody(body) };
}

// ---------------------------------------------------------------------------
// The scripted world composition
// ---------------------------------------------------------------------------

/** The fixture knobs of a scripted dogfood world (all honest defaults). */
export interface ScriptedDogfoodWorldOptions {
  readonly repositorySlug: string;
  readonly vercelProjectName: string;
  readonly journeyId: string;
  /** The scripted model responses (consumed in call order). */
  readonly modelEntries: readonly ScriptedModelEntry[];
  /** Fail commit operations whose message starts with 'repair:' (the REPAIR_UNAVAILABLE fixture). */
  readonly failRepairCommits?: boolean;
}

/** The scripted dogfood world: the REAL harness over the scripted seams. */
export interface ScriptedDogfoodWorld {
  readonly harness: RealDogfoodHarness;
  readonly clock: ManualClock;
  readonly github: ScriptedGitHubApi;
  readonly vercel: ScriptedVercelFetch;
  readonly modelPort: ScriptedHostedModelPort;
}

/** The scripted model outputs (deterministic, node-runnable). */
export const SCRIPTED_SCAFFOLD_FILES = [
  {
    path: 'README.md',
    contents: '# Build a markdown notes service with a public API\n\nRealized by the SOS 2.0 mission-to-implementation pipeline through a REAL hosted coding body (scripted model port — deterministic fixture).\n',
  },
  {
    path: 'sos-manifest.json',
    contents: '{"mission_ref":"scripted:p19-dogfood","generated_by":"p19 dogfood scripted model port"}\n',
  },
];

export const SCRIPTED_GOAL_FILES_PASSING = [
  {
    path: 'src/goal-deliver/module.ts',
    contents: [
      '/** The markdown notes service module (scripted body output — deterministic). */',
      "export const componentId = 'goal-deliver';",
      'export function deliver(): string {',
      "  return 'goal-deliver: Build a markdown notes service with a public API';",
      '}',
      '',
    ].join('\n'),
  },
  {
    path: 'src/goal-deliver/module.test.ts',
    contents: [
      '/** The generated test of the markdown notes service module (self-executing under node). */',
      "import { strict as assert } from 'node:assert';",
      "import { componentId, deliver } from './module.js';",
      "assert.equal(componentId, 'goal-deliver');",
      "assert.ok(deliver().startsWith('goal-deliver:'));",
      "console.log('scripted module test passed');",
      '',
    ].join('\n'),
  },
];

export const SCRIPTED_GOAL_FILES_FAILING_TEST = [
  SCRIPTED_GOAL_FILES_PASSING[0]!,
  {
    path: 'src/goal-deliver/module.test.ts',
    contents: [
      '/** The generated test (DETERMINISTIC DEFECT: the assertion fails under node — the repair fixture). */',
      "import { strict as assert } from 'node:assert';",
      "assert.equal(1, 2);",
      '',
    ].join('\n'),
  },
];

function scriptedModelResponse(files: readonly { path: string; contents: string }[], summary: string): ScriptedModelEntry {
  return {
    respond: {
      id: contentAddress({ files, summary }, 'scripted-model-response'),
      model: 'qwen/qwen3-coder-flash',
      content: JSON.stringify({ files, summary }),
      finish_reason: 'stop',
      usage: { prompt_tokens: 111, completion_tokens: 222, total_tokens: 333 },
    },
  };
}

/** The default scripted model entries: scaffold (good) + goal (good). */
export function defaultScriptedModelEntries(): readonly ScriptedModelEntry[] {
  return [
    scriptedModelResponse(SCRIPTED_SCAFFOLD_FILES, 'the scaffold files (scripted)'),
    scriptedModelResponse(SCRIPTED_GOAL_FILES_PASSING, 'the markdown notes module + a passing self-executing test (scripted)'),
  ];
}

/** The repair-fixture model entries: scaffold (good) + goal (failing test). */
export function repairFixtureModelEntries(): readonly ScriptedModelEntry[] {
  return [
    scriptedModelResponse(SCRIPTED_SCAFFOLD_FILES, 'the scaffold files (scripted)'),
    scriptedModelResponse(SCRIPTED_GOAL_FILES_FAILING_TEST, 'the module with a FAILING test (the deterministic repair fixture)'),
  ];
}

/** Assemble the scripted dogfood world (the REAL harness over the scripted seams). */
export function createScriptedDogfoodWorld(options: ScriptedDogfoodWorldOptions): ScriptedDogfoodWorld {
  const clock = new ManualClock(DOGFOOD_SCRIPTED_T0);
  const github = new ScriptedGitHubApi();
  github.failRepairCommits = options.failRepairCommits ?? false;
  const vercel = new ScriptedVercelFetch();
  const modelPort = new ScriptedHostedModelPort(options.modelEntries);

  // Wire the runtime fetch's repo reads to the scripted GitHub state AT THE
  // DEPLOYED REVISION (the scripted Vercel serves the repository content of
  // its deployment's exact ref — the real-provider behavior).
  const [, repoName] = options.repositorySlug.split('/') as [string, string];
  vercel.readRepoFile = (filePath: string, ref: string | null): string | null => {
    const repo = github.repo(repoName);
    if (repo === undefined) {
      return null;
    }
    const commit = ref !== null ? repo.commits.get(ref) : undefined;
    if (commit === undefined) {
      return null;
    }
    return commit.files.get(filePath) ?? null;
  };

  const runtimeFetch: DogfoodRuntimeFetch = (url: string): Promise<{ status: number | null; body: string | null }> => {
    // The scripted deployed runtime: the root answers 404 (no index.html —
    // the honest static-deployment fact); a file path serves the repository
    // content AT THE DEPLOYED REVISION — EXCEPT the file NAMED README.md,
    // which REAL Vercel never serves on a zero-config static deployment
    // (repository metadata is excluded — verified empirically; the runtime
    // binding basis is sos-manifest.json, which the scripted world serves
    // byte-exact like the real provider).
    const parsed = new URL(url);
    const deployment = vercel.deploymentForUrl(parsed.host);
    if (deployment === undefined) {
      return Promise.resolve({ status: 404, body: 'no scripted deployment serves this host' });
    }
    if (parsed.pathname === '/' || parsed.pathname === '') {
      return Promise.resolve({ status: 404, body: 'NOT_FOUND (scripted static deployment — no root index.html)' });
    }
    const filePath = decodeURIComponent(parsed.pathname.slice(1));
    if (filePath === 'README.md') {
      return Promise.resolve({ status: 404, body: 'NOT_FOUND (scripted static deployment — the file NAMED README.md is repository metadata and is never served, the real-Vercel behavior)' });
    }
    const contents = vercel.readRepoFile?.(filePath, deployment.ref) ?? null;
    if (contents === null) {
      return Promise.resolve({ status: 404, body: `file not served: ${filePath}` });
    }
    return Promise.resolve({ status: 200, body: contents });
  };

  const harness = createRealDogfoodHarness({
    source: {
      // Fixture values are deliberately SHORT and non-secret-shaped: the
      // scripted seams never validate credential shapes, and the committed
      // owned-paths secrets audit stays 0 findings (the real suite carries
      // the REAL credentials through the ENVIRONMENT, never the source).
      PAYSWAP_GITHUB_TOKEN: 'gh-fixture',
      OPENROUTER_API_KEY: 'or-fixture',
      VERCEL_TOKEN: 'vercel-fixture',
      VERCEL_ORG_ID: 'team_scripted_p19',
    },
    journeyId: options.journeyId,
    repositorySlug: options.repositorySlug,
    vercelProjectName: options.vercelProjectName,
    missionStatement: 'Build a markdown notes service with a public API',
    clock,
    sleep: async () => {
      /* instant (deterministic) */
    },
    githubRequestPort: github,
    vercelFetch: vercel.fetch,
    modelPort,
    runtimeFetch,
    dnsLookup: async () => '127.0.0.1',
    openRouterKeyCheck: async () => ({ ok: true, detail: 'the scripted key check answered OK (deterministic fixture)' }),
    maxEngineAttempts: 2,
    maxDeployPollAttempts: 8,
    deployPollIntervalMs: 1,
    interTickAdvanceMs: 1_000,
  });

  return { harness, clock, github, vercel, modelPort };
}

/** Drive a scripted world to its fixed point (the full harness run). */
export async function runScriptedWorld(world: ScriptedDogfoodWorld): Promise<ReturnType<RealDogfoodHarness['run']>> {
  return world.harness.run();
}
