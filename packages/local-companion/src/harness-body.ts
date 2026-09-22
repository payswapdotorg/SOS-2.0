/**
 * THE LOCAL COMPANION BODY (Work Order P11) — the LOCAL BODY PATH over
 * the merged P5 Harness Contract.
 *
 * The companion registers with the P5 Body Broker behind the Execution
 * Fabric like ANY body (placement "user-device"): bounded tasks lease it,
 * dispatch §9 operations through the uniform gate pipeline, and release
 * it — task state and evidence are durable in the fabric's stores and
 * survive the body. Local observations emitted through the §9 surface are
 * provenance-labelled (source + device identity) and land in the
 * companion's durable local event log (reconciled into the P2 live-store
 * on reconnect).
 *
 * HONEST ADVERTISEMENT: the reference companion advertises exactly
 * terminal + filesystem (workspace read/write bounded by the granted
 * scope; shell exec through the injectable LocalProcess seam). Git,
 * browser and runtime/cloud operations answer typed UNSUPPORTED —
 * explicit, never silent. The filesystem scope of the advertisement
 * describes the granted-scope CLASS (mode workspace under the companion's
 * scope base); the FINE-GRAINED truth is the granted-scope check that
 * gates every access (unknown root, escape, read-only write, expired
 * grant — typed COMPANION_SCOPE_DENIED denials surfaced as truthful
 * FAILED results).
 *
 * THE SURFACE CARRIES NO AUTHORITY (the frozen P5 rule): requests and
 * results have no grant/permission fields; the authority plane lives in
 * the execution fabric, which re-evaluates grants before every
 * consequential dispatch.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env — the
 * companion core is injected; ids and event ids are deterministic
 * sequences; the body is clock-less (the fabric stamps instants).
 */

import { InvalidCompanionContractError } from './errors.js';
import { renderCompanionDenial } from './denials.js';
import type { CompanionDenial } from './denials.js';
import type { LocalCompanion } from './companion.js';
import type {
  ArtifactsCaptureRequest,
  ArtifactsCaptureResult,
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
import { assertValidHarnessCapabilities, assertValidHarnessIdentity } from '@sos-2/harness';
import type { BodyEvent } from '@sos-2/harness';
import type { JsonValue } from '@sos-2/semantic-spine';

/** Options for the local companion body. */
export interface LocalCompanionBodyOptions {
  /** The body id (a RUNTIME identifier — never a SOS semantic identity). */
  readonly bodyId: string;
  /** The companion core this body serves (session/scope/process/files injected there). */
  readonly companion: LocalCompanion;
  /** The scope base the advertisement's filesystem scope describes (default '/local/workspace'). */
  readonly scopeBase?: string;
  /** Vendor provenance (metadata ONLY — never identity, never a selection key). */
  readonly provider?: { readonly name: string; readonly version: string };
}

interface CompanionTaskSession {
  readonly taskRef: string;
  status: 'active' | 'paused' | 'cancelled';
  events: BodyEvent[];
  artifacts: number;
}

type SessionGuard = { ok: true; session: CompanionTaskSession } | { ok: false; failure: HarnessResult<never> };

/**
 * THE LOCAL COMPANION BODY — the §9 Harness Contract over the companion
 * core (placement user-device; the local body path of the P8 body
 * topology).
 */
export class LocalCompanionBody implements HarnessContract {
  readonly identityValue: HarnessIdentity;
  readonly capabilitiesValue: HarnessCapabilities;
  /** Run-flag probes: dispatched operation counts, by operation name (audit). */
  readonly dispatches = new Map<string, number>();

  private readonly companion: LocalCompanion;
  private readonly sessions = new Map<string, CompanionTaskSession>();

  constructor(options: LocalCompanionBodyOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new InvalidCompanionContractError('companion-body', 'local companion body options must be an object');
    }
    if (typeof options.bodyId !== 'string' || options.bodyId.length === 0 || options.bodyId.includes('sos://')) {
      throw new InvalidCompanionContractError(
        'companion-body',
        `bodyId must be a non-empty RUNTIME identifier (never a sos:// semantic identity), received: ${JSON.stringify(options.bodyId)}`,
      );
    }
    if (typeof options.companion !== 'object' || options.companion === null || typeof options.companion.pair !== 'function') {
      throw new InvalidCompanionContractError('companion-body', 'the local companion body requires the companion core (LocalCompanion)');
    }
    this.companion = options.companion;
    const provider = options.provider ?? { name: 'reference-local-companion', version: '1.0.0' };
    this.identityValue = {
      harness_id: `harness:companion-${options.bodyId}`,
      provider,
      placement: 'user-device',
    };
    assertValidHarnessIdentity(this.identityValue);
    const scopeBase = options.scopeBase ?? '/local/workspace';
    this.capabilitiesValue = {
      // §1/§3 honest advertisement: terminal + filesystem on the user's
      // own machine, bounded by the granted scope (never an isolation
      // boundary — isolationLevel 'none' is the honest declaration).
      capabilities: ['terminal', 'filesystem'],
      isolationLevel: 'none',
      networkPolicy: { egress: 'none' },
      filesystemScope: { mode: 'workspace', root: scopeBase },
      browser: [],
      shell: ['exec'],
      git: [],
      runtimeIntegrations: [],
      taskLifecycle: { create: true, resume: true, pause: true, cancel: true, checkpoints: true },
      evidenceCapture: { artifacts: true, observations: true, events: true },
      costEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: null, maxCostUsdPerTask: null },
    };
    assertValidHarnessCapabilities(this.capabilitiesValue);
  }

  // -------------------------------------------------------------------------
  // Audit/test probes (NOT part of the §9 contract)
  // -------------------------------------------------------------------------

  /** The bounded task session count (audit/test probe). */
  get sessionCount(): number {
    return this.sessions.size;
  }

  private probe(operation: string): void {
    this.dispatches.set(operation, (this.dispatches.get(operation) ?? 0) + 1);
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

  private emitEvent(session: CompanionTaskSession, kind: string, payload: JsonValue): void {
    session.events.push({
      event_id: `${session.taskRef}:ev-${String(session.events.length + 1).padStart(4, '0')}`,
      kind,
      payload,
    });
  }

  /** Render a companion denial as the truthful FAILED harness reason. */
  private deny<T>(denial: CompanionDenial, session?: CompanionTaskSession): HarnessResult<T> {
    if (session !== undefined) {
      this.emitEvent(session, 'companion.denied', { boundary: 'local', code: denial.code, subject: denial.subject });
    }
    return harnessFailed<T>(renderCompanionDenial(denial));
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
    // The companion session is the gate: an unpaired/expired/revoked
    // session refuses the task truthfully (never a fabricated start).
    const status = this.companion.session();
    if (status.status !== 'ACTIVE') {
      return harnessFailed(
        `the local companion has no ACTIVE paired session (status: ${status.status}) — pair through the pairing authority before summoning the local body`,
      );
    }
    const session: CompanionTaskSession = { taskRef: request.task_ref, status: 'active', events: [], artifacts: 0 };
    this.sessions.set(request.task_ref, session);
    this.emitEvent(session, 'task.created', { input: request.input, device_id: this.companion.deviceId });
    return harnessOk({ accepted: true, workspace_root: `${this.capabilitiesValue.filesystemScope.root}/${request.task_ref}` });
  }

  resumeTask(request: ResumeTaskRequest): HarnessResult<ResumeTaskResult> {
    this.probe('resumeTask');
    const existing = this.sessions.get(request.task_ref);
    if (existing !== undefined && existing.status === 'cancelled') {
      return harnessFailed(`task ${JSON.stringify(request.task_ref)} is cancelled on this body`);
    }
    // A REPLACEMENT body adopts the task with fresh body-side state: the
    // durable task record in the fabric is the truth; `recovered` reports
    // honestly what this body still holds.
    const session = existing ?? this.adoptSession(request.task_ref);
    session.status = 'active';
    return harnessOk({
      state: 'resumed',
      recovered:
        existing === undefined
          ? { adopted_by_replacement: true, events: 0, artifacts: 0 }
          : { adopted_by_replacement: false, events: session.events.length, artifacts: session.artifacts },
    });
  }

  private adoptSession(taskRef: string): CompanionTaskSession {
    const session: CompanionTaskSession = { taskRef, status: 'active', events: [], artifacts: 0 };
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
  // §9 workspace (bounded by the granted scope — typed denials)
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
      const read = this.companion.files.read({ path: request.path });
      if (read.status === 'DENIED') {
        return this.deny<WorkspaceReadResult>(read.denial, guard.session);
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
      const write = this.companion.files.write({ path: request.path, content: request.content });
      if (write.status === 'DENIED') {
        return this.deny<WorkspaceWriteResult>(write.denial, guard.session);
      }
      this.emitEvent(guard.session, 'workspace.wrote', { path: request.path, bytes: write.value.bytes });
      return harnessOk({ bytes: write.value.bytes });
    },
  };

  // -------------------------------------------------------------------------
  // §9 shell (the injectable LocalProcess seam, allowlist-gated)
  // -------------------------------------------------------------------------

  readonly shell = {
    exec: (request: ShellExecRequest): HarnessResult<ShellExecResult> => {
      this.probe('shell.exec');
      const guard = this.sessionGuard(request.task_ref);
      if (!guard.ok) {
        return guard.failure;
      }
      if (typeof request.command !== 'string' || request.command.length === 0) {
        return harnessFailed('shell.exec requires a non-empty command');
      }
      if (!Array.isArray(request.args) || !request.args.every((arg) => typeof arg === 'string')) {
        return harnessFailed('shell.exec requires args as a string array');
      }
      const exec = this.companion.process.exec({ command: request.command, args: request.args, cwd: request.cwd });
      if (exec.status === 'DENIED') {
        return this.deny<ShellExecResult>(exec.denial, guard.session);
      }
      this.emitEvent(guard.session, 'shell.executed', { command: request.command, exit_code: exec.value.exit_code });
      return harnessOk(exec.value);
    },
  };

  // -------------------------------------------------------------------------
  // §9 browser / git — EXPLICITLY UNSUPPORTED (honest advertisement)
  // -------------------------------------------------------------------------

  readonly browser = {
    open: (_request: BrowserOpenRequest): HarnessResult<BrowserOpenResult> =>
      harnessUnsupported('browser.open', 'the local companion advertises no browser-ui capability — browser interaction rides the optional browser bridge (§4 tier 4) or a browser-capable body; unsupported is explicit, never silent'),
    interact: (_request: BrowserInteractRequest): HarnessResult<BrowserInteractResult> =>
      harnessUnsupported('browser.interact', 'the local companion advertises no browser-ui capability — browser interaction rides the optional browser bridge (§4 tier 4) or a browser-capable body; unsupported is explicit, never silent'),
  };

  readonly git = {
    status: (_request: GitStatusRequest): HarnessResult<GitStatusResult> =>
      harnessUnsupported('git.status', 'the local companion advertises no repository-operations capability — repository operations run on repository-capable bodies (the P8 cloud/GitHub bodies); unsupported is explicit, never silent'),
    diff: (_request: GitDiffRequest): HarnessResult<GitDiffResult> =>
      harnessUnsupported('git.diff', 'the local companion advertises no repository-operations capability; unsupported is explicit, never silent'),
    commit: (_request: GitCommitRequest): HarnessResult<GitCommitResult> =>
      harnessUnsupported('git.commit', 'the local companion advertises no repository-operations capability; unsupported is explicit, never silent'),
    push: (_request: GitPushRequest): HarnessResult<GitPushResult> =>
      harnessUnsupported('git.push', 'the local companion advertises no repository-operations capability; unsupported is explicit, never silent'),
    createBranch: (_request: GitCreateBranchRequest): HarnessResult<GitCreateBranchResult> =>
      harnessUnsupported('git.createBranch', 'the local companion advertises no repository-operations capability; unsupported is explicit, never silent'),
    createPullRequest: (_request: GitCreatePullRequestRequest): HarnessResult<GitCreatePullRequestResult> =>
      harnessUnsupported('git.createPullRequest', 'the local companion advertises no repository-operations capability; unsupported is explicit, never silent'),
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
      guard.session.artifacts += 1;
      const artifactId = `artifact:${request.task_ref}:${String(guard.session.artifacts).padStart(4, '0')}`;
      this.emitEvent(guard.session, 'artifact.captured', { name: request.name, artifact_id: artifactId });
      return harnessOk({ artifact_id: artifactId, size_bytes: request.content.length, description: `local companion artifact ${JSON.stringify(request.name)}` });
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
      // PROVENANCE-LABELLED: the local observation names the local source
      // + device identity and lands in the durable local event log (the
      // P2 live-store ingests it through reconciliation — never a second
      // ingestion path).
      this.companion.emitObservation({
        source: 'local-companion:body',
        kind: request.observation_kind,
        payload: request.payload,
      });
      return harnessOk({ accepted: true });
    },
  };

  readonly events = {
    subscribe: (request: EventsSubscribeRequest): HarnessResult<EventsSubscribeResult> => {
      this.probe('events.subscribe');
      const session = this.sessions.get(request.task_ref);
      if (session === undefined) {
        return harnessFailed(`no task session ${JSON.stringify(request.task_ref)} on this body — createTask or resumeTask first`);
      }
      const cursorIndex = request.cursor === null ? 0 : Number(request.cursor);
      const start = Number.isInteger(cursorIndex) && cursorIndex >= 0 ? cursorIndex : 0;
      const events = session.events.slice(start, start + 100);
      const next = start + events.length;
      return harnessOk({ events, next_cursor: next < session.events.length ? String(next) : null });
    },
  };
}
