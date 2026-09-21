/**
 * §9 operation request/response payload types (Work Order P5).
 *
 * One request type per §9 operation. THE SURFACE CARRIES NO AUTHORITY
 * FIELDS: a body is a replaceable execution mechanism and can never mint,
 * carry or widen authority (spec/productization-requirements.md: "Bodies
 * cannot mint or widen authority"). The task reference names WHICH bounded
 * task the operation belongs to; the authority plane lives entirely in
 * the execution fabric, which re-evaluates grants before dispatch.
 *
 * Bodies are CLOCK-LESS by discipline: no request or response carries a
 * timestamp — instants are stamped by the injected clock at the fabric
 * boundary (determinism; the same rule as the live-store).
 */

import type { JsonValue } from '@sos-2/semantic-spine';
import type { BrowserAction } from './operations.js';

// ---------------------------------------------------------------------------
// Task lifecycle (§9 createTask / resumeTask / pauseTask / cancelTask)
// ---------------------------------------------------------------------------

/** createTask: summon the body for a bounded task. */
export interface CreateTaskRequest {
  /** The execution-fabric task id this body session belongs to. */
  readonly task_ref: string;
  /** Opaque task input (the bounded task description/plan fragment). */
  readonly input: JsonValue | null;
}

/** createTask result payload. */
export interface CreateTaskResult {
  readonly accepted: true;
  /** The body-side workspace root, when one exists. */
  readonly workspace_root: string | null;
}

/** resumeTask: reattach to a paused/known task on this body. */
export interface ResumeTaskRequest {
  readonly task_ref: string;
  /** Opaque resume hint (e.g. a checkpoint fragment), or null. */
  readonly input: JsonValue | null;
}

/** resumeTask result payload. */
export interface ResumeTaskResult {
  readonly state: 'resumed';
  /** How much body-side state survived (opaque, honest). */
  readonly recovered: JsonValue | null;
}

/** pauseTask: pause the body-side session (durable task state is the fabric's concern). */
export interface PauseTaskRequest {
  readonly task_ref: string;
}

/** pauseTask result payload. */
export interface PauseTaskResult {
  readonly state: 'paused';
}

/** cancelTask: cancel the body-side session. */
export interface CancelTaskRequest {
  readonly task_ref: string;
}

/** cancelTask result payload. */
export interface CancelTaskResult {
  readonly state: 'cancelled';
}

// ---------------------------------------------------------------------------
// Workspace (§9 workspace.read / workspace.write)
// ---------------------------------------------------------------------------

export interface WorkspaceReadRequest {
  readonly task_ref: string;
  /** Workspace-relative path (non-empty). */
  readonly path: string;
}

export interface WorkspaceReadResult {
  readonly content: string;
}

export interface WorkspaceWriteRequest {
  readonly task_ref: string;
  readonly path: string;
  readonly content: string;
}

export interface WorkspaceWriteResult {
  readonly bytes: number;
}

// ---------------------------------------------------------------------------
// Shell (§9 shell.exec)
// ---------------------------------------------------------------------------

export interface ShellExecRequest {
  readonly task_ref: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Working directory (workspace-relative), or null for the workspace root. */
  readonly cwd: string | null;
}

export interface ShellExecResult {
  readonly exit_code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// ---------------------------------------------------------------------------
// Browser (§9 browser.open / browser.interact)
// ---------------------------------------------------------------------------

export interface BrowserOpenRequest {
  readonly task_ref: string;
  readonly url: string;
}

export interface BrowserOpenResult {
  readonly page_id: string;
  readonly url: string;
  readonly title: string | null;
}

export interface BrowserInteractRequest {
  readonly task_ref: string;
  readonly page_id: string;
  readonly action: BrowserAction;
  /** Interaction target (selector/label — provider-neutral). */
  readonly target: string;
  /** Value for 'type' actions, or null. */
  readonly value: string | null;
}

export interface BrowserInteractResult {
  /** The action outcome — 'read' returns the read content. */
  readonly result: JsonValue | null;
}

// ---------------------------------------------------------------------------
// Git (§9 git.status / diff / commit / push / createBranch / createPullRequest)
// ---------------------------------------------------------------------------

export interface GitStatusRequest {
  readonly task_ref: string;
}

export interface GitStatusResult {
  readonly branch: string | null;
  readonly clean: boolean;
  /** Changed paths (deterministic order). */
  readonly changed: readonly string[];
}

export interface GitDiffRequest {
  readonly task_ref: string;
  /** Diff base ref, or null for the working tree. */
  readonly ref: string | null;
}

export interface GitDiffResult {
  readonly diff: string;
}

export interface GitCommitRequest {
  readonly task_ref: string;
  readonly message: string;
  /** Paths to stage; empty array stages every change. */
  readonly paths: readonly string[];
}

export interface GitCommitResult {
  readonly commit_ref: string;
  readonly files: number;
}

export interface GitPushRequest {
  readonly task_ref: string;
  readonly remote: string;
  readonly ref: string;
}

export interface GitPushResult {
  readonly pushed_ref: string;
}

export interface GitCreateBranchRequest {
  readonly task_ref: string;
  readonly name: string;
  /** Base ref, or null for the current HEAD. */
  readonly from_ref: string | null;
}

export interface GitCreateBranchResult {
  readonly branch: string;
}

export interface GitCreatePullRequestRequest {
  readonly task_ref: string;
  readonly title: string;
  readonly source_branch: string;
  readonly target_branch: string;
}

export interface GitCreatePullRequestResult {
  readonly pull_request_ref: string;
  readonly url: string | null;
}

// ---------------------------------------------------------------------------
// Artifacts / observations / events (§9 artifacts.capture / observations.emit / events.subscribe)
// ---------------------------------------------------------------------------

export interface ArtifactsCaptureRequest {
  readonly task_ref: string;
  /** Artifact name (stable within the task). */
  readonly name: string;
  /** The captured content — the fabric content-addresses and persists it. */
  readonly content: string;
}

export interface ArtifactsCaptureResult {
  readonly artifact_id: string;
  readonly size_bytes: number;
  readonly description: string | null;
}

/**
 * observations.emit: the body reports a pre-semantic observation. The
 * fabric stamps instants and ingests through the typed observation
 * boundary; a body observation is NEVER authoritative evidence.
 */
export interface ObservationsEmitRequest {
  readonly task_ref: string;
  /** Observation kind (e.g. "body.progress", "body.warning"). */
  readonly observation_kind: string;
  /** Opaque canonical-JSON observation payload. */
  readonly payload: JsonValue;
}

export interface ObservationsEmitResult {
  readonly accepted: true;
}

/** One body-emitted event (§9 events.subscribe). */
export interface BodyEvent {
  readonly event_id: string;
  readonly kind: string;
  readonly payload: JsonValue;
}

export interface EventsSubscribeRequest {
  readonly task_ref: string;
  /** Opaque event filter, or null for all events of the task. */
  readonly filter: JsonValue | null;
  /** Cursor from a previous subscription poll, or null to start at the oldest. */
  readonly cursor: string | null;
}

export interface EventsSubscribeResult {
  readonly events: readonly BodyEvent[];
  /** Cursor for the next poll, or null when the stream is drained. */
  readonly next_cursor: string | null;
}
