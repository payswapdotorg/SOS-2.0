/**
 * THE SPIRIT ORCHESTRATOR (Work Order P6) — the governed control loop
 * over the merged P2 live-store records and the P5 execution fabric.
 *
 * TOPOLOGY (spec/productization-execution-architecture.md §2): the
 * orchestrator sits beside System State and Observation, ABOVE the Body
 * Broker — it is part of the SPIRIT control loop, never a body, never an
 * authority mint.
 *
 * ONE TICK (a deterministic control-loop step — no ambient timers; the
 * host drives ticks from an injected tick source):
 *
 *   1. RECOVERY  failed RETRYABLE tasks re-queue (their dead leases end
 *                first — recovery marks the task retryable, never
 *                silently done);
 *   2. DISPATCH  ready PENDING tasks (dependencies COMPLETED) assign
 *                onto FREE lanes (1..3) with DISJOINT owned-path scopes
 *                on capability-selected bodies (a scope collision is a
 *                TYPED assignment denial, recorded — never a silent
 *                overlap);
 *   3. EXECUTE   every RUNNING task's worker executes its work program
 *                through the worker runtime (§9 session establishment,
 *                capability-checked operations, checkpoints, honest
 *                results — all three lanes run within the same tick);
 *   4. INGEST    results route by status:
 *                  COMPLETED_REPORT -> INDEPENDENT VERIFICATION -> the
 *                  verdict gates the COMPLETED transition (no
 *                  self-approval);
 *                  FAILED           -> typed failure + recovery;
 *                  AUTHORITY_GAP / ASK_REQUIRED -> ASK escalation
 *                  through the AskQueue (first-class, never an
 *                  exception class) and the task parks;
 *   5. SCAN      the graph invariant scan must hold (a violation throws
 *                typed — crash safety is structural).
 *
 * MISSION COMPLETION is an architect-gated consequential transition
 * (merge/promote/deploy-class): completeMission refuses to run without
 * the governed gate record (typed violation naming the rule).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — the clock, stores, broker, fabric, verifier, ask
 * queue and reasoning plane are injected.
 */

import { InvalidOrchestratorInputError, SilentBypassViolationError } from './errors.js';
import type { DecompositionRecord, TaskIdSource } from './decomposition.js';
import { createDeterministicTaskIdSource, decomposeMissionDeterministically, missionView } from './decomposition.js';
import type { OrchestratorVerificationRecord, IndependentVerificationPort } from './verification.js';
import { assertVerificationGatesCompletion } from './verification.js';
import type { AskEscalationOutcome } from './escalation.js';
import { escalateAsk, failureKindOf } from './escalation.js';
import type { ArchitectGate, ArchitectGateRecord } from './architect-gate.js';
import { assertValidArchitectGateRecord } from './architect-gate.js';
import type { TaskGraph } from '@sos-2/task-graph';
import type { TaskFailureKind, TaskNode } from '@sos-2/task-graph';
import type { MissionArtifact } from '@sos-2/mission';
import { assertValidMission } from '@sos-2/mission';
import type { ReasoningBroker } from '@sos-2/reasoning-broker';
import type { NonAuthoritativeAnalysis } from '@sos-2/reasoning-broker';
import type { WorkerRuntime } from '@sos-2/worker-runtime';
import type { WorkerReasoningProvenance, WorkerResult } from '@sos-2/worker-runtime';
import { serializeWorkerStepProgram } from '@sos-2/worker-runtime';
import type { ExecutionFabric } from '@sos-2/execution-fabric';
import type { BodyBroker, BodySelectionRequirements } from '@sos-2/body-broker';
import type { AskQueue } from '@sos-2/ask';
import type { AuthorityGrantRepository, Clock, TaskStateRepository, TaskVerificationRecord } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { evaluateGrant } from '@sos-2/authority';

/** Orchestrator dependencies — every port is INJECTED. */
export interface SpiritOrchestratorDeps {
  readonly graph: TaskGraph;
  readonly fabric: ExecutionFabric;
  readonly broker: BodyBroker;
  readonly worker: WorkerRuntime;
  readonly reasoning: ReasoningBroker;
  readonly verifier: IndependentVerificationPort;
  readonly askQueue: AskQueue;
  readonly gate: ArchitectGate;
  readonly tasks: TaskStateRepository;
  readonly authorityGrants: AuthorityGrantRepository;
  readonly clock: Clock;
}

/** Body requirements the orchestrator's reference dispatch demands. */
const REFERENCE_BODY_REQUIREMENTS: BodySelectionRequirements = {
  requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'],
  placement: 'cloud',
};

/** One dispatch outcome recorded on a tick. */
export interface DispatchRecord {
  readonly task_id: string;
  readonly lane: 1 | 2 | 3;
  readonly worker_ref: string;
  readonly lease_ref: string;
  readonly body_id: string;
  /** The carried handoff: authority context + workspace revision. */
  readonly handoff: { readonly authority_ref: string; readonly workspace_revision: { readonly source_revision: string | null; readonly deployment_revision: string | null } };
}

/** One typed dispatch denial recorded on a tick (never silent). */
export interface DispatchDenialRecord {
  readonly task_id: string;
  readonly code: string;
  readonly reason: string;
}

/** One ingested worker outcome on a tick. */
export interface IngestionRecord {
  readonly task_id: string;
  readonly worker_status: WorkerResult['status'];
  readonly outcome:
    | { readonly kind: 'COMPLETED'; readonly verification: OrchestratorVerificationRecord }
    | { readonly kind: 'FAILED'; readonly failure_kind: TaskFailureKind; readonly recovery: 'RETRYABLE' | 'TERMINAL' }
    | { readonly kind: 'ASK_ESCALATED'; readonly ask_ref: string; readonly entry_id: string }
    | { readonly kind: 'ASK_NOT_ESCALATED'; readonly action: string; readonly failure_kind: TaskFailureKind };
}

/** One tick of the control loop (the deterministic audit unit). */
export interface TickRecord {
  readonly tick: number;
  readonly recovered: readonly string[];
  readonly dispatched: readonly DispatchRecord[];
  readonly denials: readonly DispatchDenialRecord[];
  readonly ingested: readonly IngestionRecord[];
  readonly graph_valid: boolean;
}

/** The honest end-of-journey report. */
export interface JourneyReport {
  readonly mission_ref: string;
  readonly authority_ref: string;
  readonly decomposition_id: string;
  readonly ticks: readonly TickRecord[];
  readonly tasks: readonly {
    readonly task_id: string;
    readonly title: string;
    readonly state: TaskNode['state'];
    readonly retries: number;
    readonly verification_ref: string | null;
    readonly workspace_revision: { readonly source_revision: string | null; readonly deployment_revision: string | null };
    readonly uncertainty: readonly string[];
  }[];
  readonly asks: readonly { readonly entry_id: string; readonly ask_ref: string; readonly status: string }[];
  readonly gate: ArchitectGateRecord | null;
  readonly reasoning: {
    readonly provider_id: string;
    readonly provider_kind: string;
    readonly model: string;
    readonly version: string;
    readonly simulated: boolean;
    readonly analysis_ids: readonly string[];
    readonly non_authoritative: true;
  } | null;
  /** EXPLICIT simulated markers (honest demo state, never live claims). */
  readonly simulated_markers: readonly string[];
  readonly completed: boolean;
  readonly summary: string;
}

/** Simulation inputs (explicit, deterministic, honestly reported). */
export interface JourneySimulation {
  /** Deterministic simulated worker crashes: task index (0-based) -> before_step (1-based). */
  readonly crashes?: Readonly<Record<number, number>>;
}

/**
 * THE SPIRIT ORCHESTRATOR.
 */
export class SpiritOrchestrator {
  private readonly graph: TaskGraph;
  private readonly fabric: ExecutionFabric;
  private readonly broker: BodyBroker;
  private readonly worker: WorkerRuntime;
  private readonly reasoning: ReasoningBroker;
  private readonly verifier: IndependentVerificationPort;
  private readonly askQueue: AskQueue;
  private readonly gate: ArchitectGate;
  private readonly tasks: TaskStateRepository;
  private readonly authorityGrants: AuthorityGrantRepository;
  private readonly clock: Clock;
  private readonly idSource: TaskIdSource;
  private tickCounter = 0;
  private readonly tickLog: TickRecord[] = [];
  private decomposition: DecompositionRecord | null = null;
  private reasoningProvenance: WorkerReasoningProvenance | null = null;

  constructor(deps: SpiritOrchestratorDeps) {
    if (
      typeof deps !== 'object' ||
      deps === null ||
      typeof deps.graph !== 'object' ||
      typeof deps.fabric !== 'object' ||
      typeof deps.broker !== 'object' ||
      typeof deps.worker !== 'object' ||
      typeof deps.reasoning !== 'object' ||
      typeof deps.verifier !== 'object' ||
      typeof deps.askQueue !== 'object' ||
      typeof deps.gate !== 'object' ||
      typeof deps.tasks !== 'object' ||
      typeof deps.authorityGrants !== 'object' ||
      typeof deps.clock !== 'object' ||
      typeof deps.clock.nowEpochMs !== 'function'
    ) {
      throw new InvalidOrchestratorInputError('SpiritOrchestrator requires every port injected (graph, fabric, broker, worker, reasoning, verifier, askQueue, gate, tasks, authorityGrants, clock)');
    }
    this.graph = deps.graph;
    this.fabric = deps.fabric;
    this.broker = deps.broker;
    this.worker = deps.worker;
    this.reasoning = deps.reasoning;
    this.verifier = deps.verifier;
    this.askQueue = deps.askQueue;
    this.gate = deps.gate;
    this.tasks = deps.tasks;
    this.authorityGrants = deps.authorityGrants;
    this.clock = deps.clock;
    this.idSource = createDeterministicTaskIdSource('task');
  }

  /**
   * MISSION-AWARE DECOMPOSITION: route the mission view through the
   * reasoning broker as NON-AUTHORITATIVE input, then build the durable
   * task graph with DETERMINISTIC code (every node carries the mission
   * and authority references — pinned).
   */
  async decomposeMission(input: { mission: MissionArtifact; authority_ref: string }): Promise<DecompositionRecord> {
    assertValidMission(input.mission);
    const now = formatRfc3339(this.clock.nowEpochMs());
    // The reasoning broker participates (managed default — zero user
    // configuration needed; BYO preferred only when connected+eligible).
    const brokered = await this.reasoning.analyze({
      kind: 'decomposition',
      input: missionView(input.mission),
      context: { mission_ref: input.mission.envelope.id, max_cost_usd: null },
    });
    const analysis: NonAuthoritativeAnalysis = brokered.analysis;
    const decomposition = decomposeMissionDeterministically({
      mission: input.mission,
      authority_ref: input.authority_ref,
      idSource: this.idSource,
      analysis,
      created_at: now,
    });
    // The durable graph: every planned task becomes a PENDING node.
    for (const planned of decomposition.plan) {
      await this.graph.addNode({
        task_id: planned.task_id,
        mission_ref: input.mission.envelope.id,
        authority_ref: input.authority_ref,
        title: planned.title,
        owned_paths: planned.owned_paths,
        dependencies: planned.dependencies,
        cost_envelope: planned.cost_envelope,
        unresolved_uncertainty: planned.uncertainty,
        steps: serializeWorkerStepProgram({ steps: planned.steps }),
      });
    }
    this.decomposition = decomposition;
    this.reasoningProvenance = {
      provider_id: analysis.provenance.provider_id,
      provider_kind: analysis.provenance.provider_kind,
      model: analysis.provenance.model,
      version: analysis.provenance.version,
      analysis_ids: [analysis.analysis_id],
      simulated: analysis.provenance.simulated,
    };
    return decomposition;
  }

  /** The decomposition record of the current journey, when decomposed. */
  currentDecomposition(): DecompositionRecord | null {
    return this.decomposition === null ? null : structuredClone(this.decomposition);
  }

  /**
   * ONE TICK of the control loop (recovery -> dispatch -> execute ->
   * ingest -> scan). Deterministic; driven by the host's injected tick
   * source (no ambient timers).
   */
  async tick(simulation: JourneySimulation = {}): Promise<TickRecord> {
    this.tickCounter += 1;
    const recovered: string[] = [];
    const denials: DispatchDenialRecord[] = [];

    // 1. RECOVERY — failed RETRYABLE tasks re-queue (dead leases end
    //    first). Bounded: a task that exhausted its retry budget stays
    //    FAILED (honest — never silently done; the journey reports it).
    const RETRY_BUDGET = 3;
    for (const node of await this.graph.nodes()) {
      if (node.state === 'FAILED' && node.recovery.status === 'RETRYABLE') {
        if (node.retries >= RETRY_BUDGET) {
          continue; // the retry budget is exhausted — the task stays FAILED (honest)
        }
        const record = await this.tasks.get(node.task_id);
        if (record !== undefined && record.body_lease_ref !== null) {
          const lease = await this.broker.leaseRepository.get(record.body_lease_ref);
          if (lease !== undefined && lease.state === 'ACTIVE') {
            await this.broker.releaseLease(lease.lease_id, `recovery re-queues task ${node.task_id}`);
          }
        }
        await this.graph.retry(node.task_id);
        recovered.push(node.task_id);
      }
    }

    // 2. DISPATCH — ready PENDING tasks assign onto free lanes with
    //    disjoint scopes on capability-selected bodies.
    const nodes = await this.graph.nodes();
    const activeLanes = new Set<number>();
    for (const node of nodes) {
      if (node.state === 'RUNNING' || (node.state === 'PAUSED' && node.assignment !== null)) {
        if (node.assignment !== null) {
          activeLanes.add(node.assignment.lane);
        }
      }
    }
    const dispatches: DispatchRecord[] = [];
    const ready = nodes.filter((node) => node.state === 'PENDING');
    for (const node of ready) {
      const lane = nextFreeLane(activeLanes);
      if (lane === null) {
        denials.push({ task_id: node.task_id, code: 'LANE_EXHAUSTED', reason: 'all three worker lanes are occupied — the task waits for the next tick' });
        continue;
      }
      const dependenciesSatisfied = await dependenciesCompleted(this.graph, node);
      if (!dependenciesSatisfied) {
        denials.push({ task_id: node.task_id, code: 'DEPENDENCY_UNSATISFIED', reason: 'dependencies are not all COMPLETED — the task waits' });
        continue;
      }
      const selection = await this.selectBodyForTask(node.retries > 0 ? node.task_id : null);
      if (selection === null) {
        denials.push({ task_id: node.task_id, code: 'NO_BODY_AVAILABLE', reason: 'no AVAILABLE cloud body advertises the required capabilities' });
        continue;
      }
      const acquisition = await this.broker.acquireLease({
        task_ref: node.task_id,
        body_id: selection.body_id,
        holder: 'spirit-orchestrator',
        expires_at: null,
      });
      if (acquisition.status !== 'ACQUIRED') {
        denials.push({ task_id: node.task_id, code: 'LEASE_DENIED', reason: `lease acquisition was denied: ${'denial' in acquisition ? acquisition.denial.reason : 'conflict'}` });
        continue;
      }
      const workerRef = `worker-lane-${lane}`;
      try {
        await this.graph.assign(node.task_id, { lane, worker_ref: workerRef, lease_ref: acquisition.lease.lease_id, note: null });
      } catch (cause) {
        // TYPED assignment denial (scope collision / lane / dependency) —
        // recorded, never a silent overlap. The lease ends.
        await this.broker.releaseLease(acquisition.lease.lease_id, 'assignment denied');
        const code = (cause as { denial?: { code: string }; message: string }).denial?.code ?? 'ASSIGNMENT_DENIED';
        denials.push({ task_id: node.task_id, code, reason: (cause as Error).message });
        continue;
      }
      activeLanes.add(lane);
      dispatches.push({
        task_id: node.task_id,
        lane,
        worker_ref: workerRef,
        lease_ref: acquisition.lease.lease_id,
        body_id: selection.body_id,
        handoff: {
          authority_ref: node.authority_ref,
          workspace_revision: { ...node.workspace_revision },
        },
      });
    }

    // 3. EXECUTE — every RUNNING task's worker runs within this tick
    //    (the three lanes execute concurrently on disjoint scopes).
    const running = (await this.graph.nodes()).filter((node) => node.state === 'RUNNING');
    const results: { node: TaskNode; result: WorkerResult }[] = [];
    for (const node of running) {
      const assignment = node.assignment;
      if (assignment === null) {
        continue;
      }
      // The simulated crash injection fires ONCE (first attempt only — a
      // deterministic, honestly-reported demonstration of crash recovery).
      const crashBeforeStep = node.retries === 0 ? simulation.crashes?.[this.dispatchIndexOf(node.task_id)] ?? null : null;
      const result = await this.worker.execute(
        { task_id: node.task_id, lane: assignment.lane, worker_ref: assignment.worker_ref, lease_ref: assignment.lease_ref },
        { reasoning: this.reasoningProvenance, crashBeforeStep },
      );
      results.push({ node, result });
    }

    // 4. INGEST — route every result (verification-gated completion,
    //    typed failures, ASK escalation).
    const ingested: IngestionRecord[] = [];
    for (const { node, result } of results) {
      ingested.push(await this.ingestResult(node, result));
    }

    // 5. SCAN — crash safety is structural: the invariant scan must hold.
    const scan = await this.graph.scan();
    if (!scan.valid) {
      throw new SilentBypassViolationError(
        'graph-invariants-hold',
        'scan',
        `the task graph invariant scan failed after the tick: ${scan.violations.map((violation) => `${violation.rule}: ${violation.detail}`).join('; ')}`,
      );
    }
    const record: TickRecord = {
      tick: this.tickCounter,
      recovered,
      dispatched: dispatches,
      denials,
      ingested,
      graph_valid: true,
    };
    this.tickLog.push(record);
    return record;
  }

  /**
   * The honest journey report of the CURRENT state (the same shape
   * runToCompletion/completeMission return — callable mid-journey for
   * audits and acceptance scans).
   */
  async currentReport(): Promise<JourneyReport> {
    return this.report(null);
  }

  /** The accumulated tick log of the current journey (audit). */
  ticks(): readonly TickRecord[] {
    return this.tickLog.map((tick) => ({ ...tick, dispatched: [...tick.dispatched], denials: [...tick.denials], ingested: [...tick.ingested], recovered: [...tick.recovered] }));
  }

  /**
   * Run the control loop to completion (bounded — no ambient loops): the
   * journey ends when no PENDING/RUNNING/FAILED tasks remain, or when
   * the bound trips (an honest, typed failure).
   */
  async runToCompletion(options: { simulation?: JourneySimulation; maxTicks?: number } = {}): Promise<JourneyReport> {
    const maxTicks = options.maxTicks ?? 100;
    for (let index = 0; index < maxTicks; index += 1) {
      const tick = await this.tick(options.simulation ?? {});
      const nodes = await this.graph.nodes();
      const active = nodes.filter((node) => node.state === 'PENDING' || node.state === 'RUNNING' || node.state === 'FAILED');
      if (active.length === 0) {
        return this.report(null);
      }
      // No progress possible (asks parked everything) — stop honestly.
      if (tick.dispatched.length === 0 && tick.ingested.length === 0 && tick.recovered.length === 0) {
        return this.report(null);
      }
    }
    throw new InvalidOrchestratorInputError(`the journey did not complete within ${maxTicks} ticks — refusing an ambient loop (honest bound)`);
  }

  /**
   * MISSION COMPLETION — an architect-gated consequential transition
   * (merge/promote/deploy-class). The gate approval record is REQUIRED:
   * completing without it is a typed violation naming the rule
   * ('architect-gate-required').
   */
  async completeMission(input: { mission_ref: string; authority_ref: string; rationale: string; gateRecord?: ArchitectGateRecord | null }): Promise<JourneyReport> {
    if (this.decomposition === null) {
      throw new InvalidOrchestratorInputError('no journey is decomposed — decomposeMission first');
    }
    const nodes = await this.graph.nodes();
    const unfinished = nodes.filter((node) => node.state !== 'COMPLETED');
    if (unfinished.length > 0) {
      throw new SilentBypassViolationError(
        'mission-completion-requires-completed-tasks',
        'tasks',
        `mission completion requires every task COMPLETED — ${unfinished.length} task(s) are ${unfinished.map((node) => `${node.task_id}:${node.state}`).join(', ')} (a worker report never certifies mission success)`,
      );
    }
    let gateRecord: ArchitectGateRecord;
    if (input.gateRecord !== undefined && input.gateRecord !== null) {
      // A supplied gate record must be a VALID governed record that
      // approved THIS transition under stored authority.
      assertValidArchitectGateRecord(input.gateRecord);
      if (input.gateRecord.transition !== 'MISSION_COMPLETION' || input.gateRecord.subject_ref !== input.mission_ref) {
        throw new SilentBypassViolationError(
          'architect-gate-required',
          'gateRecord',
          'the supplied gate record does not govern THIS mission completion (transition/subject mismatch) — the governed control function cannot be replayed across subjects',
        );
      }
      const stored = this.gate.decisions().find((record) => record.gate_id === input.gateRecord!.gate_id);
      if (stored === undefined) {
        throw new SilentBypassViolationError(
          'architect-gate-required',
          'gateRecord',
          'the supplied gate record is not in the gate decision log — a forged gate record authorizes nothing (the gate cannot mint approval)',
        );
      }
      gateRecord = stored;
    } else {
      gateRecord = await this.gate.requestApproval({
        transition: 'MISSION_COMPLETION',
        subject_ref: input.mission_ref,
        authority_ref: input.authority_ref,
        rationale: input.rationale,
      });
    }
    return this.report(gateRecord);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Ingest one worker result (the no-self-approval discipline lives here). */
  private async ingestResult(node: TaskNode, result: WorkerResult): Promise<IngestionRecord> {
    // Pin the worker's honest workspace revision onto the node.
    if (result.status === 'COMPLETED_REPORT' && result.workspace_revision.source_revision !== null) {
      await this.graph.recordWorkspaceRevision(node.task_id, result.workspace_revision);
    }

    if (result.status === 'ASK_REQUIRED' || (result.status === 'FAILED' && result.failure !== null && result.failure.kind === 'AUTHORITY_GAP')) {
      const reasonCode = result.status === 'ASK_REQUIRED' ? 'UNCERTAINTY' : 'AUTHORITY_GAP';
      const statement =
        result.status === 'ASK_REQUIRED' && result.ask !== null
          ? result.ask.statement
          : `Resolve the authority gap blocking task ${node.task_id}: ${(result.failure?.reason ?? 'authority denied').slice(0, 160)}`;
      const basis =
        result.status === 'ASK_REQUIRED' && result.ask !== null ? result.ask.basis : (result.failure?.reason ?? 'the execution fabric denied an operation on authority grounds');
      const grants = await this.resolveGrants(node.authority_ref);
      const outcome: AskEscalationOutcome = escalateAsk(
        {
          task_id: node.task_id,
          mission_ref: node.mission_ref,
          authority_ref: node.authority_ref,
          reason: { code: reasonCode, statement, basis },
          grants,
          now: formatRfc3339(this.clock.nowEpochMs()),
          provenance: ['p6-orchestrator:ask-escalation', `task:${node.task_id}`],
        },
        { queue: this.askQueue },
      );
      if (outcome.status === 'ESCALATED') {
        await this.graph.recordAsk(node.task_id, outcome.entry.id, statement);
        return { task_id: node.task_id, worker_status: result.status, outcome: { kind: 'ASK_ESCALATED', ask_ref: outcome.ask_ref, entry_id: outcome.entry.id } };
      }
      // NOT_ESCALATED — the engine decided the authority covers it: a
      // typed retryable failure (honest, never an invented ask).
      const failureKind = failureKindOf(reasonCode);
      await this.graph.recordFailure(node.task_id, {
        failure_kind: failureKind,
        reason: `${outcome.reason} — the run is retried under the covering authority`,
        recovery: 'RETRYABLE',
      });
      return { task_id: node.task_id, worker_status: result.status, outcome: { kind: 'ASK_NOT_ESCALATED', action: outcome.action_taken, failure_kind: failureKind } };
    }

    if (result.status === 'FAILED' && result.failure !== null) {
      await this.graph.recordFailure(node.task_id, {
        failure_kind: result.failure.kind,
        reason: result.failure.reason,
        recovery: 'RETRYABLE',
      });
      return {
        task_id: node.task_id,
        worker_status: result.status,
        outcome: { kind: 'FAILED', failure_kind: result.failure.kind, recovery: 'RETRYABLE' },
      };
    }

    if (result.status === 'FAILED') {
      await this.graph.recordFailure(node.task_id, {
        failure_kind: 'OPERATION_FAILURE',
        reason: 'the worker reported FAILED without a failure block (shape violation)',
        recovery: 'RETRYABLE',
      });
      return { task_id: node.task_id, worker_status: result.status, outcome: { kind: 'FAILED', failure_kind: 'OPERATION_FAILURE', recovery: 'RETRYABLE' } };
    }

    // COMPLETED_REPORT -> INDEPENDENT VERIFICATION (the verdict gates
    // the COMPLETED transition — a worker report NEVER certifies).
    const verification = await this.verifier.verify({ task_id: node.task_id, worker_result: result });
    if (verification.verdict === 'VERIFIED') {
      assertVerificationGatesCompletion(verification);
      const durableVerification: TaskVerificationRecord = {
        verified: true,
        recorded_at: verification.recorded_at,
        evidence_refs: [...verification.evidence_refs],
        summary: verification.summary,
      };
      const completion = await this.fabric.completeTask(node.task_id, durableVerification);
      if (completion.status === 'DENIED') {
        await this.graph.recordFailure(node.task_id, {
          failure_kind: 'OPERATION_FAILURE',
          reason: `the fabric refused completion: ${completion.denial.reason}`,
          recovery: 'RETRYABLE',
        });
        return { task_id: node.task_id, worker_status: result.status, outcome: { kind: 'FAILED', failure_kind: 'OPERATION_FAILURE', recovery: 'RETRYABLE' } };
      }
      if (completion.status === 'FAILED') {
        await this.graph.recordFailure(node.task_id, {
          failure_kind: 'OPERATION_FAILURE',
          reason: `the fabric's completeTask ran and failed: ${completion.error}`,
          recovery: 'RETRYABLE',
        });
        return { task_id: node.task_id, worker_status: result.status, outcome: { kind: 'FAILED', failure_kind: 'OPERATION_FAILURE', recovery: 'RETRYABLE' } };
      }
      await this.graph.adoptFabricTransition(node.task_id, node);
      await this.graph.recordVerificationRef(node.task_id, verification.verification_id);
      return { task_id: node.task_id, worker_status: result.status, outcome: { kind: 'COMPLETED', verification } };
    }

    // REJECTED — honest failure: verification never fabricates success.
    await this.graph.recordFailure(node.task_id, {
      failure_kind: 'VERIFICATION_REJECTED',
      reason: verification.summary,
      recovery: 'RETRYABLE',
    });
    return { task_id: node.task_id, worker_status: result.status, outcome: { kind: 'FAILED', failure_kind: 'VERIFICATION_REJECTED', recovery: 'RETRYABLE' } };
  }

  /**
   * Capability-based body selection preferring bodies not currently
   * leased; on a RETRY the body of the task's most recent ended lease is
   * preferred first (its body-side session survives — the true
   * resume-from-checkpoint path), with the honest fresh-adoption
   * fallback handled by the worker.
   */
  private async selectBodyForTask(taskId: string | null): Promise<{ body_id: string } | null> {
    const bodies = this.broker.bodies();
    const leases = await this.broker.leaseRepository.list({ limit: null });
    const activeLeases = leases.items.filter((lease) => lease.state === 'ACTIVE');
    const capable = (body: (typeof bodies)[number]): boolean =>
      body.health === 'AVAILABLE' &&
      REFERENCE_BODY_REQUIREMENTS.requiredCapabilities.every((capability) => body.capabilities.capabilities.includes(capability)) &&
      body.placement === REFERENCE_BODY_REQUIREMENTS.placement;
    if (taskId !== null) {
      const taskLeases = await this.broker.leasesForTask(taskId);
      for (let index = taskLeases.length - 1; index >= 0; index -= 1) {
        const lease = taskLeases[index]!;
        if (lease.body_id === null) {
          continue;
        }
        const body = this.broker.body(lease.body_id);
        if (body === undefined || !capable(body)) {
          continue;
        }
        const busyWithOther = activeLeases.some((active) => active.body_id === body.body_id && active.task_ref !== taskId);
        if (!busyWithOther) {
          return { body_id: body.body_id };
        }
      }
    }
    for (const body of bodies) {
      if (!capable(body)) {
        continue;
      }
      const busy = activeLeases.some((lease) => lease.body_id === body.body_id);
      if (!busy) {
        return { body_id: body.body_id };
      }
    }
    // Every capable body is busy — fall back to the broker's own
    // capability-based selection (leases can share a body: sessions are
    // per-task).
    const selection = this.broker.select(REFERENCE_BODY_REQUIREMENTS);
    return selection.status === 'SELECTED' ? { body_id: selection.body.body_id } : null;
  }

  /** Resolve the grants an authority reference currently holds (durable store only). */
  private async resolveGrants(authorityRef: string): Promise<AuthorityGrantArtifact[]> {
    const grant = await this.authorityGrants.get(authorityRef);
    if (grant === undefined) {
      return [];
    }
    const status = evaluateGrant(grant, { kind: 'TIME', now: formatRfc3339(this.clock.nowEpochMs()) });
    return status === 'VALID' ? [grant] : [];
  }

  /** The 0-based dispatch index of a task id within the decomposition plan. */
  private dispatchIndexOf(taskId: string): number {
    if (this.decomposition === null) {
      return -1;
    }
    return this.decomposition.plan.findIndex((planned) => planned.task_id === taskId);
  }

  /** The honest journey report (with explicit simulated markers). */
  private async report(gateRecord: ArchitectGateRecord | null): Promise<JourneyReport> {
    const nodes = await this.graph.nodes();
    const analysis = this.reasoning.analyses()[0] ?? null;
    const reasoning =
      analysis === null
        ? null
        : {
            provider_id: analysis.provenance.provider_id,
            provider_kind: analysis.provenance.provider_kind,
            model: analysis.provenance.model,
            version: analysis.provenance.version,
            simulated: analysis.provenance.simulated,
            analysis_ids: [analysis.analysis_id],
            non_authoritative: true as const,
          };
    const completedCount = nodes.filter((node) => node.state === 'COMPLETED').length;
    const simulatedMarkers: string[] = [];
    if (reasoning !== null && reasoning.simulated) {
      simulatedMarkers.push(`reasoning provider ${reasoning.provider_id} (model ${reasoning.model}) is a SIMULATED reference provider (non-authoritative)`);
    }
    for (const node of nodes) {
      if (node.retries > 0) {
        simulatedMarkers.push(`task ${node.task_id} recovered through ${node.retries} deterministic retry/retries (crash-recovery demonstration)`);
      }
    }
    const asks = this.askQueue.list().map((entry) => ({
      entry_id: entry.id,
      ask_ref: entry.ask.envelope.id,
      status: entry.status,
    }));
    const allCompleted = nodes.length > 0 && nodes.every((node) => node.state === 'COMPLETED');
    const summary = allCompleted
      ? `mission ${this.decomposition?.mission_ref ?? '?'} complete: ${completedCount}/${nodes.length} task(s) VERIFIED-COMPLETED (verification-gated), ${asks.length} ask(s) escalated first-class, ${gateRecord === null ? 'architect gate: not yet requested' : `architect gate ${gateRecord.gate_id} APPROVED`}`
      : `mission ${this.decomposition?.mission_ref ?? '?'} incomplete: ${nodes.map((node) => `${node.task_id}:${node.state}`).join(', ')} — honest state, never silently done`;
    return {
      mission_ref: this.decomposition?.mission_ref ?? '',
      authority_ref: this.decomposition?.authority_ref ?? '',
      decomposition_id: this.decomposition?.decomposition_id ?? '',
      ticks: this.tickLog.map((tick) => ({ ...tick, dispatched: [...tick.dispatched], denials: [...tick.denials], ingested: [...tick.ingested], recovered: [...tick.recovered] })),
      tasks: nodes.map((node) => ({
        task_id: node.task_id,
        title: node.title,
        state: node.state,
        retries: node.retries,
        verification_ref: node.verification_ref,
        workspace_revision: { ...node.workspace_revision },
        uncertainty: [...node.unresolved_uncertainty],
      })),
      asks,
      gate: gateRecord === null ? null : { ...gateRecord },
      reasoning,
      simulated_markers: simulatedMarkers,
      completed: allCompleted,
      summary,
    };
  }
}

/** The first free lane (1..3), or null when all are occupied. */
function nextFreeLane(activeLanes: ReadonlySet<number>): 1 | 2 | 3 | null {
  if (!activeLanes.has(1)) {
    return 1;
  }
  if (!activeLanes.has(2)) {
    return 2;
  }
  if (!activeLanes.has(3)) {
    return 3;
  }
  return null;
}

/** Are all of a node's dependencies COMPLETED? */
async function dependenciesCompleted(graph: TaskGraph, node: TaskNode): Promise<boolean> {
  for (const dependency of node.dependencies) {
    const dependencyNode = await graph.node(dependency);
    if (dependencyNode === undefined || dependencyNode.state !== 'COMPLETED') {
      return false;
    }
  }
  return true;
}
