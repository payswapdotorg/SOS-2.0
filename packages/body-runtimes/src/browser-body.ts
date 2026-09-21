/**
 * THE BROWSER/EVALUATOR BODY (Work Order P8) — a capability-advertised
 * browser-journey body behind the merged P5 Harness Contract.
 *
 * browser.open / browser.interact are TYPED RECORDS through the
 * INJECTABLE browser port (@see browser-port.ts): the real browser
 * bridge is a LATER-WAVE adapter that attaches behind the same port
 * without contract change — THIS BODY PROVES THE CONTRACT.
 *
 * Honest advertisement:
 *   - browser-ui capability with open/interact operations;
 *   - NO terminal, NO filesystem, NO repository-operations — shell.exec,
 *     git.* and workspace.* answer typed UNSUPPORTED (explicit, never
 *     silent);
 *   - the body enforces its own network policy on browser.open (a URL
 *     whose host is not admitted is a truthful FAILED result, never a
 *     silent navigation).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env — the port
 * and fixtures are injected; page ids and event ids are deterministic
 * sequences; the body is clock-less.
 */

import { InvalidBodyRuntimeOptionsError } from './errors.js';
import type { BrowserPort } from './browser-port.js';
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
import type { JsonValue } from '@sos-2/semantic-spine';

/** Options for the browser/evaluator body. */
export interface BrowserEvaluatorBodyOptions {
  /** The body id (a RUNTIME identifier — never a SOS semantic identity). */
  readonly bodyId: string;
  /** Vendor provenance (metadata ONLY). */
  readonly provider?: { readonly name: string; readonly version: string };
  /** Execution placement (default "cloud"). */
  readonly placement?: HarnessPlacement;
  /** The injectable browser port (typed records; the real bridge attaches later). */
  readonly browserPort: BrowserPort;
  /** The hosts browser.open may navigate (the body's own network policy). */
  readonly allowedHosts: readonly string[];
  /** The cost envelope. */
  readonly costEnvelope?: { readonly maxDurationMs: number; readonly maxMemoryMb: number | null; readonly maxCostUsdPerTask: number | null };
}

interface BrowserTaskSession {
  readonly taskRef: string;
  status: 'active' | 'paused' | 'cancelled';
  events: BodyEvent[];
  observations: { kind: string; payload: JsonValue }[];
}

/** Extract the host of a URL-ish string (deterministic, no URL API dependency). */
export function hostOfUrl(url: string): string | null {
  const match = /^https?:\/\/([^/?#\s]+)/.exec(url);
  return match === null ? null : match[1] ?? null;
}

/**
 * The browser/evaluator body — a deterministic reference runtime proving
 * the browser-journey contract.
 */
export class BrowserEvaluatorBody implements HarnessContract {
  readonly identityValue: HarnessIdentity;
  readonly capabilitiesValue: HarnessCapabilities;
  /** Run-flag probes: dispatched operation counts, by operation name (audit). */
  readonly dispatches = new Map<string, number>();

  private readonly sessions = new Map<string, BrowserTaskSession>();

  constructor(private readonly options: BrowserEvaluatorBodyOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new InvalidBodyRuntimeOptionsError('browser-body', 'browser/evaluator body options must be an object');
    }
    if (typeof options.bodyId !== 'string' || options.bodyId.length === 0 || options.bodyId.includes('sos://')) {
      throw new InvalidBodyRuntimeOptionsError('browser-body', `bodyId must be a non-empty RUNTIME identifier (never a sos:// semantic identity), received: ${JSON.stringify(options.bodyId)}`);
    }
    if (typeof options.browserPort !== 'object' || options.browserPort === null) {
      throw new InvalidBodyRuntimeOptionsError('browser-body', 'the browser/evaluator body requires an injected browser port');
    }
    if (
      !Array.isArray(options.allowedHosts) ||
      options.allowedHosts.length === 0 ||
      !options.allowedHosts.every((host) => typeof host === 'string' && host.length > 0 && !/\s/.test(host)) ||
      new Set(options.allowedHosts).size !== options.allowedHosts.length
    ) {
      throw new InvalidBodyRuntimeOptionsError('browser-body', 'allowedHosts must be a non-empty, duplicate-free array of whitespace-free host names');
    }
    const provider = options.provider ?? { name: 'reference-browser-evaluator', version: '1.0.0' };
    this.identityValue = {
      harness_id: `harness:${options.bodyId}`,
      provider,
      placement: options.placement ?? 'cloud',
    };
    assertValidHarnessIdentity(this.identityValue);
    this.capabilitiesValue = {
      capabilities: ['browser-ui'],
      isolationLevel: 'process',
      networkPolicy: { egress: 'allowlist', allowedHosts: [...options.allowedHosts] },
      filesystemScope: { mode: 'none', root: null },
      browser: ['open', 'interact'],
      shell: [],
      git: [],
      runtimeIntegrations: [],
      taskLifecycle: { create: true, resume: true, pause: true, cancel: true, checkpoints: true },
      evidenceCapture: { artifacts: true, observations: true, events: true },
      costEnvelope: options.costEnvelope ?? { maxDurationMs: 1_800_000, maxMemoryMb: 1024, maxCostUsdPerTask: null },
    };
    assertValidHarnessCapabilities(this.capabilitiesValue);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private probe(operation: string): void {
    this.dispatches.set(operation, (this.dispatches.get(operation) ?? 0) + 1);
  }

  private sessionGuard(taskRef: string): { ok: true; session: BrowserTaskSession } | { ok: false; failure: HarnessResult<never> } {
    const session = this.sessions.get(taskRef);
    if (session === undefined) {
      return { ok: false, failure: harnessFailed(`no task session ${JSON.stringify(taskRef)} on this body — createTask or resumeTask first`) };
    }
    if (session.status === 'cancelled') {
      return { ok: false, failure: harnessFailed(`task ${JSON.stringify(taskRef)} is cancelled on this body`) };
    }
    return { ok: true, session };
  }

  private emitEvent(session: BrowserTaskSession, kind: string, payload: JsonValue): void {
    session.events.push({
      event_id: `${session.taskRef}:ev-${String(session.events.length + 1).padStart(4, '0')}`,
      kind,
      payload,
    });
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
    const session: BrowserTaskSession = { taskRef: request.task_ref, status: 'active', events: [], observations: [] };
    this.sessions.set(request.task_ref, session);
    this.emitEvent(session, 'task.created', { input: request.input });
    return harnessOk({ accepted: true, workspace_root: null });
  }

  resumeTask(request: ResumeTaskRequest): HarnessResult<ResumeTaskResult> {
    this.probe('resumeTask');
    const existing = this.sessions.get(request.task_ref);
    if (existing !== undefined && existing.status === 'cancelled') {
      return harnessFailed(`task ${request.task_ref} is cancelled on this body`);
    }
    const session = existing ?? { taskRef: request.task_ref, status: 'active' as const, events: [], observations: [] };
    if (existing === undefined) {
      this.sessions.set(request.task_ref, session);
      this.emitEvent(session, 'task.adopted-by-replacement', { task_ref: request.task_ref });
    }
    session.status = 'active';
    return harnessOk({
      state: 'resumed',
      recovered: existing === undefined ? { adopted_by_replacement: true, open_pages: 0 } : { adopted_by_replacement: false, open_pages: this.options.browserPort.pages().length },
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
    this.emitEvent(guard.session, 'task.cancelled', {});
    return harnessOk({ state: 'cancelled' });
  }

  // -------------------------------------------------------------------------
  // §9 browser journeys (typed records through the injectable port)
  // -------------------------------------------------------------------------

  readonly browser = {
    open: (request: BrowserOpenRequest): HarnessResult<BrowserOpenResult> => {
      this.probe('browser.open');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      if (typeof request.url !== 'string' || request.url.length === 0) {
        return harnessFailed('browser.open requires a non-empty url');
      }
      // The body's own network policy bounds navigation (honest failure, never a silent detour).
      const host = hostOfUrl(request.url);
      if (host === null) {
        return harnessFailed(`browser.open requires an http(s) url, received: ${JSON.stringify(request.url)}`);
      }
      if (!this.options.allowedHosts.includes(host)) {
        this.emitEvent(session, 'browser.navigation-refused', { url: request.url, host, reason: 'host not admitted by the body network policy' });
        return harnessFailed(`host ${JSON.stringify(host)} is not admitted by the browser body network policy [${this.options.allowedHosts.join(', ')}] — navigation refused (bounded by declaration)`);
      }
      const opened = this.options.browserPort.open(request.url);
      if (opened.status === 'REFUSED') {
        return harnessFailed(`the browser port refused to open ${JSON.stringify(request.url)}: ${opened.reason}`);
      }
      this.emitEvent(session, 'browser.opened', { page_id: opened.page.page_id, url: opened.page.url, title: opened.page.title });
      return harnessOk({ page_id: opened.page.page_id, url: opened.page.url, title: opened.page.title });
    },
    interact: (request: BrowserInteractRequest): HarnessResult<BrowserInteractResult> => {
      this.probe('browser.interact');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      const session = guard.session;
      if (typeof request.page_id !== 'string' || request.page_id.length === 0) {
        return harnessFailed('browser.interact requires a non-empty page_id');
      }
      if (typeof request.target !== 'string' || request.target.length === 0) {
        return harnessFailed('browser.interact requires a non-empty target');
      }
      if (request.value !== null && typeof request.value !== 'string') {
        return harnessFailed('browser.interact value must be null or a string');
      }
      const outcome = this.options.browserPort.interact(request.page_id, request.action, request.target, request.value);
      if (outcome.status === 'NO_SUCH_PAGE') {
        return harnessFailed(`no open page under id ${JSON.stringify(request.page_id)}: ${outcome.reason}`);
      }
      if (outcome.status === 'REFUSED') {
        return harnessFailed(`the browser port refused the interaction: ${outcome.reason}`);
      }
      this.emitEvent(session, 'browser.interacted', { action: outcome.record.action, target: outcome.record.target });
      return harnessOk({ result: outcome.record.result });
    },
  };

  // -------------------------------------------------------------------------
  // §9 shell / git / workspace — NOT advertised (explicit UNSUPPORTED)
  // -------------------------------------------------------------------------

  readonly shell = {
    exec: (_request: ShellExecRequest): HarnessResult<ShellExecResult> => {
      this.probe('shell.exec');
      return harnessUnsupported('shell.exec', 'the browser/evaluator body advertises NO terminal capability — unsupported capabilities are explicit, never silent');
    },
  };

  readonly workspace = {
    read: (_request: WorkspaceReadRequest): HarnessResult<WorkspaceReadResult> => {
      this.probe('workspace.read');
      return harnessUnsupported('workspace.read', 'the browser/evaluator body advertises NO filesystem capability — unsupported capabilities are explicit, never silent');
    },
    write: (_request: WorkspaceWriteRequest): HarnessResult<WorkspaceWriteResult> => {
      this.probe('workspace.write');
      return harnessUnsupported('workspace.write', 'the browser/evaluator body advertises NO filesystem capability — unsupported capabilities are explicit, never silent');
    },
  };

  readonly git = {
    status: (_request: GitStatusRequest): HarnessResult<GitStatusResult> => {
      this.probe('git.status');
      return harnessUnsupported('git.status', 'the browser/evaluator body advertises NO repository-operations capability — unsupported capabilities are explicit, never silent');
    },
    diff: (_request: GitDiffRequest): HarnessResult<GitDiffResult> => {
      this.probe('git.diff');
      return harnessUnsupported('git.diff', 'the browser/evaluator body advertises NO repository-operations capability — unsupported capabilities are explicit, never silent');
    },
    commit: (_request: GitCommitRequest): HarnessResult<GitCommitResult> => {
      this.probe('git.commit');
      return harnessUnsupported('git.commit', 'the browser/evaluator body advertises NO repository-operations capability — unsupported capabilities are explicit, never silent');
    },
    push: (_request: GitPushRequest): HarnessResult<GitPushResult> => {
      this.probe('git.push');
      return harnessUnsupported('git.push', 'the browser/evaluator body advertises NO repository-operations capability — unsupported capabilities are explicit, never silent');
    },
    createBranch: (_request: GitCreateBranchRequest): HarnessResult<GitCreateBranchResult> => {
      this.probe('git.createBranch');
      return harnessUnsupported('git.createBranch', 'the browser/evaluator body advertises NO repository-operations capability — unsupported capabilities are explicit, never silent');
    },
    createPullRequest: (_request: GitCreatePullRequestRequest): HarnessResult<GitCreatePullRequestResult> => {
      this.probe('git.createPullRequest');
      return harnessUnsupported('git.createPullRequest', 'the browser/evaluator body advertises NO repository-operations capability — unsupported capabilities are explicit, never silent');
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
        description: `reference browser/evaluator body captured ${request.name}`,
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
