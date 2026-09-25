/**
 * THE FLAGSHIP AUTONOMOUS-BUILD JOURNEY (Work Order P15, lane B) — the P13
 * §11 greenfield flagship driven end-to-end as PRODUCT DOGFOOD: an empty
 * GitHub repository becomes a fully implemented, deployed, evidence-backed
 * system with NO user tick after kick-off.
 *
 *   mission -> connected repo (reference adapter) -> authority approved ->
 *   pipeline -> task graph -> cloud bodies (reference) -> implementation ->
 *   independent evaluation -> commit/PR/push (reference executors) ->
 *   deployment (reference) -> runtime verification -> evidence-backed
 *   completion.
 *
 * The completion of the flagship journey is gated ONLY by the independent
 * evaluation suite — never by the acting body's opinion (pinned below).
 */

import { describe, expect, it } from 'vitest';
import { WORLD_BASE_SHA } from '@sos-2/action-gateway';
import {
  CompletionCertifier,
  GREENFIELD_JOURNEY_STAGES,
  actingBodyIdFor,
  recomputeCompletionId,
} from '@sos-2/greenfield-runtime';
import { EvaluationOrchestrator } from '@sos-2/evaluation-orchestration';
import { EvaluatorRegistry, IndependentEvaluationService, ScriptedReferenceProbe } from '@sos-2/evaluator';
import { ReferenceArchitecturePlanner, ReferenceMissionFormalizer } from '@sos-2/implementation-orchestrator';
import type { ImplementationPlan } from '@sos-2/implementation-orchestrator';
import { formatRfc3339 } from '@sos-2/live-store';
import {
  DEFAULT_RAW_MISSION,
  DOGFOOD_T0,
  EMPTY_REPOSITORY_SLUG,
  FLAGSHIP_JOURNEY_ID,
  createDogfoodWorld,
  driveOnCloudTicks,
  startFlagshipJourney,
} from './world.js';
import type { DogfoodWorld } from './world.js';

const ACTING_BODY = { kind: 'body' as const, id: actingBodyIdFor(FLAGSHIP_JOURNEY_ID) };
const SYSTEM = { kind: 'system' as const, id: 'greenfield-runtime' };

/** Run the complete flagship journey on a fresh world. */
async function runFlagshipJourney(): Promise<DogfoodWorld> {
  const world = createDogfoodWorld();
  await startFlagshipJourney(world);
  await driveOnCloudTicks(world);
  return world;
}

/** The reference plan of the default mission (deterministic derivation for assertions). */
function referencePlanOf(): ImplementationPlan {
  const formalizer = new ReferenceMissionFormalizer({ createdAt: formatRfc3339(DOGFOOD_T0) });
  const formalized = formalizer.formalize(DEFAULT_RAW_MISSION);
  if (formalized.kind !== 'FORMALIZED') throw new Error('unreachable: the default mission formalizes');
  const planner = new ReferenceArchitecturePlanner({ createdAt: formatRfc3339(DOGFOOD_T0) });
  const planned = planner.plan({ mission: formalized.mission });
  if (planned.kind !== 'PLANNED') throw new Error('unreachable: the default mission plans');
  return planned.plan;
}

describe('P15 lane-B flagship journey (§11 end-to-end, autonomous)', () => {
  it('completes the full §11 chain with NO user-online tick after kick-off (device-optional)', async () => {
    const world = await runFlagshipJourney();
    const state = world.journey.state();

    expect(state.stage).toBe('COMPLETED');
    expect(state.status).toBe('COMPLETED');
    expect(state.pendingAsk).toBeNull();

    // The user device was offline for EVERY cloud tick (the §7 pin).
    const ticks = world.journey.ticks();
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.userDeviceOnline).toBe(false);
    }

    // The §11 stages all ran, in contract order.
    const entered = state.transitions.map((transition) => transition.to);
    expect(entered).toEqual(GREENFIELD_JOURNEY_STAGES);

    // Every body the journey leased is a CLOUD body (the dogfood pool).
    const report = world.journey.completionReport();
    expect(report).not.toBeNull();
    expect(report!.tasks.length).toBeGreaterThan(0);
    for (const task of report!.tasks) {
      expect(task.bodyId, `task ${task.taskId} ran on a cloud body`).toMatch(/^p15b-cloud-body-\d+$/);
    }
  });

  it('completion is gated ONLY by the independent evaluation suite — the acting body NEVER certifies', async () => {
    const world = await runFlagshipJourney();

    // The journey issued evaluation requests, ALL of them system-requested
    // (the pipeline requests; the independent evaluator decides).
    expect(world.evaluationRequests.length).toBeGreaterThan(0);
    for (const request of world.evaluationRequests) {
      expect(request.requestedBy.kind, `${request.type} must be requested by the system actor`).toBe('system');
      expect(request.requestedBy.id).toBe('greenfield-runtime');
      expect(request.producedBy.kind).toBe('body');
    }

    // The completion report records the requester as the system actor.
    const report = world.journey.completionReport()!;
    expect(report.certifiedUponRequestBy).toEqual(SYSTEM);
    expect(report.producedBy).toEqual(ACTING_BODY);
    expect(report.certifiedUponRequestBy.id).not.toBe(report.producedBy.id);
  });

  it('the acting body CANNOT certify its own output: typed independence denial, the probe never runs', () => {
    // The acting body requests certification of its OWN output from a probe
    // bound to itself: denied BEFORE any probe runs (typed violation).
    const probe = new ScriptedReferenceProbe({ evaluatorId: 'p15b-eval-tests', type: 'tests', boundActor: ACTING_BODY });
    const service = new IndependentEvaluationService(new EvaluatorRegistry().register(probe), { now: () => DOGFOOD_T0 });
    const certifier = new CompletionCertifier({ orchestration: new EvaluationOrchestrator(service, { now: () => DOGFOOD_T0 }), clock: { now: () => DOGFOOD_T0 } });

    const outcome = certifier.request({
      requirements: ['tests'],
      target: { sourceRevision: 'source:p15b-independence-fixture', deploymentRevision: null, producedBy: ACTING_BODY },
      requestedBy: ACTING_BODY,
      family: 'commit',
      mission: null,
    });

    expect(outcome.kind).toBe('INDEPENDENCE_DENIED');
    if (outcome.kind !== 'INDEPENDENCE_DENIED') throw new Error('unreachable');
    expect(outcome.denial.code).toBe('EVALUATION_INDEPENDENCE');
    expect(probe.observations).toHaveLength(0);
    expect(outcome.certificationId).toBeNull();
  });

  it('a journey whose runtime verifier is bound to the acting body parks with a typed ask and NEVER completes', async () => {
    const world = createDogfoodWorld({ probes: { bindToActingBody: ['runtime-verification'] } });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // The implementation and deployment proceeded; the RUNTIME VERIFICATION
    // was refused on independence — no completion was fabricated.
    expect(state.stage).toBe('DEPLOYED');
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk).not.toBeNull();
    expect(state.pendingAsk!.stage).toBe('COMPLETION');
    expect(state.pendingAsk!.reasonCode).toBe('RUNTIME_VERIFICATION_NOT_PASSED');
    expect(state.pendingAsk!.detail).toContain('independence');
    expect(world.journey.completionReport()).toBeNull();
  });

  it('exact-revision links across repository, runtime, deployment and the evidence graph', async () => {
    const world = await runFlagshipJourney();
    const report = world.journey.completionReport()!;
    const branch = `sos/mission-${world.journey.journeyId}`;
    const head = report.sourceRevisions.workspaceHead;

    // Repository: the workspace commit chain reached the reported head, from the imported base.
    expect(head).toMatch(/^source:[0-9a-f]+$/);
    expect(head).not.toBe(WORLD_BASE_SHA);
    expect(world.gatewayWorld.heads.get('workspace')).toBe(head);
    expect(report.sourceRevisions.importedBase).toMatchObject({ repository: { owner: 'acme', name: 'empty-repo' } });
    const plan = referencePlanOf();
    expect(report.sourceRevisions.commits.map((commit) => commit.taskId).sort()).toEqual(
      plan.components.map((component) => `p13-${component.id}`).sort(),
    );
    for (const commit of report.sourceRevisions.commits) {
      expect(commit.sha).toMatch(/^source:[0-9a-f]+$/);
    }

    // Push + pull request target the implementation branch with the exact final revision.
    expect(world.gatewayWorld.pushes).toEqual([{ remote: `github.com/${EMPTY_REPOSITORY_SLUG}`, ref: branch, sha: head }]);
    expect(world.gatewayWorld.pullRequests).toHaveLength(1);
    expect(world.gatewayWorld.pullRequests[0]).toMatchObject({ headBranch: branch, baseBranch: 'main' });
    expect(report.sourceRevisions.pullRequest).toMatchObject({ headBranch: branch, baseBranch: 'main' });

    // Deployment: ACTIVE at the exact final revision.
    const deployment = world.gatewayWorld.deployments.get(report.sourceRevisions.deployment!.deploymentId);
    expect(deployment).toMatchObject({ environment: 'production', sourceSha: head, status: 'ACTIVE' });

    // Evidence graph: every verdict targets the exact final revision; the
    // assurance constraints of the plan are all covered.
    const requiredTypes = new Set(plan.assuranceConstraints.map((constraint) => constraint.evaluationType));
    expect(report.evaluation.passed).toBe(requiredTypes.size);
    expect(report.evaluation.failed).toBe(0);
    expect(report.evaluation.unknown).toBe(0);
    expect(report.evaluation.verdictRefs.length).toBe(requiredTypes.size);
    for (const ref of report.evaluation.verdictRefs) {
      expect(ref.targetSourceRevision).toBe(head);
    }

    // Every consequential action went through the P9 gateway with
    // action-time authority re-evaluation and evidence emission.
    const families = new Set(world.actionEvents.entries().map((event) => event.family));
    expect(families).toContain('commit');
    expect(families).toContain('push');
    expect(families).toContain('pull-request');
    expect(families).toContain('deployment');
    for (const event of world.actionEvents.entries()) {
      expect(event.type).toBe('action.succeeded');
    }
    expect(world.authority.evaluations.length).toBeGreaterThanOrEqual(world.actionEvents.entries().length);
    for (const evaluation of world.authority.evaluations) {
      expect(evaluation.snapshot.reason).toBe('GRANTED');
    }
    expect(world.evidence.all().length).toBeGreaterThanOrEqual(world.actionEvents.entries().length);
  });

  it('all unresolved uncertainty stays visible (honest reference-mode markers, provider statuses)', async () => {
    const world = await runFlagshipJourney();
    const report = world.journey.completionReport()!;
    expect(report.remainingUncertainty.length).toBeGreaterThan(0);
    expect(report.remainingUncertainty.some((entry) => entry.includes('SIMULATED'))).toBe(true);
    expect(report.remainingUncertainty.some((entry) => entry.includes('reference mode'))).toBe(true);
    expect(report.providerStatuses.map((status) => status.name).join('\n')).toContain('github-adapter');
  });

  it('every task node carries the mission + authority references and a verified final record', async () => {
    const world = await runFlagshipJourney();
    const state = world.journey.state();
    const nodes = await world.graph.nodes();
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.mission_ref).toBe(state.mission!.envelope.id);
      expect(node.authority_ref).toBe(state.authorityGrantId);
      expect(node.state).toBe('COMPLETED');
      expect(node.verification_ref).not.toBeNull();
      const record = await world.store.tasks.get(node.task_id);
      expect(record!.status).toBe('COMPLETED');
      expect(record!.final_verification!.verified).toBe(true);
    }
  });

  it('the completion record reproduces bit-exactly (content-addressed, run-to-run identical)', async () => {
    const world = await runFlagshipJourney();
    const report = world.journey.completionReport()!;
    expect(recomputeCompletionId(report)).toBe(report.completionId);
    expect(world.journey.reproducedCompletionId()).toBe(report.completionId);

    // A SECOND, identical journey (fresh world, identical inputs) reproduces
    // the identical completion record and tick log — offline determinism.
    const second = await runFlagshipJourney();
    const secondReport = second.journey.completionReport()!;
    expect(secondReport).toEqual(report);
    expect(secondReport.completionId).toBe(report.completionId);
    expect(second.journey.ticks()).toEqual(world.journey.ticks());
  });

  it('the task + evidence timeline is observed (durable, replayable, §11-ordered)', async () => {
    const world = await runFlagshipJourney();
    const journeyEvents = await world.journey.timeline();
    const timeline = await world.journey.evidenceTimeline();

    // The journey's own stage events appear in §11 order.
    const stageKinds = journeyEvents.filter((event) => event.kind.startsWith('journey.')).map((event) => event.kind);
    for (const expected of [
      'journey.mission-received',
      'journey.repository-connected',
      'journey.authority-approved',
      'journey.mission-formalized',
      'journey.plan-prepared',
      'journey.graph-built',
      'journey.node-dispatched',
      'journey.node-completed',
      'journey.implemented',
      'journey.change-realized',
      'journey.deployed',
      'journey.runtime-verified',
      'journey.completed',
    ]) {
      expect(stageKinds, `timeline must contain ${expected}`).toContain(expected);
    }
    const ordered = [
      'journey.mission-received',
      'journey.repository-connected',
      'journey.authority-approved',
      'journey.mission-formalized',
      'journey.plan-prepared',
      'journey.graph-built',
      'journey.change-realized',
      'journey.deployed',
      'journey.completed',
    ];
    let cursor = -1;
    for (const event of journeyEvents) {
      const index = ordered.indexOf(event.kind);
      if (index === -1) continue;
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }

    // The combined timeline includes the task-graph and fabric events of
    // the journey's tasks, and the body's NON-AUTHORITATIVE completion
    // report stays in the durable trace.
    expect(timeline.filter((event) => event.eventId.startsWith('graph-obs:')).length).toBeGreaterThan(0);
    expect(timeline.filter((event) => event.eventId.startsWith('fabric-obs:')).length).toBeGreaterThan(0);
    expect(timeline.some((event) => event.kind === 'task.body-completion-report')).toBe(true);
    for (const event of timeline) {
      expect(event.eventId.length).toBeGreaterThan(0);
      expect(event.provenance.length).toBeGreaterThan(0);
      expect(event.occurredAt).toMatch(/^\d{4}-/);
    }
  });
});
