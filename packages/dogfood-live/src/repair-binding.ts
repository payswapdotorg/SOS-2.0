/**
 * THE DOGFOOD NODE-REPAIR BINDING (Work Order P19) — the journey's
 * NodeRepairExecutor seam bound to the REAL repair discipline: when the
 * independent evaluation fails the body's revision, the repair
 *
 *   1. re-derives the node's PLANNED (correct) files from its typed
 *      work program (the merged ReferenceNodeRepairExecutor semantics,
 *      identical message format);
 *   2. drives the REAL repair commit through the GitHub provider at
 *      the async composition boundary and STAGES the outcome;
 *   3. stages the repository facts at the NEW revision (the full fresh
 *      suite that follows evaluates the EXACT new revision — verdicts
 *      never carry across revisions);
 *   4. realizes the repair commit through the P9 gateway
 *      (RepositoryRealizer.commitTaskOutput — authority re-evaluated at
 *      action time, evidence ids minted, the workspace head advanced to
 *      the exact real sha).
 *
 * A repair that cannot produce a corrected revision returns the honest
 * null (the journey escalates to a typed ASK — never a silent skip).
 */

import type { NodeRepairExecutor } from '@sos-2/greenfield-runtime';
import type { RealizedCommit } from '@sos-2/project-realization';
import { parseTaskWorkProgram } from '@sos-2/implementation-orchestrator';
import type { RepositoryRealizer } from '@sos-2/project-realization';
import type { RealGitHubProvider } from '@sos-2/real-github';
import type { DogfoodStaging } from './staging.js';

export interface DogfoodNodeRepairOptions {
  /** The REAL GitHub provider (the async repair commit is driven here). */
  readonly provider: RealGitHubProvider;
  /** The staging store (the composition-boundary outcomes). */
  readonly staging: DogfoodStaging;
  /** The repository the run realizes into. */
  readonly repository: { readonly owner: string; readonly name: string };
  /** The implementation branch the repair commits onto. */
  readonly branch: string;
  /** The P9-only realizer (the repair is a consequential action — gateway only). */
  readonly realizer: RepositoryRealizer;
  /** The repo-facts stager (the fresh suite evaluates the exact new revision). */
  readonly stageRepoFacts: (revision: string, plannedPaths: readonly string[], componentId: string | null) => Promise<void>;
}

export class DogfoodNodeRepairExecutor implements NodeRepairExecutor {
  private readonly provider: RealGitHubProvider;
  private readonly staging: DogfoodStaging;
  private readonly repository: { readonly owner: string; readonly name: string };
  private readonly branch: string;
  private readonly realizer: RepositoryRealizer;
  private readonly stageRepoFacts: (revision: string, plannedPaths: readonly string[], componentId: string | null) => Promise<void>;

  constructor(options: DogfoodNodeRepairOptions) {
    if (typeof options !== 'object' || options === null || typeof options.provider !== 'object' || options.provider === null) {
      throw new Error('DogfoodNodeRepairExecutor requires the REAL GitHub provider injected');
    }
    if (typeof options.staging !== 'object' || options.staging === null) {
      throw new Error('DogfoodNodeRepairExecutor requires the staging store injected');
    }
    if (typeof options.realizer !== 'object' || options.realizer === null) {
      throw new Error('DogfoodNodeRepairExecutor requires the repository realizer injected (P9 gateway only)');
    }
    if (typeof options.stageRepoFacts !== 'function') {
      throw new Error('DogfoodNodeRepairExecutor requires the repo-facts stager injected');
    }
    this.provider = options.provider;
    this.staging = options.staging;
    this.repository = options.repository;
    this.branch = options.branch;
    this.realizer = options.realizer;
    this.stageRepoFacts = options.stageRepoFacts;
  }

  async repair(input: {
    readonly node: Parameters<NodeRepairExecutor['repair']>[0]['node'];
    readonly failures: readonly { readonly check: string; readonly message: string; readonly expected: string | null; readonly actual: string | null }[];
    readonly currentRevision: string;
    readonly attempt: number;
  }): Promise<{ readonly newSourceRevision: string | null; readonly detail: string; readonly realizedCommit: RealizedCommit | null }> {
    let program: ReturnType<typeof parseTaskWorkProgram>;
    try {
      program = parseTaskWorkProgram(input.node.steps);
    } catch (cause) {
      return { newSourceRevision: null, detail: `the work program is malformed and cannot be re-derived: ${(cause as Error).message}`, realizedCommit: null };
    }
    const changes = program.files.map((file) => ({ path: file.path, contents: file.contents }));
    const message = `repair: ${input.node.title} (attempt ${input.attempt}; ${input.failures.length} failure(s))`;

    // 1. Drive the REAL repair commit at the async composition boundary.
    const committed = await this.provider.commitFiles({
      repository: this.repository,
      branch: this.branch,
      message,
      files: changes,
    });
    if (committed.status !== 'OK') {
      return {
        newSourceRevision: null,
        detail: `the REAL repair commit failed: ${committed.reason}`,
        realizedCommit: null,
      };
    }

    // 2. Stage the outcome so the sync gateway seam answers EXACTLY it.
    this.staging.stageCommit({ message, baseSha: input.currentRevision, changes }, {
      newSha: committed.result.sha,
      committedAt: committed.result.committed_at,
      providerNote: 'the real repair commit (planned files re-committed through the real GitHub provider)',
    });

    // 3. Stage the repository facts at the NEW revision (the full fresh suite follows).
    await this.stageRepoFacts(committed.result.sha, program.files.map((file) => file.path), program.componentId);

    // 4. Realize through the P9 gateway (authority re-evaluated at action time).
    const outcome = await this.realizer.commitTaskOutput({ taskId: input.node.task_id, message, changes });
    if (outcome.kind === 'DENIED') {
      return { newSourceRevision: null, detail: `the repair commit was DENIED at action time (${outcome.grantReason}): ${outcome.detail}`, realizedCommit: null };
    }
    if (outcome.kind === 'FAILED') {
      return { newSourceRevision: null, detail: `the repair commit failed: ${outcome.failure.errorType} — ${outcome.failure.message}`, realizedCommit: null };
    }
    return {
      newSourceRevision: outcome.result.sha,
      detail: 're-committed the planned (correct) files as a new revision through the real GitHub provider and the action gateway',
      realizedCommit: outcome.result,
    };
  }
}

/** Construct the dogfood node-repair executor. */
export function createDogfoodNodeRepairExecutor(options: DogfoodNodeRepairOptions): DogfoodNodeRepairExecutor {
  return new DogfoodNodeRepairExecutor(options);
}
