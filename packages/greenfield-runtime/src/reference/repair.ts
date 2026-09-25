/**
 * THE REFERENCE NODE REPAIR EXECUTOR (Work Order P13) — the deterministic
 * stand-in behind the NodeRepairExecutor seam: repair = commit the
 * CORRECT planned files of the node as a NEW revision through the P9
 * gateway (project realization), advancing the shared workspace head.
 *
 * A repair that cannot produce a corrected revision returns null (the
 * journey escalates to a typed ASK — never a silent skip).
 */

import { parseTaskWorkProgram } from '@sos-2/implementation-orchestrator';
import type { TaskNode } from '@sos-2/task-graph';
import type { NodeRepairExecutor, NodeRepairResult } from '../journey.js';
import type { RealizedCommit, RepositoryRealizer } from '@sos-2/project-realization';

export interface ReferenceNodeRepairExecutorOptions {
  /** The realizer (P9 gateway only — repair is a consequential action). */
  readonly realizer: RepositoryRealizer;
  /** The shared workspace-head setter (the head advances with each repair commit). */
  readonly onRevisionProduced: (sha: string) => void;
  /** The commit-message prefix (default 'repair'). */
  readonly messagePrefix?: string;
}

export class ReferenceNodeRepairExecutor implements NodeRepairExecutor {
  private readonly realizer: RepositoryRealizer;
  private readonly onRevisionProduced: (sha: string) => void;
  private readonly messagePrefix: string;

  constructor(options: ReferenceNodeRepairExecutorOptions) {
    if (typeof options !== 'object' || options === null || typeof options.realizer !== 'object' || options.realizer === null) {
      throw new TypeError('ReferenceNodeRepairExecutor requires the repository realizer injected (P9 gateway only)');
    }
    if (typeof options.onRevisionProduced !== 'function') {
      throw new TypeError('ReferenceNodeRepairExecutor requires the workspace-head setter');
    }
    this.realizer = options.realizer;
    this.onRevisionProduced = options.onRevisionProduced;
    this.messagePrefix = options.messagePrefix ?? 'repair';
  }

  async repair(input: {
    readonly node: TaskNode;
    readonly failures: readonly { readonly check: string; readonly message: string; readonly expected: string | null; readonly actual: string | null }[];
    readonly currentRevision: string;
    readonly attempt: number;
  }): Promise<NodeRepairResult> {
    let program;
    try {
      program = parseTaskWorkProgram(input.node.steps);
    } catch (cause) {
      return { newSourceRevision: null, detail: `the work program is malformed and cannot be re-derived: ${(cause as Error).message}`, realizedCommit: null };
    }
    const outcome = await this.realizer.commitTaskOutput({
      taskId: input.node.task_id,
      message: `${this.messagePrefix}: ${input.node.title} (attempt ${input.attempt}; ${input.failures.length} failure(s))`,
      changes: program.files.map((file) => ({ path: file.path, contents: file.contents })),
    });
    if (outcome.kind === 'DENIED') {
      return { newSourceRevision: null, detail: `the repair commit was DENIED at action time (${outcome.grantReason}): ${outcome.detail}`, realizedCommit: null };
    }
    if (outcome.kind === 'FAILED') {
      return { newSourceRevision: null, detail: `the repair commit failed: ${outcome.failure.errorType} — ${outcome.failure.message}`, realizedCommit: null };
    }
    this.onRevisionProduced(outcome.result.sha);
    return {
      newSourceRevision: outcome.result.sha,
      detail: 're-committed the planned (correct) files as a new revision through the action gateway',
      realizedCommit: outcome.result,
    };
  }
}
