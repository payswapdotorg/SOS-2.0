/**
 * THE WORKER RUNTIME (Work Order P6) — the worker-side execution runtime
 * of the Spirit Orchestrator.
 *
 * THE CONTRACT A WORKER FULFILS while executing an assigned task through
 * the P5 harness:
 *
 *   1. STATE      the durable node must be RUNNING under the assignment's
 *                 lease (typed refusal otherwise);
 *   2. RESUME     a retried task resumes FROM ITS LAST CHECKPOINT, not
 *                 from zero (the checkpoint chain is read from the
 *                 durable node — crash recovery);
 *   3. CAPABILITY every operation step is CAPABILITY-CHECKED against the
 *                 body's BINDING §3 advertisement through the harness
 *                 contract's own isOperationAdvertised map BEFORE
 *                 dispatch — an unadvertised operation is a typed
 *                 CAPABILITY_UNSUPPORTED failure naming the operation
 *                 (never a silent failure, never a surprise dispatch);
 *   4. DISPATCH   operations flow through the execution fabric's uniform
 *                 gates (task -> lease -> authority -> advertisement ->
 *                 dispatch), so every consequential operation re-checks
 *                 lease liveness and CURRENT authority;
 *   5. CHECKPOINT checkpoint steps record DURABLE checkpoints through
 *                 the fabric and chain them into the task graph;
 *   6. RESULT     the run ends in a typed WorkerResult — honest status,
 *                 durable evidence refs, the exact workspace revision,
 *                 full provenance (model/version when the reasoning
 *                 broker participated) and retained uncertainty. A
 *                 completion REPORT never certifies mission success
 *                 (section 10) — the orchestrator routes it to
 *                 independent verification.
 *
 * SIMULATED CRASHES are explicit, deterministic injections
 * (crashBeforeStep — the honest simulated marker rides the result); zero
 * real process spawning in library code.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — the clock, fabric, broker and stores are injected.
 */

import { InvalidWorkerStateError } from './errors.js';
import type { WorkerStep, WorkerStepProgram } from './steps.js';
import { deserializeWorkerStepProgram } from './steps.js';
import type { WorkerProvenance, WorkerReasoningProvenance, WorkerResult } from './result.js';
import type { ExecutionFabric, FabricOperation } from '@sos-2/execution-fabric';
import { harnessOperationOf } from '@sos-2/execution-fabric';
import type { BodyBroker } from '@sos-2/body-broker';
import type { TaskGraph } from '@sos-2/task-graph';
import type { TaskFailureKind } from '@sos-2/task-graph';
import { nodeFromRecord } from '@sos-2/task-graph';
import type { Clock, TaskStateRepository } from '@sos-2/live-store';
import { isOperationAdvertised } from '@sos-2/harness';
import type { HarnessOperationName } from '@sos-2/harness';

/** Worker runtime dependencies — every port is INJECTED. */
export interface WorkerRuntimeDeps {
  /** The execution fabric (the §9 surface + uniform gates). */
  readonly fabric: ExecutionFabric;
  /** The body broker (lease truth + capability advertisements). */
  readonly broker: BodyBroker;
  /** The durable task graph (checkpoint chaining). */
  readonly graph: TaskGraph;
  /** The durable task repository (node reads). */
  readonly tasks: TaskStateRepository;
  /** The injected clock (no hidden time). */
  readonly clock: Clock;
}

/** The assignment the worker executes (from the orchestrator's dispatch). */
export interface WorkerAssignment {
  readonly task_id: string;
  readonly lane: 1 | 2 | 3;
  readonly worker_ref: string;
  readonly lease_ref: string;
}

/** Execution options (provenance + deterministic simulated crash injection). */
export interface WorkerExecutionOptions {
  /** The reasoning provenance when the broker participated in the plan. */
  readonly reasoning?: WorkerReasoningProvenance | null;
  /**
   * EXPLICIT simulated crash injection: the worker "dies" before the
   * 1-based step index (deterministic; the result honestly carries
   * simulated:true). Null for a normal run.
   */
  readonly crashBeforeStep?: number | null;
}

/** The fabric denial codes that classify as BODY_LOST. */
const BODY_LOST_DENIAL_CODES = new Set(['LEASE_DENIED', 'LEASE_NOT_HELD']);

/** The fabric denial codes that classify as AUTHORITY_GAP. */
const AUTHORITY_DENIAL_CODES = new Set([
  'AUTHORITY_GRANT_ABSENT',
  'AUTHORITY_GRANT_MISSING',
  'AUTHORITY_GRANT_EXPIRED',
  'AUTHORITY_GRANT_REVOKED',
  'AUTHORITY_GRANT_INVALID',
]);

function classifyDenial(code: string): TaskFailureKind {
  if (BODY_LOST_DENIAL_CODES.has(code)) {
    return 'BODY_LOST';
  }
  if (AUTHORITY_DENIAL_CODES.has(code)) {
    return 'AUTHORITY_GAP';
  }
  return 'OPERATION_FAILURE';
}

/**
 * THE WORKER RUNTIME — the deterministic reference implementation.
 */
export class WorkerRuntime {
  private readonly fabric: ExecutionFabric;
  private readonly broker: BodyBroker;
  private readonly graph: TaskGraph;
  private readonly tasks: TaskStateRepository;
  private readonly clock: Clock;

  constructor(deps: WorkerRuntimeDeps) {
    if (
      typeof deps !== 'object' ||
      deps === null ||
      typeof deps.fabric !== 'object' ||
      deps.fabric === null ||
      typeof deps.broker !== 'object' ||
      deps.broker === null ||
      typeof deps.graph !== 'object' ||
      deps.graph === null ||
      typeof deps.tasks !== 'object' ||
      deps.tasks === null ||
      typeof deps.clock !== 'object' ||
      deps.clock === null ||
      typeof deps.clock.nowEpochMs !== 'function'
    ) {
      throw new Error('WorkerRuntime requires injected fabric, broker, graph, tasks and clock ports');
    }
    this.fabric = deps.fabric;
    this.broker = deps.broker;
    this.graph = deps.graph;
    this.tasks = deps.tasks;
    this.clock = deps.clock;
  }

  /**
   * Execute one assigned task through the §9 harness. The result is a
   * typed WorkerResult — honest whatever happened (never fabricated
   * evidence, never a certification).
   */
  async execute(assignment: WorkerAssignment, options: WorkerExecutionOptions = {}): Promise<WorkerResult> {
    const record = await this.tasks.get(assignment.task_id);
    if (record === undefined) {
      throw new InvalidWorkerStateError(`task ${JSON.stringify(assignment.task_id)} is not in the durable task store — the worker never invents tasks`);
    }
    if (record.status !== 'RUNNING') {
      throw new InvalidWorkerStateError(`task ${JSON.stringify(assignment.task_id)} is ${record.status} — a worker executes RUNNING tasks only`);
    }
    if (record.body_lease_ref !== assignment.lease_ref) {
      throw new InvalidWorkerStateError(
        `task ${JSON.stringify(assignment.task_id)} holds lease ${JSON.stringify(record.body_lease_ref)}, not the assignment's ${JSON.stringify(assignment.lease_ref)} — assignment and durable state disagree`,
      );
    }
    const node = nodeFromRecord(record);
    const program: WorkerStepProgram = deserializeWorkerStepProgram((record.plan as { steps: unknown }).steps);
    const steps: readonly WorkerStep[] = program.steps;

    // Crash recovery: a retried task resumes from its LAST checkpoint.
    const lastCheckpoint = node.checkpoint_chain.length > 0 ? node.checkpoint_chain[node.checkpoint_chain.length - 1] : undefined;
    let resumeIndex = lastCheckpoint === undefined ? 0 : lastCheckpoint.step_index;
    let resumedFrom: string | null = lastCheckpoint === undefined ? null : lastCheckpoint.checkpoint_id;
    const resuming = node.retries > 0 || lastCheckpoint !== undefined;

    // Body identity for provenance (honest when the lease still binds).
    const lease = await this.broker.leaseRepository.get(assignment.lease_ref);
    const bodyId = lease?.body_id ?? null;
    let harnessId: string | null = null;
    if (bodyId !== null) {
      try {
        harnessId = this.broker.harnessFor(bodyId).identity().harness_id;
      } catch {
        harnessId = null; // the body is gone — honest null, never fabricated
      }
    }
    const provenance: WorkerProvenance = {
      worker_id: assignment.worker_ref,
      body_id: bodyId,
      harness_id: harnessId,
      reasoning: options.reasoning ?? null,
    };

    // §9 SESSION ESTABLISHMENT — the worker drives the body-side task
    // session through the contract itself: createTask on a first run,
    // resumeTask on a retry (the same body reuses its session — a
    // replacement body ADOPTS the task with a fresh bounded environment;
    // the durable task record is the truth either way).
    if (bodyId !== null) {
      const harness = this.broker.harnessFor(bodyId);
      const session =
        resuming
          ? harness.resumeTask({ task_ref: assignment.task_id, input: { resumed_from_checkpoint: lastCheckpoint?.checkpoint_id ?? null } })
          : harness.createTask({ task_ref: assignment.task_id, input: { work_program_steps: steps.length } });
      if (session.status === 'UNSUPPORTED') {
        return this.failedResult(assignment, provenance, [], [], node.workspace_revision.source_revision, node, 0, steps.length, lastCheckpoint?.checkpoint_id ?? null, {
          kind: 'CAPABILITY_UNSUPPORTED',
          reason: `body ${JSON.stringify(bodyId)} advertisement does not carry ${resuming ? 'resumeTask' : 'createTask'}: ${session.reason}`,
          denial_code: null,
          simulated: false,
        });
      }
      if (session.status === 'FAILED') {
        return this.failedResult(assignment, provenance, [], [], node.workspace_revision.source_revision, node, 0, steps.length, lastCheckpoint?.checkpoint_id ?? null, {
          kind: 'OPERATION_FAILURE',
          reason: `body ${resuming ? 'resumeTask' : 'createTask'} ran and failed: ${session.error}`,
          denial_code: null,
          simulated: false,
        });
      }
      // HONEST FRESH ADOPTION: when the (replacement) body adopted the
      // task with a fresh bounded environment (body-side state did not
      // survive), the checkpoint's prior effects are gone — the run
      // restarts from ZERO (the durable task record is the truth; the
      // summary reports the adoption honestly).
      if (resuming && session.status === 'OK' && 'recovered' in session.value && isPlainObject(session.value.recovered) && session.value.recovered['adopted_by_replacement'] === true) {
        resumeIndex = 0;
        resumedFrom = null;
      }
    }

    const evidenceRefs: string[] = [];
    const uncertainty: string[] = [];
    let sourceRevision: string | null = node.workspace_revision.source_revision;
    // The program progress count: a resumed run starts from the steps
    // its checkpoint already covered (across runs — the verifier checks
    // the WHOLE program ran).
    let executed = resumeIndex;

    for (let index = resumeIndex; index < steps.length; index += 1) {
      const step = steps[index]!;

      // EXPLICIT simulated crash injection (deterministic, honest marker).
      if (options.crashBeforeStep !== null && options.crashBeforeStep !== undefined && options.crashBeforeStep === index + 1) {
        return {
          task_id: assignment.task_id,
          worker_id: assignment.worker_ref,
          status: 'FAILED',
          evidence_refs: [...evidenceRefs],
          workspace_revision: { source_revision: sourceRevision, deployment_revision: node.workspace_revision.deployment_revision },
          provenance,
          uncertainty: [...uncertainty],
          failure: {
            kind: 'WORKER_CRASH',
            reason: `simulated worker crash before step ${index + 1} (deterministic injection — the durable checkpoint chain survives and the retry resumes from it, not from zero)`,
            denial_code: null,
            simulated: true,
          },
          ask: null,
          resumed_from_checkpoint: resumedFrom,
          summary: `simulated crash before step ${index + 1}; ${executed} step(s) had run, ${evidenceRefs.length} evidence ref(s) recorded`,
          steps_executed: executed,
          steps_total: steps.length,
        };
      }

      if (step.kind === 'operation') {
        // CAPABILITY-CHECKED CALL — the binding advertisement through the
        // contract's own map, BEFORE dispatch (typed UNSUPPORTED path).
        const unsupported = this.checkAdvertised(step.operation, assignment.lease_ref, bodyId);
        if (unsupported !== null) {
          return this.failedResult(assignment, provenance, evidenceRefs, uncertainty, sourceRevision, node, executed, steps.length, resumedFrom, {
            kind: 'CAPABILITY_UNSUPPORTED',
            reason: unsupported.reason,
            denial_code: null,
            simulated: false,
          });
        }
        const result = await this.fabric.execute(assignment.task_id, step.operation);
        if (result.status === 'CONFLICT') {
          return this.failedResult(assignment, provenance, evidenceRefs, uncertainty, sourceRevision, node, executed, steps.length, resumedFrom, {
            kind: 'OPERATION_FAILURE',
            reason: `step ${index + 1} (${step.operation.kind}) lost the durable write race: ${result.reason}`,
            denial_code: null,
            simulated: false,
          });
        }
        if (result.status === 'DENIED') {
          const kind = classifyDenial(result.denial.code);
          return this.failedResult(assignment, provenance, evidenceRefs, uncertainty, sourceRevision, node, executed, steps.length, resumedFrom, {
            kind,
            reason: `step ${index + 1} (${step.operation.kind}) was denied (${result.denial.code}): ${result.denial.reason}`,
            denial_code: result.denial.code,
            simulated: false,
          });
        }
        if (result.status === 'UNSUPPORTED') {
          return this.failedResult(assignment, provenance, evidenceRefs, uncertainty, sourceRevision, node, executed, steps.length, resumedFrom, {
            kind: 'CAPABILITY_UNSUPPORTED',
            reason: `step ${index + 1} (${step.operation.kind}) is not carried by the body advertisement: ${result.reason}`,
            denial_code: null,
            simulated: false,
          });
        }
        evidenceRefs.push(result.observation_id);
        executed += 1;
        if (result.availability === 'FAILURE') {
          return this.failedResult(assignment, provenance, evidenceRefs, uncertainty, sourceRevision, node, executed, steps.length, resumedFrom, {
            kind: 'OPERATION_FAILURE',
            reason: `step ${index + 1} (${step.operation.kind}) ran and failed: ${result.error ?? 'failure'}`,
            denial_code: null,
            simulated: false,
          });
        }
        // Extract durable refs from SUCCESS outputs: the exact workspace
        // revision (git commit) and the FABRIC-minted artifact id (the
        // durable record's artifact — never the body's payload id).
        const output = result.output;
        if (step.operation.kind === 'git.commit' && isPlainObject(output) && typeof output['commit_ref'] === 'string') {
          sourceRevision = output['commit_ref'];
        }
        if (step.operation.kind === 'artifacts.capture') {
          const freshRecord = await this.tasks.get(assignment.task_id);
          const durableArtifact = freshRecord === undefined ? undefined : freshRecord.artifacts[freshRecord.artifacts.length - 1];
          if (durableArtifact !== undefined) {
            evidenceRefs.push(durableArtifact.artifact_id);
          }
        }
        continue;
      }

      if (step.kind === 'checkpoint') {
        const transition = await this.fabric.recordCheckpoint(assignment.task_id, {
          label: step.label,
          work_graph_state: { step_index: index + 1, next_step: index + 1 },
          notes: step.notes,
        });
        if (transition.status === 'DENIED' || transition.status === 'FAILED') {
          const reason = transition.status === 'DENIED' ? transition.denial.reason : transition.error;
          const code = transition.status === 'DENIED' ? transition.denial.code : null;
          return this.failedResult(assignment, provenance, evidenceRefs, uncertainty, sourceRevision, node, executed, steps.length, resumedFrom, {
            kind: code !== null ? classifyDenial(code) : 'OPERATION_FAILURE',
            reason: `checkpoint before step ${index + 1} failed: ${reason}`,
            denial_code: code,
            simulated: false,
          });
        }
        evidenceRefs.push(transition.observation_id);
        executed += 1;
        // Chain the durable checkpoint into the node (the resumable
        // step index — a crashed worker resumes from here).
        const durableCheckpoint = transition.task.checkpoints[transition.task.checkpoints.length - 1];
        if (durableCheckpoint !== undefined) {
          await this.graph.recordCheckpointRef(assignment.task_id, {
            checkpoint_id: durableCheckpoint.checkpoint_id,
            step_index: index + 1,
            recorded_at: durableCheckpoint.recorded_at,
          });
        }
        continue;
      }

      if (step.kind === 'uncertainty') {
        uncertainty.push(step.statement);
        executed += 1;
        continue;
      }

      // ask step — ASK IS A SUCCESS STATE: stop and escalate.
      return {
        task_id: assignment.task_id,
        worker_id: assignment.worker_ref,
        status: 'ASK_REQUIRED',
        evidence_refs: [...evidenceRefs],
        workspace_revision: { source_revision: sourceRevision, deployment_revision: node.workspace_revision.deployment_revision },
        provenance,
        uncertainty: [...uncertainty],
        failure: null,
        ask: { statement: step.statement, basis: step.basis },
        resumed_from_checkpoint: resumedFrom,
        summary: `run stopped at step ${index + 1} on an ask escalation: ${step.statement}`,
        steps_executed: executed,
        steps_total: steps.length,
      };
    }

    // The program ran to its end — an honest COMPLETION REPORT (never a
    // certification: the orchestrator routes this to independent
    // verification).
    return {
      task_id: assignment.task_id,
      worker_id: assignment.worker_ref,
      status: 'COMPLETED_REPORT',
      evidence_refs: [...evidenceRefs],
      workspace_revision: { source_revision: sourceRevision, deployment_revision: node.workspace_revision.deployment_revision },
      provenance,
      uncertainty: [...uncertainty],
      failure: null,
      ask: null,
      resumed_from_checkpoint: resumedFrom,
      summary: `all ${steps.length} step(s) of the work program ran${resumedFrom === null ? ' from zero' : ` (resumed from checkpoint ${resumedFrom})`}; ${evidenceRefs.length} evidence ref(s) recorded; exact source revision ${sourceRevision === null ? 'unpinned (no commit step ran)' : sourceRevision}`,
      steps_executed: executed,
      steps_total: steps.length,
    };
  }

  /** Capability pre-check through the contract's own binding advertisement map. */
  private checkAdvertised(operation: FabricOperation, leaseRef: string, bodyId: string | null): { reason: string } | null {
    if (bodyId === null) {
      return { reason: `the assignment's lease ${JSON.stringify(leaseRef)} binds no body — the capability cannot be checked and the operation cannot dispatch` };
    }
    const registration = this.broker.body(bodyId);
    if (registration === undefined) {
      return { reason: `body ${JSON.stringify(bodyId)} is no longer registered with the broker — its advertisement is gone` };
    }
    const harnessOperation: HarnessOperationName = harnessOperationOf(operation);
    if (!isOperationAdvertised(registration.capabilities, harnessOperation)) {
      return {
        reason: `body ${JSON.stringify(bodyId)} advertisement does not carry operation ${JSON.stringify(harnessOperation)} — unadvertised operations are typed UNSUPPORTED, never a silent failure`,
      };
    }
    return null;
  }

  private failedResult(
    assignment: WorkerAssignment,
    provenance: WorkerProvenance,
    evidenceRefs: readonly string[],
    uncertainty: readonly string[],
    sourceRevision: string | null,
    node: { workspace_revision: { source_revision: string | null; deployment_revision: string | null } },
    executed: number,
    total: number,
    resumedFrom: string | null,
    failure: { kind: TaskFailureKind; reason: string; denial_code: string | null; simulated: boolean },
  ): WorkerResult {
    void this.clock; // the clock rides the fabric/graph writes, not this pure builder
    return {
      task_id: assignment.task_id,
      worker_id: assignment.worker_ref,
      status: 'FAILED',
      evidence_refs: [...evidenceRefs],
      workspace_revision: { source_revision: sourceRevision, deployment_revision: node.workspace_revision.deployment_revision },
      provenance,
      uncertainty: [...uncertainty],
      failure,
      ask: null,
      resumed_from_checkpoint: resumedFrom,
      summary: `failed after ${executed}/${total} step(s): ${failure.reason}`,
      steps_executed: executed,
      steps_total: total,
    };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
