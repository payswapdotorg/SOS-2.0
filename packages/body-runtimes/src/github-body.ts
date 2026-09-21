/**
 * THE GITHUB-AWARE PROJECT BODY (Work Order P8) — repository operations
 * through the P4 provider-neutral github adapter vocabulary, as typed
 * records, behind the merged P5 Harness Contract.
 *
 *   - workspace read/write: a SANDBOX-BOUNDED staging workspace (the
 *     bounded environment owns filesystem scope, egress and secrets for
 *     the staging area);
 *   - git.branch/commit/PR: typed records through the repository
 *     operations seam (the P4 provider-neutral vocabulary — see
 *     github-vocabulary.ts / github-operations.ts); every provider call
 *     is preceded by a SANDBOX-AUTHORIZED network exchange record for
 *     the provider host (a denied host or an unavailable credential is a
 *     truthful FAILED result carrying the typed sandbox denial);
 *   - git.status/diff: honest body-side views of the task's changeset
 *     (staged files vs the commits this task landed);
 *   - HONEST NOT_YET_CONNECTED: when the provider session is not
 *     connected (no real credentials — validation provider accounts
 *     pending), every provider-backed write operation FAILS truthfully
 *     naming NOT_YET_CONNECTED — never fabricated, never silent;
 *   - the advertisement derives its git capability from the seam's
 *     honestly-supported write operations and its runtime integration
 *     availability from the seam's connection state.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env — the
 * seam, policy and secrets are injected; the body is clock-less.
 */

import { InvalidBodyRuntimeOptionsError } from './errors.js';
import type { GitHubRepositoryOperations } from './github-operations.js';
import { changedPaths, createGitSessionState, renderWorkspaceDiff } from './git-records.js';
import type { GitCommitRecord, GitPullRequestRecord, GitPushRecord, GitSessionState } from './git-records.js';
import { createLocalSandbox } from '@sos-2/sandbox';
import type { Sandbox, SandboxPolicy } from '@sos-2/sandbox';
import { renderSandboxDenial } from '@sos-2/sandbox';
import { assertValidSandboxPolicy } from '@sos-2/sandbox';
import type { RepositoryId } from './github-vocabulary.js';
import { repositorySlug } from './github-vocabulary.js';
import type {
  ArtifactsCaptureRequest,
  ArtifactsCaptureResult,
  BodyEvent,
  BrowserInteractRequest,
  BrowserInteractResult,
  BrowserOpenRequest,
  BrowserOpenResult,
  CancelTaskRequest,
  CancelTaskResult,
  CreateTaskRequest,
  CreateTaskResult,
  EventsSubscribeRequest,
  EventsSubscribeResult,
  GitCommitRequest,
  GitCommitResult,
  GitCreateBranchRequest,
  GitCreateBranchResult,
  GitCreatePullRequestRequest,
  GitCreatePullRequestResult,
  GitDiffRequest,
  GitDiffResult,
  GitPushRequest,
  GitPushResult,
  GitStatusRequest,
  GitStatusResult,
  HarnessCapabilities,
  HarnessContract,
  HarnessIdentity,
  HarnessPlacement,
  HarnessResult,
  ObservationsEmitRequest,
  ObservationsEmitResult,
  PauseTaskRequest,
  PauseTaskResult,
  ResumeTaskRequest,
  ResumeTaskResult,
  ShellExecRequest,
  ShellExecResult,
  WorkspaceReadRequest,
  WorkspaceReadResult,
  WorkspaceWriteRequest,
  WorkspaceWriteResult,
} from '@sos-2/harness';
import { harnessFailed, harnessOk, harnessUnsupported, isOperationAdvertised } from '@sos-2/harness';
import type { GitOperation } from '@sos-2/harness';
import { assertValidHarnessCapabilities, assertValidHarnessIdentity } from '@sos-2/harness';
import type { JsonValue } from '@sos-2/semantic-spine';

/** Options for the GitHub-aware project body. */
export interface GitHubProjectBodyOptions {
  /** The body id (a RUNTIME identifier — never a SOS semantic identity). */
  readonly bodyId: string;
  /** Vendor provenance (metadata ONLY). */
  readonly provider?: { readonly name: string; readonly version: string };
  /** Execution placement (default "cloud"). */
  readonly placement?: HarnessPlacement;
  /** The repository operations seam (P4 provider-neutral vocabulary). */
  readonly repositoryOperations: GitHubRepositoryOperations;
  /** The repository this body's task operates on. */
  readonly repository: RepositoryId;
  /** The exact branch the task starts from (revision selection). */
  readonly baseBranch: string;
  /** The exact head sha of the base branch (revision selection). */
  readonly baseSha: string;
  /** The bounded-environment policy of the staging workspace (must admit the provider host). */
  readonly sandboxPolicy: SandboxPolicy;
  /** The provider host the repository operations are reached through (default "api.github.com"). */
  readonly providerHost?: string;
  /** The credential NAME used for provider calls, or null (the value lives only in the sandbox closure). */
  readonly credentialName?: string | null;
  /** Credential values injected into every task closure (never echoed). */
  readonly secrets?: Readonly<Record<string, string>>;
  /** The cost envelope. */
  readonly costEnvelope?: { readonly maxDurationMs: number; readonly maxMemoryMb: number | null; readonly maxCostUsdPerTask: number | null };
}

interface GitHubTaskSession {
  readonly taskRef: string;
  readonly sandbox: Sandbox;
  status: 'active' | 'paused' | 'cancelled';
  readonly git: GitSessionState;
  /** The current head sha of the task's branch (revision tracking). */
  headSha: string;
  events: BodyEvent[];
  observations: { kind: string; payload: JsonValue }[];
}

/**
 * The GitHub-aware project body — a deterministic reference runtime
 * executing repository operations as typed records through the P4
 * provider-neutral vocabulary.
 */
export class GitHubProjectBody implements HarnessContract {
  readonly identityValue: HarnessIdentity;
  readonly capabilitiesValue: HarnessCapabilities;
  /** Run-flag probes: dispatched operation counts, by operation name (audit). */
  readonly dispatches = new Map<string, number>();

  private readonly sessions = new Map<string, GitHubTaskSession>();
  private readonly providerHost: string;
  private readonly credentialName: string | null;

  constructor(private readonly options: GitHubProjectBodyOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new InvalidBodyRuntimeOptionsError('github-body', 'GitHub-aware project body options must be an object');
    }
    if (typeof options.bodyId !== 'string' || options.bodyId.length === 0 || options.bodyId.includes('sos://')) {
      throw new InvalidBodyRuntimeOptionsError('github-body', `bodyId must be a non-empty RUNTIME identifier (never a sos:// semantic identity), received: ${JSON.stringify(options.bodyId)}`);
    }
    if (typeof options.repositoryOperations !== 'object' || options.repositoryOperations === null) {
      throw new InvalidBodyRuntimeOptionsError('github-body', 'the GitHub-aware project body requires a repository operations seam');
    }
    if (typeof options.repository !== 'object' || options.repository === null || typeof options.repository.owner !== 'string' || options.repository.owner.length === 0 || typeof options.repository.name !== 'string' || options.repository.name.length === 0) {
      throw new InvalidBodyRuntimeOptionsError('github-body', 'the GitHub-aware project body requires a RepositoryId { owner, name }');
    }
    if (typeof options.baseBranch !== 'string' || options.baseBranch.length === 0) {
      throw new InvalidBodyRuntimeOptionsError('github-body', 'baseBranch must be a non-empty string');
    }
    if (typeof options.baseSha !== 'string' || options.baseSha.length === 0) {
      throw new InvalidBodyRuntimeOptionsError('github-body', 'baseSha must be a non-empty string (revision selection is exact)');
    }
    assertValidSandboxPolicy(options.sandboxPolicy);
    if (options.sandboxPolicy.filesystem.mode === 'none') {
      throw new InvalidBodyRuntimeOptionsError(
        'github-body',
        'the GitHub-aware project body requires a staging workspace filesystem scope — files stage in the sandbox before they commit through the provider',
      );
    }
    this.providerHost = options.providerHost ?? 'api.github.com';
    if (options.sandboxPolicy.network.egress === 'none') {
      throw new InvalidBodyRuntimeOptionsError(
        'github-body',
        `the staging sandbox egress policy must admit the provider host ${JSON.stringify(this.providerHost)} — egress "none" cannot reach any repository provider`,
      );
    }
    if (options.sandboxPolicy.network.egress === 'allowlist' && !options.sandboxPolicy.network.allowedHosts.includes(this.providerHost)) {
      throw new InvalidBodyRuntimeOptionsError(
        'github-body',
        `the staging sandbox egress allowlist must admit the provider host ${JSON.stringify(this.providerHost)} (allowlist: [${options.sandboxPolicy.network.allowedHosts.join(', ')}])`,
      );
    }
    this.credentialName = options.credentialName ?? null;
    if (this.credentialName !== null && !options.sandboxPolicy.secrets.includes(this.credentialName)) {
      throw new InvalidBodyRuntimeOptionsError(
        'github-body',
        `credentialName ${JSON.stringify(this.credentialName)} must be declared by NAME in the sandbox policy secrets list — an undeclared credential is never used`,
      );
    }

    const provider = options.provider ?? { name: 'reference-github-project', version: '1.0.0' };
    this.identityValue = {
      harness_id: `harness:${options.bodyId}`,
      provider,
      placement: options.placement ?? 'cloud',
    };
    assertValidHarnessIdentity(this.identityValue);

    // The advertisement derives its git capability from the seam's honest
    // write-operation subset and its runtime integration availability
    // from the seam's CURRENT connection state.
    const supported = new Set(options.repositoryOperations.supportedOperations());
    const gitOperations: GitOperation[] = ['status', 'diff'];
    if (supported.has('createBranch')) {
      gitOperations.push('createBranch');
    }
    if (supported.has('commitFiles')) {
      gitOperations.push('commit', 'push');
    }
    if (supported.has('createPullRequest')) {
      gitOperations.push('createPullRequest');
    }
    const connected = options.repositoryOperations.connection().status === 'CONNECTED';
    const runtimeIntegrations =
      supported.size === 0
        ? []
        : [
            {
              capability: 'github',
              operations: [...supported],
              integrations: [
                {
                  integration_id: `${options.bodyId}:github-native-api`,
                  tier: 'native-api' as const,
                  capability: 'github',
                  endpoint: `https://${this.providerHost}`,
                  operations: [...supported],
                  available: connected,
                },
              ],
              boundedEnvironment: null,
            },
          ];
    const policy = options.sandboxPolicy;
    this.capabilitiesValue = {
      capabilities: supported.size === 0 ? ['filesystem', 'repository-operations'] : ['filesystem', 'repository-operations', 'runtime-cloud-apis'],
      isolationLevel: 'process',
      networkPolicy: policy.network,
      filesystemScope: { mode: policy.filesystem.mode, root: policy.filesystem.root },
      browser: [],
      shell: [],
      git: gitOperations,
      runtimeIntegrations,
      taskLifecycle: { create: true, resume: true, pause: true, cancel: true, checkpoints: true },
      evidenceCapture: { artifacts: true, observations: true, events: true },
      costEnvelope:
        options.costEnvelope ?? {
          maxDurationMs: policy.resourceEnvelope.maxDurationMs,
          maxMemoryMb: policy.resourceEnvelope.maxMemoryMb,
          maxCostUsdPerTask: null,
        },
    };
    assertValidHarnessCapabilities(this.capabilitiesValue);
  }

  // -------------------------------------------------------------------------
  // Audit/test probes (NOT part of the §9 contract)
  // -------------------------------------------------------------------------

  /** The bounded staging environment of one task session (audit/test probe). */
  sandboxOf(taskRef: string): Sandbox | null {
    return this.sessions.get(taskRef)?.sandbox ?? null;
  }

  /** The typed git records of one task session (audit/test probe; a clone). */
  gitStateOf(taskRef: string): (GitSessionState & { headSha: string }) | null {
    const session = this.sessions.get(taskRef);
    if (session === undefined) {
      return null;
    }
    return {
      branch: session.git.branch,
      commits: [...session.git.commits],
      pushes: [...session.git.pushes],
      pullRequests: [...session.git.pullRequests],
      head: new Map(session.git.head),
      headSha: session.headSha,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private probe(operation: string): void {
    this.dispatches.set(operation, (this.dispatches.get(operation) ?? 0) + 1);
  }

  private sessionGuard(taskRef: string): { ok: true; session: GitHubTaskSession } | { ok: false; failure: HarnessResult<never> } {
    const session = this.sessions.get(taskRef);
    if (session === undefined) {
      return { ok: false, failure: harnessFailed(`no task session ${JSON.stringify(taskRef)} on this body — createTask or resumeTask first`) };
    }
    if (session.status === 'cancelled') {
      return { ok: false, failure: harnessFailed(`task ${JSON.stringify(taskRef)} is cancelled on this body`) };
    }
    return { ok: true, session };
  }

  private emitEvent(session: GitHubTaskSession, kind: string, payload: JsonValue): void {
    session.events.push({
      event_id: `${session.taskRef}:ev-${String(session.events.length + 1).padStart(4, '0')}`,
      kind,
      payload,
    });
  }

  /** The staged workspace snapshot through the sandbox (deterministic). */
  private stagedSnapshot(session: GitHubTaskSession): Map<string, string> {
    const snapshot = new Map<string, string>();
    const listed = session.sandbox.filesystem.list();
    if (listed.status !== 'OK') {
      return snapshot;
    }
    for (const path of listed.value.paths) {
      const read = session.sandbox.filesystem.read(path);
      if (read.status === 'OK') {
        snapshot.set(path, read.value.content);
      }
    }
    return snapshot;
  }

  /**
   * Authorize one provider exchange through the sandbox boundary — the
   * typed network exchange record for the provider host (and the
   * credential NAME, never its value). A denial is returned verbatim.
   */
  private authorizeProviderExchange(session: GitHubTaskSession, exchangePath: string): { ok: true } | { ok: false; failure: HarnessResult<never> } {
    const exchange = session.sandbox.network.netCall(this.providerHost, exchangePath, this.credentialName);
    if (exchange.status === 'DENIED') {
      this.emitEvent(session, 'sandbox.denied', { boundary: 'network', code: exchange.denial.code, subject: exchange.denial.subject });
      return { ok: false, failure: harnessFailed(renderSandboxDenial(exchange.denial)) };
    }
    this.emitEvent(session, 'provider.exchange-authorized', { exchange_id: exchange.value.exchange_id, host: exchange.value.host, credential: exchange.value.credential });
    return { ok: true };
  }

  /** The honest NOT_YET_CONNECTED refusal (never fabricated, never silent). */
  private notYetConnectedFailure(): HarnessResult<never> {
    const connection = this.options.repositoryOperations.connection();
    return harnessFailed(
      `the github repository provider is ${connection.status} — validation provider accounts are pending; no repository operation was attempted (connection evidence is never fabricated)`,
    );
  }

  // -------------------------------------------------------------------------
  // §9 identity + capabilities
  // -------------------------------------------------------------------------

  identity(): HarnessIdentity {
    return this.identityValue;
  }

  capabilities(): HarnessCapabilities {
    return this.capabilitiesValue;
  }

  // -------------------------------------------------------------------------
  // §9 task lifecycle
  // -------------------------------------------------------------------------

  createTask(request: CreateTaskRequest): HarnessResult<CreateTaskResult> {
    this.probe('createTask');
    if (typeof request.task_ref !== 'string' || request.task_ref.length === 0) {
      return harnessFailed('createTask requires a non-empty task_ref');
    }
    const sandbox = createLocalSandbox({ policy: this.options.sandboxPolicy, secrets: this.options.secrets });
    const session: GitHubTaskSession = {
      taskRef: request.task_ref,
      sandbox,
      status: 'active',
      git: createGitSessionState(this.options.baseBranch),
      headSha: this.options.baseSha,
      events: [],
      observations: [],
    };
    this.sessions.set(request.task_ref, session);
    this.emitEvent(session, 'task.created', {
      input: request.input,
      repository: repositorySlug(this.options.repository),
      base_branch: this.options.baseBranch,
      base_sha: this.options.baseSha,
    });
    const root = this.options.sandboxPolicy.filesystem.root ?? '';
    return harnessOk({ accepted: true, workspace_root: `${root}/${request.task_ref}` });
  }

  resumeTask(request: ResumeTaskRequest): HarnessResult<ResumeTaskResult> {
    this.probe('resumeTask');
    const existing = this.sessions.get(request.task_ref);
    if (existing !== undefined && existing.status === 'cancelled') {
      return harnessFailed(`task ${request.task_ref} is cancelled on this body`);
    }
    const session =
      existing ??
      ({
        taskRef: request.task_ref,
        sandbox: createLocalSandbox({ policy: this.options.sandboxPolicy, secrets: this.options.secrets }),
        status: 'active' as const,
        git: createGitSessionState(this.options.baseBranch),
        headSha: this.options.baseSha,
        events: [],
        observations: [],
      } satisfies GitHubTaskSession);
    if (existing === undefined) {
      this.sessions.set(request.task_ref, session);
      this.emitEvent(session, 'task.adopted-by-replacement', { task_ref: request.task_ref });
    }
    session.status = 'active';
    return harnessOk({
      state: 'resumed',
      recovered:
        existing === undefined
          ? { adopted_by_replacement: true, staged_files: 0, commits: 0 }
          : { adopted_by_replacement: false, staged_files: this.stagedSnapshot(session).size, commits: session.git.commits.length },
    });
  }

  pauseTask(request: PauseTaskRequest): HarnessResult<PauseTaskResult> {
    this.probe('pauseTask');
    const guard = this.sessionGuard(request.task_ref);
    if (!guard.ok) {
      return guard.failure;
    }
    guard.session.status = 'paused';
    this.emitEvent(guard.session, 'task.paused', {});
    return harnessOk({ state: 'paused' });
  }

  cancelTask(request: CancelTaskRequest): HarnessResult<CancelTaskResult> {
    this.probe('cancelTask');
    const guard = this.sessionGuard(request.task_ref);
    if (!guard.ok) {
      return guard.failure;
    }
    guard.session.status = 'cancelled';
    guard.session.sandbox.end(`task ${request.task_ref} cancelled — the credential closure dies with the session`);
    this.emitEvent(guard.session, 'task.cancelled', {});
    return harnessOk({ state: 'cancelled' });
  }

  // -------------------------------------------------------------------------
  // §9 workspace (the sandbox-bounded staging area)
  // -------------------------------------------------------------------------

  readonly workspace = {
    read: (request: WorkspaceReadRequest): HarnessResult<WorkspaceReadResult> => {
      this.probe('workspace.read');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      if (typeof request.path !== 'string' || request.path.length === 0) {
        return harnessFailed('workspace.read requires a non-empty path');
      }
      const read = guard.session.sandbox.filesystem.read(request.path);
      if (read.status === 'DENIED') {
        this.emitEvent(guard.session, 'sandbox.denied', { boundary: 'filesystem', code: read.denial.code, subject: read.denial.subject });
        return harnessFailed(renderSandboxDenial(read.denial));
      }
      return harnessOk({ content: read.value.content });
    },
    write: (request: WorkspaceWriteRequest): HarnessResult<WorkspaceWriteResult> => {
      this.probe('workspace.write');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      if (typeof request.path !== 'string' || request.path.length === 0) {
        return harnessFailed('workspace.write requires a non-empty path');
      }
      if (typeof request.content !== 'string') {
        return harnessFailed('workspace.write requires string content');
      }
      const write = guard.session.sandbox.filesystem.write(request.path, request.content);
      if (write.status === 'DENIED') {
        this.emitEvent(guard.session, 'sandbox.denied', { boundary: 'filesystem', code: write.denial.code, subject: write.denial.subject });
        return harnessFailed(renderSandboxDenial(write.denial));
      }
      this.emitEvent(guard.session, 'workspace.staged', { path: request.path, bytes: write.value.bytes });
      return harnessOk({ bytes: write.value.bytes });
    },
  };

  // -------------------------------------------------------------------------
  // §9 shell / browser — NOT advertised (explicit UNSUPPORTED)
  // -------------------------------------------------------------------------

  readonly shell = {
    exec: (_request: ShellExecRequest): HarnessResult<ShellExecResult> => {
      this.probe('shell.exec');
      return harnessUnsupported('shell.exec', 'the GitHub-aware project body advertises NO terminal capability — unsupported capabilities are explicit, never silent');
    },
  };

  readonly browser = {
    open: (_request: BrowserOpenRequest): HarnessResult<BrowserOpenResult> => {
      this.probe('browser.open');
      return harnessUnsupported('browser.open', 'the GitHub-aware project body advertises NO browser capability — unsupported capabilities are explicit, never silent');
    },
    interact: (_request: BrowserInteractRequest): HarnessResult<BrowserInteractResult> => {
      this.probe('browser.interact');
      return harnessUnsupported('browser.interact', 'the GitHub-aware project body advertises NO browser capability — unsupported capabilities are explicit, never silent');
    },
  };

  // -------------------------------------------------------------------------
  // §9 git (typed records through the repository operations seam)
  // -------------------------------------------------------------------------

  readonly git = {
    status: (request: GitStatusRequest): HarnessResult<GitStatusResult> => {
      this.probe('git.status');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const staged = this.stagedSnapshot(guard.session);
      const changed = changedPaths(staged, guard.session.git.head);
      return harnessOk({ branch: guard.session.git.branch, clean: changed.length === 0, changed });
    },
    diff: (request: GitDiffRequest): HarnessResult<GitDiffResult> => {
      this.probe('git.diff');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const staged = this.stagedSnapshot(guard.session);
      // The honest body-side view: the task's changeset (staged files vs
      // the commits THIS task landed through the provider).
      return harnessOk({ diff: renderWorkspaceDiff(staged, guard.session.git.head) });
    },
    commit: (request: GitCommitRequest): HarnessResult<GitCommitResult> => {
      this.probe('git.commit');
      if (!isOperationAdvertised(this.capabilitiesValue, 'git.commit')) {
        return harnessUnsupported('git.commit', 'the repository provider session supporting this body does not support commit operations — the advertisement is honest, unsupported capabilities are explicit');
      }
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      if (typeof request.message !== 'string' || request.message.length === 0) {
        return harnessFailed('git.commit requires a non-empty message');
      }
      if (!Array.isArray(request.paths) || !request.paths.every((path) => typeof path === 'string')) {
        return harnessFailed('git.commit requires paths as a string array');
      }
      const staged = this.stagedSnapshot(session);
      const changed = changedPaths(staged, session.git.head);
      const paths = request.paths.length === 0 ? changed : request.paths.filter((path) => staged.has(path));
      if (paths.length === 0) {
        return harnessFailed('git.commit found nothing to commit — the staging area matches the task\'s committed state (or the requested paths are not staged)');
      }
      // HONEST NOT_YET_CONNECTED — never fabricated.
      if (this.options.repositoryOperations.connection().status !== 'CONNECTED') {
        return this.notYetConnectedFailure();
      }
      const slug = repositorySlug(this.options.repository);
      const exchange = this.authorizeProviderExchange(session, `/repos/${slug}/commits`);
      if (!exchange.ok) {
        return exchange.failure;
      }
      const outcome = this.options.repositoryOperations.commitFiles({
        repository: this.options.repository,
        branch: session.git.branch,
        message: request.message,
        files: paths.map((path) => ({ path, contents: staged.get(path)! })),
      });
      if (outcome.status === 'UNSUPPORTED') {
        return harnessFailed(`the repository provider does not support commit operations: ${outcome.reason}`);
      }
      const commit: GitCommitRecord = {
        commit_ref: outcome.result.sha,
        message: request.message,
        paths: [...paths].sort(),
      };
      session.git.commits.push(commit);
      for (const path of paths) {
        session.git.head.set(path, staged.get(path)!);
      }
      session.headSha = outcome.result.sha;
      this.emitEvent(session, 'git.committed', { commit_ref: commit.commit_ref, message: request.message, files: paths.length, branch: session.git.branch });
      return harnessOk({ commit_ref: commit.commit_ref, files: paths.length });
    },
    push: (request: GitPushRequest): HarnessResult<GitPushResult> => {
      this.probe('git.push');
      if (!isOperationAdvertised(this.capabilitiesValue, 'git.push')) {
        return harnessUnsupported('git.push', 'the repository provider session supporting this body does not support commit operations — the advertisement is honest, unsupported capabilities are explicit');
      }
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      if (typeof request.remote !== 'string' || request.remote.length === 0) {
        return harnessFailed('git.push requires a non-empty remote');
      }
      if (typeof request.ref !== 'string' || request.ref.length === 0) {
        return harnessFailed('git.push requires a non-empty ref');
      }
      // HONEST NOT_YET_CONNECTED — the delivery record requires a live provider.
      if (this.options.repositoryOperations.connection().status !== 'CONNECTED') {
        return this.notYetConnectedFailure();
      }
      const slug = repositorySlug(this.options.repository);
      const exchange = this.authorizeProviderExchange(session, `/repos/${slug}/pushes`);
      if (!exchange.ok) {
        return exchange.failure;
      }
      const pushed: GitPushRecord = { remote: request.remote, ref: request.ref, pushed_ref: `${request.remote}/${request.ref}` };
      session.git.pushes.push(pushed);
      this.emitEvent(session, 'git.pushed', { pushed_ref: pushed.pushed_ref, head_sha: session.headSha });
      return harnessOk({ pushed_ref: pushed.pushed_ref });
    },
    createBranch: (request: GitCreateBranchRequest): HarnessResult<GitCreateBranchResult> => {
      this.probe('git.createBranch');
      if (!isOperationAdvertised(this.capabilitiesValue, 'git.createBranch')) {
        return harnessUnsupported('git.createBranch', 'the repository provider session supporting this body does not support branch creation — the advertisement is honest, unsupported capabilities are explicit');
      }
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      if (typeof request.name !== 'string' || request.name.length === 0) {
        return harnessFailed('git.createBranch requires a non-empty name');
      }
      // HONEST NOT_YET_CONNECTED.
      if (this.options.repositoryOperations.connection().status !== 'CONNECTED') {
        return this.notYetConnectedFailure();
      }
      const slug = repositorySlug(this.options.repository);
      const exchange = this.authorizeProviderExchange(session, `/repos/${slug}/git/refs`);
      if (!exchange.ok) {
        return exchange.failure;
      }
      // from_ref null -> the session's current HEAD; a named base resolves
      // to the task's base revision; anything else passes through (the
      // seam refuses unknown revisions honestly).
      let fromSha = session.headSha;
      if (request.from_ref !== null) {
        fromSha = request.from_ref === this.options.baseBranch ? this.options.baseSha : request.from_ref;
      }
      const outcome = this.options.repositoryOperations.createBranch({
        repository: this.options.repository,
        name: request.name,
        from_sha: fromSha,
      });
      if (outcome.status === 'UNSUPPORTED') {
        return harnessFailed(`the repository provider refused the branch creation: ${outcome.reason}`);
      }
      session.git.branch = outcome.result.name;
      session.headSha = outcome.result.head_sha;
      this.emitEvent(session, 'git.branch-created', { branch: outcome.result.name, from_sha: fromSha });
      return harnessOk({ branch: outcome.result.name });
    },
    createPullRequest: (request: GitCreatePullRequestRequest): HarnessResult<GitCreatePullRequestResult> => {
      this.probe('git.createPullRequest');
      if (!isOperationAdvertised(this.capabilitiesValue, 'git.createPullRequest')) {
        return harnessUnsupported('git.createPullRequest', 'the repository provider session supporting this body does not support pull-request operations — the advertisement is honest, unsupported capabilities are explicit');
      }
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      if (typeof request.title !== 'string' || request.title.length === 0) {
        return harnessFailed('git.createPullRequest requires a non-empty title');
      }
      if (typeof request.source_branch !== 'string' || request.source_branch.length === 0) {
        return harnessFailed('git.createPullRequest requires a non-empty source_branch');
      }
      if (typeof request.target_branch !== 'string' || request.target_branch.length === 0) {
        return harnessFailed('git.createPullRequest requires a non-empty target_branch');
      }
      // HONEST NOT_YET_CONNECTED.
      if (this.options.repositoryOperations.connection().status !== 'CONNECTED') {
        return this.notYetConnectedFailure();
      }
      const slug = repositorySlug(this.options.repository);
      const exchange = this.authorizeProviderExchange(session, `/repos/${slug}/pulls`);
      if (!exchange.ok) {
        return exchange.failure;
      }
      const outcome = this.options.repositoryOperations.createPullRequest({
        repository: this.options.repository,
        title: request.title,
        head_branch: request.source_branch,
        base_branch: request.target_branch,
        body: null,
      });
      if (outcome.status === 'UNSUPPORTED') {
        return harnessFailed(`the repository provider refused the pull request: ${outcome.reason}`);
      }
      const record: GitPullRequestRecord = {
        pull_request_ref: `pr-${outcome.result.number}`,
        title: request.title,
        source_branch: request.source_branch,
        target_branch: request.target_branch,
        url: outcome.result.url,
      };
      session.git.pullRequests.push(record);
      this.emitEvent(session, 'git.pull-request-created', { pull_request_ref: record.pull_request_ref, title: request.title, url: record.url });
      return harnessOk({ pull_request_ref: record.pull_request_ref, url: record.url });
    },
  };

  // -------------------------------------------------------------------------
  // §9 artifacts / observations / events
  // -------------------------------------------------------------------------

  readonly artifacts = {
    capture: (request: ArtifactsCaptureRequest): HarnessResult<ArtifactsCaptureResult> => {
      this.probe('artifacts.capture');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      if (typeof request.name !== 'string' || request.name.length === 0) {
        return harnessFailed('artifacts.capture requires a non-empty name');
      }
      if (typeof request.content !== 'string') {
        return harnessFailed('artifacts.capture requires string content');
      }
      const artifactId = `${request.task_ref}:artifact:${request.name}`;
      this.emitEvent(guard.session, 'artifacts.captured', { artifact_id: artifactId, size_bytes: request.content.length });
      return harnessOk({
        artifact_id: artifactId,
        size_bytes: request.content.length,
        description: `reference GitHub-aware project body captured ${request.name}`,
      });
    },
  };

  readonly observations = {
    emit: (request: ObservationsEmitRequest): HarnessResult<ObservationsEmitResult> => {
      this.probe('observations.emit');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      if (typeof request.observation_kind !== 'string' || request.observation_kind.length === 0) {
        return harnessFailed('observations.emit requires a non-empty observation_kind');
      }
      guard.session.observations.push({ kind: request.observation_kind, payload: request.payload });
      return harnessOk({ accepted: true });
    },
  };

  readonly events = {
    subscribe: (request: EventsSubscribeRequest): HarnessResult<EventsSubscribeResult> => {
      this.probe('events.subscribe');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      const startIndex = request.cursor === null ? 0 : session.events.findIndex((event) => event.event_id === request.cursor) + 1;
      const events = session.events.slice(startIndex);
      const last = events.length === 0 ? null : events[events.length - 1]!.event_id;
      return harnessOk({ events, next_cursor: last });
    },
  };
}
