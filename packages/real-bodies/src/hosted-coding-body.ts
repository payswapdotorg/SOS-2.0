/**
 * THE HOSTED CODING-HARNESS BODY (Work Order P17-B) — a REAL cloud
 * execution body behind the frozen P5 §9 HarnessContract, executing a
 * durable task's work program by driving a REAL coding-capable model
 * API (the injected HostedModelPort — the real OpenRouter client in
 * production, a scripted port in deterministic tests).
 *
 * THE SYNC-CONTRACT / ASYNC-ENGINE COMPOSITION (the frozen P8
 * github-operations precedent, verbatim): the §9 HarnessContract is
 * synchronous by design while a real hosted model API is a network
 * call. Therefore:
 *
 *   - the §9 surface is the CONTROL/READ plane (task lifecycle, bounded
 *     workspace, the model-backed shell vocabulary, git records,
 *     artifacts, observations, the cursor event stream) — synchronous;
 *   - the body's execution ENGINE (`runWorkProgram`) is the documented
 *     async provider-side drive: the operator (the SOS task graph /
 *     Spirit loop) triggers it between §9 dispatches, exactly the way a
 *     real hosted coding harness is driven (create session -> trigger
 *     agent run -> poll/read results through the API);
 *   - every engine result flows back through the §9 surface: the applied
 *     files appear in workspace reads and git status; the model call
 *     (model id, provider response id, usage — REAL provider facts)
 *     lands in the cursor event stream; the outputs are captured as
 *     durable artifacts through the fabric.
 *
 * A BODY CANNOT SELF-CERTIFY (§10): the engine reports what it believes
 * it achieved as DATA (run records, events, artifacts); completion is
 * gated by the INDEPENDENT EVALUATOR at the fabric level — pinned by
 * test.
 *
 * THE USER'S COMPUTER IS NEVER REQUIRED: placement is 'cloud', the
 * body holds NO user-device handle of any kind, the sandbox egress
 * allowlist carries only the model provider — pinned by test and
 * asserted in evidence.
 *
 * Determinism: no hidden clocks, no ambient environment access, no
 * randomness; the deterministic suites inject the scripted model port
 * (offline, fixed seed). The body is CLOCK-LESS (the fabric stamps
 * instants); provider-reported facts (usage, response ids) are evidence,
 * not clocks.
 */

import { createLocalSandbox } from '@sos-2/sandbox';
import type { Sandbox, SandboxPolicy } from '@sos-2/sandbox';
import { renderSandboxDenial } from '@sos-2/sandbox';
import { ShellSimulator, builtinShellCommands } from '@sos-2/body-runtimes';
import type { ShellCommandContext } from '@sos-2/body-runtimes';
import { changedPaths, createGitSessionState, commitRefFor, pullRequestRefFor, renderWorkspaceDiff } from '@sos-2/body-runtimes';
import type { GitSessionState } from '@sos-2/body-runtimes';
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
import type { HostedModelPort, HostedModelUsage, WorkProgramOutput } from './model-port.js';
import { parseWorkProgramOutput } from './model-port.js';

/**
 * The default model the hosted body drives — a capable coding model on
 * OpenRouter that routes in the program's operational region (the
 * geo-restriction is a real provider fact; the model remains a
 * replaceable mechanism, never a semantic identity).
 */
export const HOSTED_CODING_BODY_DEFAULT_MODEL = 'qwen/qwen3-coder-flash';

/**
 * The work-program protocol preamble the body instructs the model with
 * (a fixed, versioned contract text — no hidden data, no secrets).
 */
export const HOSTED_CODING_BODY_INSTRUCTIONS = [
  'You are the execution engine of a hosted coding-harness body inside SOS 2.0.',
  'You receive ONE bounded work program (the goal) and the current workspace file list.',
  'Produce the requested deliverable as file edits.',
  'Respond with a SINGLE JSON object and NOTHING else, of the exact shape:',
  '{"files": [{"path": "<workspace-relative path>", "contents": "<full file contents>"}], "summary": "<one honest sentence>"}',
  'Rules: write complete file contents (no diffs, no placeholders); keep paths workspace-relative;',
  'never attempt path traversal; if the goal cannot be met, return an empty files array and an honest summary.',
  'Your output is parsed by a bounded protocol and is NEVER authoritative: an independent evaluator gates completion.',
].join('\n');

/** Options for the hosted coding-harness body. */
export interface HostedCodingBodyOptions {
  /** The body id (a RUNTIME identifier — never a SOS semantic identity). */
  readonly bodyId: string;
  /** The injected hosted-model port (the real client in production; scripted in deterministic tests). */
  readonly modelPort: HostedModelPort;
  /** The model id to request (default: HOSTED_CODING_BODY_DEFAULT_MODEL). */
  readonly model?: string;
  /** The bounded-environment policy (filesystem scope, egress, secrets NAMES, budgets). */
  readonly sandboxPolicy: SandboxPolicy;
  /** Vendor provenance (metadata ONLY — never identity, never a selection key). */
  readonly provider?: { readonly name: string; readonly version: string };
  /** Execution placement (default 'cloud': the task continues while the user's computer is off). */
  readonly placement?: HarnessPlacement;
  /** Credential values injected into every task closure (live only inside the closure; never echoed). */
  readonly secrets?: Readonly<Record<string, string>>;
  /** The cost envelope (defaults: derived from the sandbox resource envelope). */
  readonly costEnvelope?: { readonly maxDurationMs: number; readonly maxMemoryMb: number | null; readonly maxCostUsdPerTask: number | null };
  /** The model call token ceiling, or null for the provider default. */
  readonly maxOutputTokens?: number | null;
  /** The model sampling temperature, or null for the provider default. */
  readonly modelTemperature?: number | null;
}

/** One recorded model-driven engine run (provider facts + applied files). */
export interface HostedModelRunRecord {
  /** Deterministic run id (`<task_ref>:run-<n>`). */
  readonly run_id: string;
  readonly task_ref: string;
  /** The model the PROVIDER reports served the call (real evidence). */
  readonly model: string | null;
  /** The provider's response id (real evidence). */
  readonly response_id: string | null;
  /** Did the run apply its file edits? */
  readonly ok: boolean;
  readonly files_applied: readonly { readonly path: string; readonly bytes: number }[];
  readonly summary: string | null;
  readonly usage: HostedModelUsage | null;
  /** The honest failure reason (never fabricated success). */
  readonly error: string | null;
}

/** One bounded work program the body accepts. */
export interface WorkProgram {
  /** The goal sentence (required, non-empty). */
  readonly goal: string;
  /** The primary deliverable path (optional hint carried into the prompt). */
  readonly deliverable_path?: string;
}

interface HostedTaskSession {
  readonly taskRef: string;
  readonly sandbox: Sandbox;
  status: 'active' | 'paused' | 'cancelled';
  readonly git: GitSessionState;
  events: BodyEvent[];
  observations: { kind: string; payload: JsonValue }[];
  workProgram: WorkProgram | null;
  modelRuns: HostedModelRunRecord[];
}

/** Session guard: either the live session or a typed harness failure. */
type SessionGuard = { ok: true; session: HostedTaskSession } | { ok: false; failure: HarnessResult<never> };

/**
 * THE HOSTED CODING-HARNESS BODY — the real model-backed execution body.
 */
export class HostedCodingBody implements HarnessContract {
  readonly identityValue: HarnessIdentity;
  readonly capabilitiesValue: HarnessCapabilities;
  /** Run-flag probes: dispatched operation counts (audit) and engine runs. */
  readonly dispatches = new Map<string, number>();

  private readonly sessions = new Map<string, HostedTaskSession>();
  private readonly simulator: ShellSimulator;
  private readonly options: HostedCodingBodyOptions;

  constructor(options: HostedCodingBodyOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('HostedCodingBody requires an options object');
    }
    if (typeof options.bodyId !== 'string' || options.bodyId.length === 0 || options.bodyId.includes('sos://')) {
      throw new Error(`bodyId must be a non-empty RUNTIME identifier (never a sos:// semantic identity), received: ${JSON.stringify(options.bodyId)}`);
    }
    if (typeof options.modelPort !== 'object' || options.modelPort === null || typeof options.modelPort.complete !== 'function') {
      throw new Error('HostedCodingBody requires an injected HostedModelPort (the model API seam)');
    }
    assertValidSandboxPolicy(options.sandboxPolicy);
    if (options.sandboxPolicy.filesystem.mode === 'none') {
      throw new Error('the hosted coding-harness body requires a workspace filesystem scope — a coding body without a workspace is a typed contradiction');
    }
    this.options = options;
    this.simulator = new ShellSimulator(builtinShellCommands());
    const provider = options.provider ?? { name: 'openrouter-hosted-coding', version: '1.0.0' };
    this.identityValue = {
      harness_id: `harness:${options.bodyId}`,
      provider,
      placement: options.placement ?? 'cloud',
    };
    assertValidHarnessIdentity(this.identityValue);
    const policy = options.sandboxPolicy;
    this.capabilitiesValue = {
      capabilities: ['terminal', 'filesystem', 'repository-operations', 'runtime-cloud-apis'],
      isolationLevel: 'process',
      networkPolicy: policy.network,
      filesystemScope: { mode: policy.filesystem.mode, root: policy.filesystem.root },
      browser: [],
      shell: ['exec'],
      git: ['status', 'diff', 'commit', 'push', 'createBranch', 'createPullRequest'],
      runtimeIntegrations: [
        {
          capability: 'hosted-model',
          operations: ['chat.completion'],
          integrations: [
            {
              integration_id: `integration:${options.bodyId}:hosted-model`,
              tier: 'native-api',
              capability: 'hosted-model',
              endpoint: 'https://openrouter.ai/api/v1/chat/completions',
              operations: ['chat.completion'],
              available: true,
            },
          ],
          boundedEnvironment: null,
        },
      ],
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

  /** The recorded engine runs of one task (audit/test probe; provider facts). */
  modelRunsOf(taskRef: string): readonly HostedModelRunRecord[] {
    const session = this.sessions.get(taskRef);
    if (session === undefined) {
      return [];
    }
    return session.modelRuns.map((run) => ({ ...run, files_applied: [...run.files_applied] }));
  }

  /** The work program of one task (audit/test probe). */
  workProgramOf(taskRef: string): WorkProgram | null {
    return this.sessions.get(taskRef)?.workProgram ?? null;
  }

  // -------------------------------------------------------------------------
  // THE EXECUTION ENGINE (provider-side async drive — NOT part of §9;
  // results flow back through the §9 surface: events, files, artifacts)
  // -------------------------------------------------------------------------

  /**
   * Drive the task's work program through the REAL hosted model API
   * (the injected HostedModelPort): one bounded model call whose parsed
   * file edits are applied inside the task's bounded sandbox. Returns
   * the honest run record (ok === false carries the truthful failure —
   * never a fabricated success). Every run emits events visible through
   * the §9 event stream (model.call / model.response / work.applied /
   * work.completed / work.failed / sandbox.denied).
   */
  async runWorkProgram(taskRef: string, override?: { goal?: string; deliverable_path?: string }): Promise<HostedModelRunRecord> {
    const session = this.sessions.get(taskRef);
    if (session === undefined) {
      return this.failedRun(taskRef, null, null, null, `no task session ${JSON.stringify(taskRef)} on this body — createTask or resumeTask first`);
    }
    if (session.status === 'cancelled') {
      return this.failedRun(taskRef, null, null, null, `task ${JSON.stringify(taskRef)} is cancelled on this body`);
    }
    const goal = override?.goal ?? session.workProgram?.goal;
    if (goal === undefined || goal.length === 0) {
      return this.failedRun(taskRef, null, null, null, 'no work program to run — createTask must carry one (or pass an explicit goal)');
    }
    const workspaceListing = this.workspaceSnapshot(session);
    const deliverable = override?.deliverable_path ?? session.workProgram?.deliverable_path;
    const prompt = [
      `WORK PROGRAM (goal): ${goal}`,
      deliverable === undefined ? '' : `PRIMARY DELIVERABLE: ${deliverable}`,
      `CURRENT WORKSPACE FILES: ${[...workspaceListing.keys()].sort().join(', ') || '(empty)'}`,
    ]
      .filter((line) => line.length > 0)
      .join('\n');

    // The network budget bounds the model call (an injected limit — the
    // body cannot exceed its bounded environment).
    const consumed = session.sandbox.budget.consume('networkCalls', 1);
    if (consumed.status === 'DENIED') {
      this.emitEvent(session, 'sandbox.denied', { boundary: 'budget', code: consumed.denial.code, subject: consumed.denial.subject });
      return this.failedRun(taskRef, null, null, null, renderSandboxDenial(consumed.denial));
    }

    this.emitEvent(session, 'model.call', { model: this.options.model ?? HOSTED_CODING_BODY_DEFAULT_MODEL, goal });
    const call = await this.options.modelPort.complete({
      model: this.options.model ?? HOSTED_CODING_BODY_DEFAULT_MODEL,
      instructions: HOSTED_CODING_BODY_INSTRUCTIONS,
      prompt,
      max_tokens: this.options.maxOutputTokens ?? null,
      temperature: this.options.modelTemperature ?? null,
    });
    if (!call.ok) {
      this.emitEvent(session, 'model.failed', { kind: call.error.kind, status: call.error.status, message: call.error.message });
      return this.failedRun(taskRef, null, null, null, `the model provider call failed (${call.error.kind}, HTTP ${call.error.status}): ${call.error.message}`);
    }
    const response = call.response;
    this.emitEvent(session, 'model.response', {
      model: response.model,
      response_id: response.id,
      finish_reason: response.finish_reason,
      usage: response.usage === null ? null : { ...response.usage },
    });
    const parsed: WorkProgramOutput | null = parseWorkProgramOutput(response.content);
    if (parsed === null) {
      this.emitEvent(session, 'work.failed', { reason: 'the model output did not parse as the work-program protocol (files+summary JSON)' });
      return this.failedRun(taskRef, response.model, response.id, response.usage, 'the model output did not parse as the work-program protocol — the honest answer is this failed run, never a fabricated success');
    }
    const applied: { path: string; bytes: number }[] = [];
    for (const file of parsed.files) {
      const write = session.sandbox.filesystem.write(file.path, file.contents);
      if (write.status === 'DENIED') {
        this.emitEvent(session, 'sandbox.denied', { boundary: 'filesystem', code: write.denial.code, subject: write.denial.subject });
        return this.failedRun(taskRef, response.model, response.id, response.usage, `the model-proposed file ${JSON.stringify(file.path)} was denied by the bounded environment: ${renderSandboxDenial(write.denial)}`);
      }
      applied.push({ path: file.path, bytes: write.value.bytes });
    }
    const run: HostedModelRunRecord = {
      run_id: `${taskRef}:run-${String(session.modelRuns.length + 1).padStart(4, '0')}`,
      task_ref: taskRef,
      model: response.model,
      response_id: response.id,
      ok: true,
      files_applied: applied,
      summary: parsed.summary,
      usage: response.usage,
      error: null,
    };
    session.modelRuns.push(run);
    this.emitEvent(session, 'work.applied', { files: applied.map((file) => file.path) });
    this.emitEvent(session, 'work.completed', { run_id: run.run_id, summary: parsed.summary, files: applied.length });
    return run;
  }

  private failedRun(
    taskRef: string,
    model: string | null,
    responseId: string | null,
    usage: HostedModelUsage | null,
    reason: string,
  ): HostedModelRunRecord {
    const session = this.sessions.get(taskRef);
    const run: HostedModelRunRecord = {
      run_id: `${taskRef}:run-${String((session?.modelRuns.length ?? 0) + 1).padStart(4, '0')}`,
      task_ref: taskRef,
      model,
      response_id: responseId,
      ok: false,
      files_applied: [],
      summary: null,
      usage,
      error: reason,
    };
    session?.modelRuns.push(run);
    return run;
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
    const session: HostedTaskSession = {
      taskRef: request.task_ref,
      sandbox,
      status: 'active',
      git: createGitSessionState('main'),
      events: [],
      observations: [],
      workProgram: parseWorkProgramInput(request.input),
      modelRuns: [],
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
    // fresh bounded environment — body-side state did not survive the
    // replacement; the durable task record is the truth and `recovered`
    // reports honestly what this body still holds.
    const session = existing ?? this.createSessionForAdoption(request.task_ref, request.input);
    session.status = 'active';
    return harnessOk({
      state: 'resumed',
      recovered:
        existing === undefined
          ? { adopted_by_replacement: true, files: 0, commits: 0 }
          : { adopted_by_replacement: false, files: this.workspaceSnapshot(session).size, commits: session.git.commits.length },
    });
  }

  private createSessionForAdoption(taskRef: string, input: JsonValue | null): HostedTaskSession {
    const sandbox = createLocalSandbox({ policy: this.options.sandboxPolicy, secrets: this.options.secrets });
    const session: HostedTaskSession = {
      taskRef,
      sandbox,
      status: 'active',
      git: createGitSessionState('main'),
      events: [],
      observations: [],
      workProgram: parseWorkProgramInput(input),
      modelRuns: [],
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
  // §9 shell — the model-backed harness vocabulary over the reference
  // simulator built-ins (echo/cat/ls/pwd/test/exit) plus 'status' (the
  // honest engine status probe).
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
      const consumed = session.sandbox.budget.consume('shellCommands', 1);
      if (consumed.status === 'DENIED') {
        this.emitEvent(session, 'sandbox.denied', { boundary: 'budget', code: consumed.denial.code, subject: consumed.denial.subject });
        return harnessFailed(renderSandboxDenial(consumed.denial));
      }
      if (request.command === 'status') {
        // The honest engine status of this body's session (read-only —
        // the engine itself is the provider-side async drive).
        const runs = session.modelRuns;
        const status = {
          placement: this.identityValue.placement,
          model: this.options.model ?? HOSTED_CODING_BODY_DEFAULT_MODEL,
          work_program: session.workProgram === null ? null : { goal: session.workProgram.goal },
          runs: runs.length,
          last_run:
            runs.length === 0
              ? null
              : {
                  run_id: runs[runs.length - 1]!.run_id,
                  ok: runs[runs.length - 1]!.ok,
                  model: runs[runs.length - 1]!.model,
                  summary: runs[runs.length - 1]!.summary,
                },
        };
        this.emitEvent(session, 'shell.executed', { command: request.command, exit_code: 0, cwd: request.cwd });
        return harnessOk({ exit_code: 0, stdout: JSON.stringify(status), stderr: '' });
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
      return harnessUnsupported('browser.open', 'the hosted coding-harness body advertises NO browser capability — unsupported capabilities are explicit, never silent');
    },
    interact: (_request: BrowserInteractRequest): HarnessResult<BrowserInteractResult> => {
      this.probe('browser.interact');
      return harnessUnsupported('browser.interact', 'the hosted coding-harness body advertises NO browser capability — unsupported capabilities are explicit, never silent');
    },
  };

  // -------------------------------------------------------------------------
  // §9 git (typed records — provider repository operations live on the
  // project adapter behind the GitHubPort; this is the body-side record
  // surface, exactly like the reference cloud body)
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
        description: `hosted coding-harness body captured ${request.name}`,
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

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

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

  private emitEvent(session: HostedTaskSession, kind: string, payload: JsonValue): void {
    session.events.push({
      event_id: `${session.taskRef}:ev-${String(session.events.length + 1).padStart(4, '0')}`,
      kind,
      payload,
    });
  }

  private workspaceSnapshot(session: HostedTaskSession): Map<string, string> {
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

  private shellContext(session: HostedTaskSession): ShellCommandContext {
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
}

/** Parse the createTask input into a bounded work program (or null — honest absence). */
export function parseWorkProgramInput(input: JsonValue | null): WorkProgram | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const goal = record['goal'];
  if (typeof goal !== 'string' || goal.length === 0) {
    return null;
  }
  const deliverable = record['deliverable_path'];
  const program: WorkProgram =
    typeof deliverable === 'string' && deliverable.length > 0 ? { goal, deliverable_path: deliverable } : { goal };
  return program;
}

/** Construct the hosted coding-harness body (the ergonomic factory). */
export function createHostedCodingBody(options: HostedCodingBodyOptions): HostedCodingBody {
  return new HostedCodingBody(options);
}
