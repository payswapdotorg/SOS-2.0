/**
 * THE HARNESS CONTRACT (Work Order P5) — the execution contract of
 * spec/productization-execution-architecture.md §9, as typed interfaces.
 *
 * The surface mirrors §9 exactly, namespaced:
 *
 *   identity()  capabilities()  createTask()  resumeTask()  pauseTask()
 *   cancelTask()  workspace.read()  workspace.write()  shell.exec()
 *   browser.open()  browser.interact()  git.status()  git.diff()
 *   git.commit()  git.push()  git.createBranch()  git.createPullRequest()
 *   artifacts.capture()  observations.emit()  events.subscribe()
 *
 * Every operation answers a typed HarnessResult (OK | FAILED |
 * UNSUPPORTED). UNSUPPORTED is EXPLICIT and derives from the BINDING
 * capability advertisement (see capabilities.ts): an implementation MUST
 * answer harnessUnsupported for operations its advertisement does not
 * carry — never a silent success, never a surprise capability.
 *
 * THE CONTRACT CARRIES NO AUTHORITY: request and response types have no
 * grant, permission or authorization fields — a body can neither mint,
 * carry nor widen authority. The authority plane (grant re-evaluation
 * before every consequential operation) lives in the execution fabric.
 *
 * A reference fake body implementing this contract lives in
 * tests/harness-contracts (the acceptance suite drives a complete bounded
 * task through this public surface).
 */

import type { HarnessCapabilities } from './capabilities.js';
import type { HarnessIdentity } from './identity.js';
import type { HarnessResult } from './results.js';
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
} from './requests.js';

/** §9 workspace.* surface. */
export interface HarnessWorkspaceSurface {
  read(request: WorkspaceReadRequest): HarnessResult<WorkspaceReadResult>;
  write(request: WorkspaceWriteRequest): HarnessResult<WorkspaceWriteResult>;
}

/** §9 shell.* surface. */
export interface HarnessShellSurface {
  exec(request: ShellExecRequest): HarnessResult<ShellExecResult>;
}

/** §9 browser.* surface. */
export interface HarnessBrowserSurface {
  open(request: BrowserOpenRequest): HarnessResult<BrowserOpenResult>;
  interact(request: BrowserInteractRequest): HarnessResult<BrowserInteractResult>;
}

/** §9 git.* surface. */
export interface HarnessGitSurface {
  status(request: GitStatusRequest): HarnessResult<GitStatusResult>;
  diff(request: GitDiffRequest): HarnessResult<GitDiffResult>;
  commit(request: GitCommitRequest): HarnessResult<GitCommitResult>;
  push(request: GitPushRequest): HarnessResult<GitPushResult>;
  createBranch(request: GitCreateBranchRequest): HarnessResult<GitCreateBranchResult>;
  createPullRequest(request: GitCreatePullRequestRequest): HarnessResult<GitCreatePullRequestResult>;
}

/** §9 artifacts.* surface. */
export interface HarnessArtifactsSurface {
  capture(request: ArtifactsCaptureRequest): HarnessResult<ArtifactsCaptureResult>;
}

/** §9 observations.* surface. */
export interface HarnessObservationsSurface {
  emit(request: ObservationsEmitRequest): HarnessResult<ObservationsEmitResult>;
}

/** §9 events.* surface. */
export interface HarnessEventsSurface {
  subscribe(request: EventsSubscribeRequest): HarnessResult<EventsSubscribeResult>;
}

/** THE HARNESS CONTRACT — the §9 execution surface, provider-neutral. */
export interface HarnessContract {
  /** The provider-neutral harness identity (never a SOS semantic identity). */
  identity(): HarnessIdentity;

  /** The binding §3 capability advertisement. */
  capabilities(): HarnessCapabilities;

  // §9 task lifecycle.
  createTask(request: CreateTaskRequest): HarnessResult<CreateTaskResult>;
  resumeTask(request: ResumeTaskRequest): HarnessResult<ResumeTaskResult>;
  pauseTask(request: PauseTaskRequest): HarnessResult<PauseTaskResult>;
  cancelTask(request: CancelTaskRequest): HarnessResult<CancelTaskResult>;

  // §9 namespaced operation surfaces.
  readonly workspace: HarnessWorkspaceSurface;
  readonly shell: HarnessShellSurface;
  readonly browser: HarnessBrowserSurface;
  readonly git: HarnessGitSurface;
  readonly artifacts: HarnessArtifactsSurface;
  readonly observations: HarnessObservationsSurface;
  readonly events: HarnessEventsSurface;
}
