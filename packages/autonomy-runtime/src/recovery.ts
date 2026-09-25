/**
 * The body-loss recovery planner (Work Order P12).
 *
 * On a LOST lease (a VERIFIED body failure — never an inference), the
 * planner re-plans: WHICH tasks the replacement body inherits, WHICH
 * checkpoint it resumes from, WHICH authority context carries over, and
 * WHAT stays honestly UNKNOWN until re-verified. The plan is a pure
 * typed read of the durable records — no writes, no state changes; the
 * EXECUTION of the plan (body replacement + resume) is the task
 * runtime's job (@sos-2/task-runtime).
 *
 * In-flight side effects are RECONCILED, never assumed: the plan names
 * the artifacts already durably recorded (what the store proves), and
 * the side-effects-unknown list records what only the replacement body
 * can re-verify (a body that died mid-operation leaves its operation's
 * durable effect uncertain — the store says what landed, not what the
 * body intended).
 */

import type { BodyLeaseRepository, TaskRecord, TaskStateRepository } from '@sos-2/live-store';
import { AutonomyRuntimeError } from './errors.js';

/** What the replacement body inherits, verified against the durable store. */
export interface RecoveryInheritance {
  /** The exact task the replacement inherits (identity preserved — never restarted). */
  readonly task_id: string;
  /** The durable checkpoint to resume from, or null when none exists (resume from the start of the work program). */
  readonly resume_from_checkpoint: { readonly checkpoint_id: string; readonly work_graph_state: unknown } | null;
  /** The authority context that carries over (grant refs preserved verbatim). */
  readonly authority_context: { readonly grant_refs: readonly string[]; readonly notes: string | null };
  /** The exact owned workspace/repository revisions at the last durable state. */
  readonly owned_revision: { readonly source_revision: string | null; readonly deployment_revision: string | null };
  /** Artifacts the durable store proves were produced (reconciled from the record — never assumed). */
  readonly produced_artifacts: readonly { readonly artifact_id: string; readonly content_hash: string }[];
  /** Unresolved uncertainty carried over (retained, never dropped). */
  readonly unresolved_uncertainty: readonly string[];
}

/** The typed recovery plan for one lost lease. */
export interface RecoveryPlan {
  /** The lost lease (the verified failure that triggered this plan). */
  readonly lost_lease_id: string;
  /** The task the lost lease served. */
  readonly task_id: string;
  /** The verified failure observation that justified LOST. */
  readonly verified_failure: { readonly observationId: string; readonly detail: string };
  /** The inheritance the replacement body receives. */
  readonly inheritance: RecoveryInheritance;
  /** Honestly UNKNOWN until the replacement body re-verifies (in-flight side effects, body-local state). */
  readonly unknown_until_reverified: readonly string[];
}

export interface RecoveryPlannerDeps {
  readonly tasks: TaskStateRepository;
  readonly leases: BodyLeaseRepository;
}

/** Plan the recovery of one LOST lease (pure; typed; fail-closed). */
export class RecoveryPlanner {
  constructor(private readonly deps: RecoveryPlannerDeps) {}

  async plan(input: { readonly lost_lease_id: string; readonly verified_failure: { readonly observationId: string; readonly detail: string } }): Promise<RecoveryPlan> {
    if (typeof input.lost_lease_id !== 'string' || input.lost_lease_id.length === 0) {
      throw new AutonomyRuntimeError('INVALID_INPUT', 'plan() requires a non-empty lost_lease_id');
    }
    const lease = await this.deps.leases.get(input.lost_lease_id);
    if (lease === undefined) {
      throw new AutonomyRuntimeError('RECOVERY_PLAN', `lease ${JSON.stringify(input.lost_lease_id)} is not in the durable lease store`);
    }
    // NO FABRICATED LOSS: the plan requires the VERIFIED failure observation
    // (the LOST verdict's only source). The lease may still be ACTIVE at
    // plan time — the replacement execution (fabric.replaceBodyForTask)
    // is what ends it; silence alone never reaches this planner.
    const task: TaskRecord | undefined = await this.deps.tasks.get(lease.task_ref);
    if (task === undefined) {
      throw new AutonomyRuntimeError('RECOVERY_PLAN', `task ${JSON.stringify(lease.task_ref)} of the lost lease is not in the durable task store — the task must never be lost with the body`);
    }
    const checkpoints = [...task.checkpoints].sort((a, b) => (a.checkpoint_id < b.checkpoint_id ? -1 : 1));
    const lastCheckpoint = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : undefined;
    return {
      lost_lease_id: input.lost_lease_id,
      task_id: task.task_id,
      verified_failure: { observationId: input.verified_failure.observationId, detail: input.verified_failure.detail },
      inheritance: {
        task_id: task.task_id,
        resume_from_checkpoint:
          lastCheckpoint === undefined
            ? null
            : { checkpoint_id: lastCheckpoint.checkpoint_id, work_graph_state: lastCheckpoint.work_graph_state },
        authority_context: { grant_refs: [...task.authority_context.grant_refs], notes: task.authority_context.notes },
        owned_revision: { source_revision: task.owned_revision.source_revision, deployment_revision: task.owned_revision.deployment_revision },
        produced_artifacts: task.artifacts.map((artifact) => ({ artifact_id: artifact.artifact_id, content_hash: artifact.content_hash })),
        unresolved_uncertainty: [...task.unresolved_uncertainty],
      },
      unknown_until_reverified: [
        'the in-flight side effects of the lost body at the failure instant: the durable store proves what LANDED, not what the body INTENDED — the replacement re-verifies its workspace state before proceeding',
        'body-local session state (the dead body\'s caches/cursors) is gone by construction; the replacement rebuilds it from the durable record',
        `the truth of ${JSON.stringify(lease.body_id)} after the failure instant is UNKNOWN until the provider re-observes it`,
      ],
    };
  }
}
