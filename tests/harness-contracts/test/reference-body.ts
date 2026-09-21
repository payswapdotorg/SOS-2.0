/**
 * THE REFERENCE (FAKE) BODY (Work Order P5 acceptance suites).
 *
 * A complete in-memory implementation of the §9 HarnessContract:
 * identity/capabilities, task lifecycle, workspace (an in-memory tree),
 * shell (a tiny deterministic command interpreter: echo/cat/ls/test),
 * git (a simulated branch/commit/push/PR log), browser (only where
 * advertised — the reference cloud body advertises NONE: unsupported
 * capabilities stay explicit), artifacts capture, observations emission
 * and a cursor-based event stream.
 *
 * The body is deliberately provider-shaped but provider-NEUTRAL: its
 * vendor name is provenance metadata, never identity, never a selection
 * key. It is clock-less (the fabric stamps instants) and fully
 * deterministic. Run-flag probes let the negative suites PROVE that
 * denied operations never dispatched.
 */

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

export interface ReferenceBodyOptions {
  readonly bodyId: string;
  readonly providerName: string;
  readonly providerVersion?: string;
  readonly placement?: 'cloud' | 'remote' | 'user-device';
  /** Advertise browser capability (default: NOT advertised — explicit). */
  readonly withBrowser?: boolean;
  /** When set, every dispatched operation fails with this error (truthful). */
  readonly failEveryOperation?: string | null;
}

interface TaskSession {
  files: Map<string, string>;
  branch: string;
  commits: { ref: string; message: string; files: number }[];
  status: 'active' | 'paused' | 'cancelled';
  pushed: string[];
  pullRequests: { ref: string; title: string; url: string }[];
  browserPages: Map<string, string>;
  events: BodyEvent[];
  observations: { kind: string; payload: unknown }[];
}

/** The reference body — a complete, deterministic §9 implementation. */
export class ReferenceBody implements HarnessContract {
  readonly identityValue: HarnessIdentity;
  readonly capabilitiesValue: HarnessCapabilities;
  /** Run-flag probes: dispatched operation counts, by operation name. */
  readonly dispatches = new Map<string, number>();
  /** When set, every post-create operation FAILS with this reason (truthful). */
  private brokenOperations: string | null = null;

  private readonly sessions = new Map<string, TaskSession>();

  /** Break every post-create operation (the body session stays; the environment fails). */
  breakOperations(reason: string): void {
    this.brokenOperations = reason;
  }

  private operationGate(): string | null {
    return this.options.failEveryOperation ?? this.brokenOperations;
  }

  constructor(private readonly options: ReferenceBodyOptions) {
    this.identityValue = {
      harness_id: `harness:${options.bodyId}`,
      provider: { name: options.providerName, version: options.providerVersion ?? '1.0.0' },
      placement: options.placement ?? 'cloud',
    };
    this.capabilitiesValue = {
      capabilities: options.withBrowser
        ? ['terminal', 'filesystem', 'repository-operations', 'browser-ui', 'runtime-cloud-apis']
        : ['terminal', 'filesystem', 'repository-operations', 'runtime-cloud-apis'],
      isolationLevel: 'container',
      networkPolicy: { egress: 'allowlist', allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
      filesystemScope: { mode: 'workspace', root: `/workspace/${options.bodyId}` },
      browser: options.withBrowser ? ['open', 'interact'] : [],
      shell: ['exec'],
      git: ['status', 'diff', 'commit', 'push', 'createBranch', 'createPullRequest'],
      runtimeIntegrations: [
        {
          capability: 'github',
          operations: ['push', 'createPullRequest'],
          integrations: [
            {
              integration_id: `${options.bodyId}:github-api`,
              tier: 'native-api',
              capability: 'github',
              endpoint: 'https://api.github.com',
              operations: ['push', 'createPullRequest'],
              available: true,
            },
            {
              integration_id: `${options.bodyId}:github-ui`,
              tier: 'ui-automation',
              capability: 'github',
              endpoint: 'driver:github.com',
              operations: ['push', 'createPullRequest'],
              available: true,
            },
          ],
          boundedEnvironment: null,
        },
      ],
      taskLifecycle: { create: true, resume: true, pause: true, cancel: true, checkpoints: true },
      evidenceCapture: { artifacts: true, observations: true, events: true },
      costEnvelope: { maxDurationMs: 7_200_000, maxMemoryMb: 2048, maxCostUsdPerTask: 1.0 },
    };
  }

  private probe(operation: string): void {
    this.dispatches.set(operation, (this.dispatches.get(operation) ?? 0) + 1);
  }

  private session(taskRef: string): TaskSession {
    let session = this.sessions.get(taskRef);
    if (session === undefined) {
      session = {
        files: new Map<string, string>(),
        branch: 'main',
        commits: [],
        status: 'active',
        pushed: [],
        pullRequests: [],
        browserPages: new Map<string, string>(),
        events: [],
        observations: [],
      };
      this.sessions.set(taskRef, session);
    }
    return session;
  }

  identity(): HarnessIdentity {
    return this.identityValue;
  }

  capabilities(): HarnessCapabilities {
    return this.capabilitiesValue;
  }

  createTask(request: CreateTaskRequest): HarnessResult<CreateTaskResult> {
    this.probe('createTask');
    const failure = this.operationGate();
    if (failure !== null) {
      return harnessFailed(failure);
    }
    const session = this.session(request.task_ref);
    session.events.push({ event_id: `${request.task_ref}:ev-0001`, kind: 'task.created', payload: { input: request.input } });
    return harnessOk({ accepted: true, workspace_root: `/workspace/${this.options.bodyId}/${request.task_ref}` });
  }

  resumeTask(request: ResumeTaskRequest): HarnessResult<ResumeTaskResult> {
    this.probe('resumeTask');
    const failure = this.operationGate();
    if (failure !== null) {
      return harnessFailed(failure);
    }
    const existing = this.sessions.get(request.task_ref);
    if (existing !== undefined && existing.status === 'cancelled') {
      return harnessFailed(`task ${request.task_ref} is cancelled on this body`);
    }
    // A REPLACEMENT body has never seen the task: it ADOPTS it with a
    // fresh session (body-side state did not survive the replacement —
    // the durable task record is the truth; `recovered` reports honestly
    // what this body still holds).
    const session = existing ?? this.session(request.task_ref);
    session.status = 'active';
    return harnessOk({
      state: 'resumed',
      recovered:
        existing === undefined
          ? { adopted_by_replacement: true, files: 0, commits: 0 }
          : { adopted_by_replacement: false, files: session.files.size, commits: session.commits.length },
    });
  }

  pauseTask(request: PauseTaskRequest): HarnessResult<PauseTaskResult> {
    this.probe('pauseTask');
    const session = this.session(request.task_ref);
    session.status = 'paused';
    return harnessOk({ state: 'paused' });
  }

  cancelTask(request: CancelTaskRequest): HarnessResult<CancelTaskResult> {
    this.probe('cancelTask');
    const session = this.session(request.task_ref);
    session.status = 'cancelled';
    return harnessOk({ state: 'cancelled' });
  }

  readonly workspace = {
    read: (request: WorkspaceReadRequest): HarnessResult<WorkspaceReadResult> => {
      this.probe('workspace.read');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      const content = session.files.get(request.path);
      if (content === undefined) {
        return harnessFailed(`no such file: ${request.path}`);
      }
      return harnessOk({ content });
    },
    write: (request: WorkspaceWriteRequest): HarnessResult<WorkspaceWriteResult> => {
      this.probe('workspace.write');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      session.files.set(request.path, request.content);
      session.events.push({
        event_id: `${request.task_ref}:ev-${String(session.events.length + 1).padStart(4, '0')}`,
        kind: 'workspace.wrote',
        payload: { path: request.path, bytes: request.content.length },
      });
      return harnessOk({ bytes: request.content.length });
    },
  };

  readonly shell = {
    exec: (request: ShellExecRequest): HarnessResult<ShellExecResult> => {
      this.probe('shell.exec');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      if (request.command === 'echo') {
        return harnessOk({ exit_code: 0, stdout: request.args.join(' '), stderr: '' });
      }
      if (request.command === 'cat') {
        const path = request.args[0] ?? '';
        const content = session.files.get(path);
        if (content === undefined) {
          return harnessOk({ exit_code: 1, stdout: '', stderr: `cat: ${path}: no such file` });
        }
        return harnessOk({ exit_code: 0, stdout: content, stderr: '' });
      }
      if (request.command === 'ls') {
        return harnessOk({ exit_code: 0, stdout: [...session.files.keys()].sort().join('\n'), stderr: '' });
      }
      if (request.command === 'exit') {
        return harnessOk({ exit_code: Number(request.args[0] ?? '0'), stdout: '', stderr: '' });
      }
      return harnessOk({ exit_code: 127, stdout: '', stderr: `command not found: ${request.command}` });
    },
  };

  readonly browser = {
    open: (request: BrowserOpenRequest): HarnessResult<BrowserOpenResult> => {
      this.probe('browser.open');
      if (this.capabilitiesValue.browser.length === 0) {
        return harnessUnsupported('browser.open', 'this body advertises NO browser capability — unsupported capabilities are explicit, never silent');
      }
      const session = this.session(request.task_ref);
      const pageId = `page-${session.browserPages.size + 1}`;
      session.browserPages.set(pageId, request.url);
      return harnessOk({ page_id: pageId, url: request.url, title: `Fake page: ${request.url}` });
    },
    interact: (request: BrowserInteractRequest): HarnessResult<BrowserInteractResult> => {
      this.probe('browser.interact');
      if (this.capabilitiesValue.browser.length === 0) {
        return harnessUnsupported('browser.interact', 'this body advertises NO browser capability — unsupported capabilities are explicit, never silent');
      }
      const session = this.session(request.task_ref);
      const url = session.browserPages.get(request.page_id);
      if (url === undefined) {
        return harnessFailed(`no such page: ${request.page_id}`);
      }
      if (request.action === 'read') {
        return harnessOk({ result: `content of ${request.target} on ${url}` });
      }
      return harnessOk({ result: null });
    },
  };

  readonly git = {
    status: (request: GitStatusRequest): HarnessResult<GitStatusResult> => {
      this.probe('git.status');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      return harnessOk({ branch: session.branch, clean: session.commits.length > 0, changed: [] });
    },
    diff: (request: GitDiffRequest): HarnessResult<GitDiffResult> => {
      this.probe('git.diff');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      const lines = [...session.files.entries()].sort().map(([path, content]) => `--- a/${path}\n+++ b/${path}\n${content.split('\n').map((line) => `+${line}`).join('\n')}`);
      return harnessOk({ diff: lines.join('\n') });
    },
    commit: (request: GitCommitRequest): HarnessResult<GitCommitResult> => {
      this.probe('git.commit');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      const commitRef = `commit-${String(session.commits.length + 1).padStart(3, '0')}`;
      const files = request.paths.length > 0 ? request.paths.length : session.files.size;
      session.commits.push({ ref: commitRef, message: request.message, files });
      return harnessOk({ commit_ref: commitRef, files });
    },
    push: (request: GitPushRequest): HarnessResult<GitPushResult> => {
      this.probe('git.push');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      const pushedRef = `${request.remote}/${request.ref}`;
      session.pushed.push(pushedRef);
      return harnessOk({ pushed_ref: pushedRef });
    },
    createBranch: (request: GitCreateBranchRequest): HarnessResult<GitCreateBranchResult> => {
      this.probe('git.createBranch');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      session.branch = request.name;
      return harnessOk({ branch: request.name });
    },
    createPullRequest: (request: GitCreatePullRequestRequest): HarnessResult<GitCreatePullRequestResult> => {
      this.probe('git.createPullRequest');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      const ref = `pr-${String(session.pullRequests.length + 1).padStart(3, '0')}`;
      const url = `https://github.com/example/sos/pull/${session.pullRequests.length + 1}`;
      session.pullRequests.push({ ref, title: request.title, url });
      return harnessOk({ pull_request_ref: ref, url });
    },
  };

  readonly artifacts = {
    capture: (request: ArtifactsCaptureRequest): HarnessResult<ArtifactsCaptureResult> => {
      this.probe('artifacts.capture');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      return harnessOk({
        artifact_id: `${request.task_ref}:${request.name}`,
        size_bytes: request.content.length,
        description: `reference body captured ${request.name}`,
      });
    },
  };

  readonly observations = {
    emit: (request: ObservationsEmitRequest): HarnessResult<ObservationsEmitResult> => {
      this.probe('observations.emit');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      session.observations.push({ kind: request.observation_kind, payload: request.payload });
      return harnessOk({ accepted: true });
    },
  };

  readonly events = {
    subscribe: (request: EventsSubscribeRequest): HarnessResult<EventsSubscribeResult> => {
      this.probe('events.subscribe');
      const failure = this.operationGate();
      if (failure !== null) {
        return harnessFailed(failure);
      }
      const session = this.session(request.task_ref);
      const startIndex = request.cursor === null ? 0 : session.events.findIndex((event) => event.event_id === request.cursor) + 1;
      const events = session.events.slice(startIndex);
      const last = events.length === 0 ? null : events[events.length - 1]!.event_id;
      return harnessOk({ events, next_cursor: last });
    },
  };
}
