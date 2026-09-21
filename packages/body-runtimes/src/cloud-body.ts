/**
 * THE DISPOSABLE CLOUD CODING/SHELL BODY (Work Order P8) — the reference
 * implementation of the primary autonomous execution path.
 *
 * Behind the merged P5 Harness Contract (@sos-2/harness):
 *
 *   - workspace read/write, bounded by a @sos-2/sandbox environment
 *     (scope, egress, secrets, budgets — violations surface as truthful
 *     FAILED results carrying the typed sandbox denial);
 *   - shell exec through the deterministic in-process shell simulator
 *     with the INJECTABLE command registry (no real process spawning);
 *   - git operations as typed records (branch/commit/push/PR — the
 *     advertisement honestly carries NO runtime/cloud integration: these
 *     are body-side typed records, provider repository operations live on
 *     the GitHub-aware project body);
 *   - artifact capture, observation emission and a cursor-based event
 *     stream.
 *
 * THE TASK CONTINUES WHILE THE USER'S COMPUTER IS OFF: the body is
 * placement "cloud", holds NO local-device handle of any kind and its
 * whole lifecycle (create -> execute -> release) is independent of any
 * user-device presence — pinned by tests.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env — the
 * sandbox policy and secrets are injected; refs and event ids are
 * deterministic sequences; the body is clock-less (the fabric stamps
 * instants).
 */

import { InvalidBodyRuntimeOptionsError } from './errors.js';
import { ShellSimulator } from './shell-simulator.js';
import type { ShellCommand, ShellCommandContext } from './shell-simulator.js';
import { changedPaths, createGitSessionState, commitRefFor, pullRequestRefFor, renderWorkspaceDiff } from './git-records.js';
import type { GitSessionState } from './git-records.js';
import { createLocalSandbox } from '@sos-2/sandbox';
import type { Sandbox, SandboxPolicy } from '@sos-2/sandbox';
import { renderSandboxDenial } from '@sos-2/sandbox';
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
import { harnessFailed, harnessOk, harnessUnsupported } from '@sos-2/harness';
import { assertValidHarnessCapabilities, assertValidHarnessIdentity } from '@sos-2/harness';
import { assertValidSandboxPolicy } from '@sos-2/sandbox';
import type { JsonValue } from '@sos-2/semantic-spine';

/** Options for the disposable cloud coding/shell body. */
export interface CloudCodingShellBodyOptions {
  /** The body id (a RUNTIME identifier — never a SOS semantic identity). */
  readonly bodyId: string;
  /** Vendor provenance (metadata ONLY — never identity, never a selection key). */
  readonly provider?: { readonly name: string; readonly version: string };
  /** Execution placement (default "cloud": the task continues while the user's computer is off). */
  readonly placement?: HarnessPlacement;
  /** The bounded-environment policy (filesystem scope, egress, secrets NAMES, budgets). */
  readonly sandboxPolicy: SandboxPolicy;
  /** Credential values injected into every task closure (live only inside the closure; never echoed). */
  readonly secrets?: Readonly<Record<string, string>>;
  /** The injectable shell command registry (defaults: the deterministic built-ins). */
  readonly commands?: readonly ShellCommand[];
  /** The cost envelope (defaults: derived from the sandbox resource envelope). */
  readonly costEnvelope?: { readonly maxDurationMs: number; readonly maxMemoryMb: number | null; readonly maxCostUsdPerTask: number | null };
}

interface CloudTaskSession {
  readonly taskRef: string;
  readonly sandbox: Sandbox;
  status: 'active' | 'paused' | 'cancelled';
  readonly git: GitSessionState;
  events: BodyEvent[];
  observations: { kind: string; payload: JsonValue }[];
}

/** Session guard: either the live session or a typed harness failure. */
type SessionGuard = { ok: true; session: CloudTaskSession } | { ok: false; failure: HarnessResult<never> };

/**
 * The disposable cloud coding/shell body — a deterministic reference
 * runtime implementing the §9 HarnessContract.
 */
export class CloudCodingShellBody implements HarnessContract {
  readonly identityValue: HarnessIdentity;
  readonly capabilitiesValue: HarnessCapabilities;
  /** Run-flag probes: dispatched operation counts, by operation name (audit). */
  readonly dispatches = new Map<string, number>();

  private readonly sessions = new Map<string, CloudTaskSession>();
  private readonly simulator: ShellSimulator;

  constructor(private readonly options: CloudCodingShellBodyOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new InvalidBodyRuntimeOptionsError('cloud-body', 'cloud coding/shell body options must be an object');
    }
    if (typeof options.bodyId !== 'string' || options.bodyId.length === 0 || options.bodyId.includes('sos://')) {
      throw new InvalidBodyRuntimeOptionsError('cloud-body', `bodyId must be a non-empty RUNTIME identifier (never a sos:// semantic identity), received: ${JSON.stringify(options.bodyId)}`);
    }
    assertValidSandboxPolicy(options.sandboxPolicy);
    if (options.sandboxPolicy.filesystem.mode === 'none') {
      throw new InvalidBodyRuntimeOptionsError(
        'cloud-body',
        'the disposable cloud coding/shell body requires a workspace filesystem scope — a coding body without a workspace is a typed contradiction (choose a different body kind)',
      );
    }
    this.simulator = new ShellSimulator(options.commands ?? undefined);
    const provider = options.provider ?? { name: 'reference-cloud-shell', version: '1.0.0' };
    this.identityValue = {
      harness_id: `harness:${options.bodyId}`,
      provider,
      placement: options.placement ?? 'cloud',
    };
    assertValidHarnessIdentity(this.identityValue);
    const policy = options.sandboxPolicy;
    this.capabilitiesValue = {
      capabilities: ['terminal', 'filesystem', 'repository-operations'],
      isolationLevel: 'process',
      networkPolicy: policy.network,
      filesystemScope: { mode: policy.filesystem.mode, root: policy.filesystem.root },
      browser: [],
      shell: ['exec'],
      git: ['status', 'diff', 'commit', 'push', 'createBranch', 'createPullRequest'],
      runtimeIntegrations: [],
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

  /** The bounded environment of one task session (audit/test probe). */
  sandboxOf(taskRef: string): Sandbox | null {
    return this.sessions.get(taskRef)?.sandbox ?? null;
  }

  /** The typed git records of one task session (audit/test probe; a clone). */
  gitStateOf(taskRef: string): GitSessionState | null {
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
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private probe(operation: string): void {
    this.dispatches.set(operation, (this.dispatches.get(operation) ?? 0) + 1);
  }

  private session(taskRef: string): CloudTaskSession | undefined {
    return this.sessions.get(taskRef);
  }

  private sessionGuard(taskRef: string): SessionGuard {
    const session = this.sessions.get(taskRef);
    if (session === undefined) {
      return { ok: false, failure: harnessFailed(`no task session ${JSON.stringify(taskRef)} on this body — createTask or resumeTask first`) };
    }
    if (session.status === 'cancelled') {
      return { ok: false, failure: harnessFailed(`task ${JSON.stringify(taskRef)} is cancelled on this body`) };
    }
    return { ok: true, session };
  }

  private emitEvent(session: CloudTaskSession, kind: string, payload: JsonValue): void {
    session.events.push({
      event_id: `${session.taskRef}:ev-${String(session.events.length + 1).padStart(4, '0')}`,
      kind,
      payload,
    });
  }

  /** The workspace snapshot through the sandbox (deterministic). */
  private workspaceSnapshot(session: CloudTaskSession): Map<string, string> {
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

  private shellContext(session: CloudTaskSession): ShellCommandContext {
    return {
      taskRef: session.taskRef,
      readWorkspaceFile: (path) => {
        const read = session.sandbox.filesystem.read(path);
        return read.status === 'OK' ? read.value.content : null;
      },
      listWorkspaceFiles: () => {
        const listed = session.sandbox.filesystem.list();
        return listed.status === 'OK' ? [...listed.value.paths] : [];
      },
      emitEvent: (kind, payload) => this.emitEvent(session, kind, payload),
    };
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
    const session: CloudTaskSession = {
      taskRef: request.task_ref,
      sandbox,
      status: 'active',
      git: createGitSessionState('main'),
      events: [],
      observations: [],
    };
    this.sessions.set(request.task_ref, session);
    this.emitEvent(session, 'task.created', { input: request.input });
    const root = this.options.sandboxPolicy.filesystem.root ?? '';
    return harnessOk({ accepted: true, workspace_root: `${root}/${request.task_ref}` });
  }

  resumeTask(request: ResumeTaskRequest): HarnessResult<ResumeTaskResult> {
    this.probe('resumeTask');
    const existing = this.sessions.get(request.task_ref);
    if (existing !== undefined && existing.status === 'cancelled') {
      return harnessFailed(`task ${request.task_ref} is cancelled on this body`);
    }
    // A REPLACEMENT body has never seen the task: it ADOPTS it with a
    // fresh bounded environment (body-side state did not survive the
    // replacement — the durable task record is the truth; `recovered`
    // reports honestly what this body still holds).
    const session = existing ?? this.createSessionForAdoption(request.task_ref);
    session.status = 'active';
    return harnessOk({
      state: 'resumed',
      recovered:
        existing === undefined
          ? { adopted_by_replacement: true, files: 0, commits: 0 }
          : { adopted_by_replacement: false, files: this.workspaceSnapshot(session).size, commits: session.git.commits.length },
    });
  }

  private createSessionForAdoption(taskRef: string): CloudTaskSession {
    const sandbox = createLocalSandbox({ policy: this.options.sandboxPolicy, secrets: this.options.secrets });
    const session: CloudTaskSession = {
      taskRef,
      sandbox,
      status: 'active',
      git: createGitSessionState('main'),
      events: [],
      observations: [],
    };
    this.sessions.set(taskRef, session);
    this.emitEvent(session, 'task.adopted-by-replacement', { task_ref: taskRef });
    return session;
  }

  pauseTask(request: PauseTaskRequest): HarnessResult<PauseTaskResult> {
    this.probe('pauseTask');
    const guard = this.sessionGuard(request.task_ref);
    if (!guard.ok) {
      return guard.failure;
    }
    const session = guard.session;
    session.status = 'paused';
    this.emitEvent(session, 'task.paused', {});
    return harnessOk({ state: 'paused' });
  }

  cancelTask(request: CancelTaskRequest): HarnessResult<CancelTaskResult> {
    this.probe('cancelTask');
    const guard = this.sessionGuard(request.task_ref);
    if (!guard.ok) {
      return guard.failure;
    }
    const session = guard.session;
    session.status = 'cancelled';
    session.sandbox.end(`task ${request.task_ref} cancelled — the credential closure dies with the session`);
    this.emitEvent(session, 'task.cancelled', {});
    return harnessOk({ state: 'cancelled' });
  }

  // -------------------------------------------------------------------------
  // §9 workspace (bounded by the sandbox)
  // -------------------------------------------------------------------------

  readonly workspace = {
    read: (request: WorkspaceReadRequest): HarnessResult<WorkspaceReadResult> => {
      this.probe('workspace.read');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      if (typeof request.path !== 'string' || request.path.length === 0) {
        return harnessFailed('workspace.read requires a non-empty path');
      }
      const read = session.sandbox.filesystem.read(request.path);
      if (read.status === 'DENIED') {
        this.emitEvent(session, 'sandbox.denied', { boundary: 'filesystem', code: read.denial.code, subject: read.denial.subject });
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
      const session = guard.session;
      if (typeof request.path !== 'string' || request.path.length === 0) {
        return harnessFailed('workspace.write requires a non-empty path');
      }
      if (typeof request.content !== 'string') {
        return harnessFailed('workspace.write requires string content');
      }
      const write = session.sandbox.filesystem.write(request.path, request.content);
      if (write.status === 'DENIED') {
        this.emitEvent(session, 'sandbox.denied', { boundary: 'filesystem', code: write.denial.code, subject: write.denial.subject });
        return harnessFailed(renderSandboxDenial(write.denial));
      }
      this.emitEvent(session, 'workspace.wrote', { path: request.path, bytes: write.value.bytes });
      return harnessOk({ bytes: write.value.bytes });
    },
  };

  // -------------------------------------------------------------------------
  // §9 shell (deterministic in-process simulator, injectable registry)
  // -------------------------------------------------------------------------

  readonly shell = {
    exec: (request: ShellExecRequest): HarnessResult<ShellExecResult> => {
      this.probe('shell.exec');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      if (typeof request.command !== 'string' || request.command.length === 0) {
        return harnessFailed('shell.exec requires a non-empty command');
      }
      if (!Array.isArray(request.args) || !request.args.every((arg) => typeof arg === 'string')) {
        return harnessFailed('shell.exec requires args as a string array');
      }
      if (request.cwd !== null && (typeof request.cwd !== 'string' || request.cwd.length === 0)) {
        return harnessFailed('shell.exec cwd must be null or a non-empty string');
      }
      // The resource envelope bounds command executions (an injected limit).
      const consumed = session.sandbox.budget.consume('shellCommands', 1);
      if (consumed.status === 'DENIED') {
        this.emitEvent(session, 'sandbox.denied', { boundary: 'budget', code: consumed.denial.code, subject: consumed.denial.subject });
        return harnessFailed(renderSandboxDenial(consumed.denial));
      }
      const result = this.simulator.exec(request.command, request.args, this.shellContext(session));
      this.emitEvent(session, 'shell.executed', { command: request.command, exit_code: result.exit_code, cwd: request.cwd });
      return harnessOk({ exit_code: result.exit_code, stdout: result.stdout, stderr: result.stderr });
    },
  };

  // -------------------------------------------------------------------------
  // §9 browser — NOT advertised (explicit UNSUPPORTED)
  // -------------------------------------------------------------------------

  readonly browser = {
    open: (_request: BrowserOpenRequest): HarnessResult<BrowserOpenResult> => {
      this.probe('browser.open');
      return harnessUnsupported('browser.open', 'the disposable cloud coding/shell body advertises NO browser capability — unsupported capabilities are explicit, never silent');
    },
    interact: (_request: BrowserInteractRequest): HarnessResult<BrowserInteractResult> => {
      this.probe('browser.interact');
      return harnessUnsupported('browser.interact', 'the disposable cloud coding/shell body advertises NO browser capability — unsupported capabilities are explicit, never silent');
    },
  };

  // -------------------------------------------------------------------------
  // §9 git (typed records)
  // -------------------------------------------------------------------------

  readonly git = {
    status: (request: GitStatusRequest): HarnessResult<GitStatusResult> => {
      this.probe('git.status');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      const workspace = this.workspaceSnapshot(session);
      const changed = changedPaths(workspace, session.git.head);
      return harnessOk({ branch: session.git.branch, clean: changed.length === 0, changed });
    },
    diff: (request: GitDiffRequest): HarnessResult<GitDiffResult> => {
      this.probe('git.diff');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      const workspace = this.workspaceSnapshot(session);
      return harnessOk({ diff: renderWorkspaceDiff(workspace, session.git.head) });
    },
    commit: (request: GitCommitRequest): HarnessResult<GitCommitResult> => {
      this.probe('git.commit');
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
      const workspace = this.workspaceSnapshot(session);
      const changed = changedPaths(workspace, session.git.head);
      const paths = request.paths.length === 0 ? changed : request.paths.filter((path) => workspace.has(path));
      if (paths.length === 0) {
        return harnessFailed('git.commit found nothing to commit — the working tree matches HEAD (or the requested paths do not exist)');
      }
      const commitRef = commitRefFor(session.git.commits.length + 1);
      session.git.commits.push({ commit_ref: commitRef, message: request.message, paths: [...paths].sort() });
      for (const path of paths) {
        session.git.head.set(path, workspace.get(path)!);
      }
      this.emitEvent(session, 'git.committed', { commit_ref: commitRef, message: request.message, files: paths.length });
      return harnessOk({ commit_ref: commitRef, files: paths.length });
    },
    push: (request: GitPushRequest): HarnessResult<GitPushResult> => {
      this.probe('git.push');
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
      const pushedRef = `${request.remote}/${request.ref}`;
      session.git.pushes.push({ remote: request.remote, ref: request.ref, pushed_ref: pushedRef });
      this.emitEvent(session, 'git.pushed', { pushed_ref: pushedRef });
      return harnessOk({ pushed_ref: pushedRef });
    },
    createBranch: (request: GitCreateBranchRequest): HarnessResult<GitCreateBranchResult> => {
      this.probe('git.createBranch');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      if (typeof request.name !== 'string' || request.name.length === 0) {
        return harnessFailed('git.createBranch requires a non-empty name');
      }
      session.git.branch = request.name;
      this.emitEvent(session, 'git.branch-created', { branch: request.name, from_ref: request.from_ref });
      return harnessOk({ branch: request.name });
    },
    createPullRequest: (request: GitCreatePullRequestRequest): HarnessResult<GitCreatePullRequestResult> => {
      this.probe('git.createPullRequest');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      if (typeof request.title !== 'string' || request.title.length === 0) {
        return harnessFailed('git.createPullRequest requires a non-empty title');
      }
      const pullRequestRef = pullRequestRefFor(session.git.pullRequests.length + 1);
      session.git.pullRequests.push({
        pull_request_ref: pullRequestRef,
        title: request.title,
        source_branch: request.source_branch,
        target_branch: request.target_branch,
        url: null,
      });
      this.emitEvent(session, 'git.pull-request-created', { pull_request_ref: pullRequestRef, title: request.title });
      return harnessOk({ pull_request_ref: pullRequestRef, url: null });
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
      const session = guard.session;
      if (typeof request.name !== 'string' || request.name.length === 0) {
        return harnessFailed('artifacts.capture requires a non-empty name');
      }
      if (typeof request.content !== 'string') {
        return harnessFailed('artifacts.capture requires string content');
      }
      const artifactId = `${request.task_ref}:artifact:${request.name}`;
      this.emitEvent(session, 'artifacts.captured', { artifact_id: artifactId, size_bytes: request.content.length });
      return harnessOk({
        artifact_id: artifactId,
        size_bytes: request.content.length,
        description: `reference cloud coding/shell body captured ${request.name}`,
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
      const session = guard.session;
      if (typeof request.observation_kind !== 'string' || request.observation_kind.length === 0) {
        return harnessFailed('observations.emit requires a non-empty observation_kind');
      }
      session.observations.push({ kind: request.observation_kind, payload: request.payload });
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
