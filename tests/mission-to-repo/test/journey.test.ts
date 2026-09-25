/**
 * THE FLAGSHIP JOURNEY ACCEPTANCE SUITE (Work Order P13) — the full §11
 * greenfield journey, deterministically simulated end-to-end:
 *
 *   mission -> connected empty GitHub repository (reference adapter) ->
 *   typed authority grant -> the pipeline runs on CLOUD ticks WITHOUT
 *   any user-online tick after kick-off -> task + evidence timeline
 *   observed -> the repository contains the implemented system
 *   (reference executors) -> exact source revisions + evaluation results
 *   + remaining uncertainty visible -> the completion record reproduces.
 */

import { describe, expect, it } from 'vitest';
import { contentAddress, WORLD_BASE_SHA } from '@sos-2/action-gateway';
import { GREENFIELD_JOURNEY_STAGES } from '@sos-2/greenfield-runtime';
import { recomputeCompletionId } from '@sos-2/greenfield-runtime';
import { ReferenceArchitecturePlanner, ReferenceMissionFormalizer, SCAFFOLD_COMPONENT_ID } from '@sos-2/implementation-orchestrator';
import type { ImplementationPlan } from '@sos-2/implementation-orchestrator';
import { DEFAULT_RAW_MISSION, EMPTY_REPOSITORY_SLUG, WORLD_T0, createAcceptanceWorld, driveOnCloudTicks, startFlagshipJourney } from './world.js';
import type { AcceptanceWorld } from './world.js';
import { formatRfc3339 } from '@sos-2/live-store';

/** Run the complete flagship journey on a fresh world. */
async function runFlagshipJourney(): Promise<AcceptanceWorld> {
  const world = createAcceptanceWorld();
  await startFlagshipJourney(world);
  await driveOnCloudTicks(world);
  return world;
}

/** The reference plan of the default mission (deterministic derivation for revision precomputation). */
function referencePlanOf(world: AcceptanceWorld): ImplementationPlan {
  const formalizer = new ReferenceMissionFormalizer({ createdAt: formatRfc3339(WORLD_T0) });
  const formalized = formalizer.formalize(DEFAULT_RAW_MISSION);
  if (formalized.kind !== 'FORMALIZED') throw new Error('unreachable: the default mission formalizes');
  const planner = new ReferenceArchitecturePlanner({ createdAt: formatRfc3339(WORLD_T0) });
  const planned = planner.plan({ mission: formalized.mission });
  if (planned.kind !== 'PLANNED') throw new Error('unreachable: the default mission plans');
  void world;
  return planned.plan;
}

describe('P13 flagship journey (§11 end-to-end)', () => {
  it('completes the full journey without any user-online tick after kick-off (device-optional)', async () => {
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
    for (const stage of GREENFIELD_JOURNEY_STAGES) {
      expect(entered, `stage ${stage} must be entered`).toContain(stage);
    }
    expect(entered).toEqual(GREENFIELD_JOURNEY_STAGES);

    // Every body the journey leased is a CLOUD body.
    const report = world.journey.completionReport();
    expect(report).not.toBeNull();
    for (const task of report!.tasks) {
      expect(task.bodyId, `task ${task.taskId} ran on a cloud body`).toMatch(/^p13-cloud-body-\d+$/);
    }
  });

  it('the repository contains the implemented system (commits, push, pull request, deployment — reference executors)', async () => {
    const world = await runFlagshipJourney();
    const report = world.journey.completionReport()!;
    const branch = `sos/mission-${world.journey.journeyId}`;

    // The workspace commit chain reached the reported head.
    expect(world.gatewayWorld.heads.get('workspace')).toBe(report.sourceRevisions.workspaceHead);
    expect(report.sourceRevisions.workspaceHead).not.toBe(WORLD_BASE_SHA);

    // Every planned component landed as a commit (scaffold + one per mission goal).
    const plan = referencePlanOf(world);
    expect(report.sourceRevisions.commits.map((commit) => commit.taskId).sort()).toEqual(
      plan.components.map((component) => `p13-${component.id}`).sort(),
    );

    // The implementation branch was pushed with the exact final revision.
    expect(world.gatewayWorld.pushes).toEqual([{ remote: `github.com/${EMPTY_REPOSITORY_SLUG}`, ref: branch, sha: report.sourceRevisions.workspaceHead }]);

    // The pull request targets the default branch from the implementation branch.
    expect(world.gatewayWorld.pullRequests).toHaveLength(1);
    expect(world.gatewayWorld.pullRequests[0]).toMatchObject({ headBranch: branch, baseBranch: 'main' });
    expect(report.sourceRevisions.pullRequest).toMatchObject({ headBranch: branch, baseBranch: 'main' });

    // The deployment is ACTIVE at the exact final revision.
    const deployment = world.gatewayWorld.deployments.get(report.sourceRevisions.deployment!.deploymentId);
    expect(deployment).toMatchObject({ environment: 'production', sourceSha: report.sourceRevisions.workspaceHead, status: 'ACTIVE' });
  });

  it('every consequential action went through the P9 gateway with action-time authority re-evaluation', async () => {
    const world = await runFlagshipJourney();
    const report = world.journey.completionReport()!;

    // Gateway action events cover every consequential family the journey used.
    const families = new Set(world.actionEvents.entries().map((event) => event.family));
    expect(families).toContain('commit');
    expect(families).toContain('push');
    expect(families).toContain('pull-request');
    expect(families).toContain('deployment');
    for (const event of world.actionEvents.entries()) {
      expect(event.type).toBe('action.succeeded');
    }

    // The executor seam saw the typed operations (git.commit per task + repair-free happy path).
    const commits = world.executor.calls.filter((call) => call.operation.op === 'git.commit');
    expect(commits.length).toBe(report.sourceRevisions.commits.length);

    // Action-time authority was actually re-evaluated for every action.
    expect(world.authority.evaluations.length).toBeGreaterThanOrEqual(world.actionEvents.entries().length);
    for (const evaluation of world.authority.evaluations) {
      expect(evaluation.snapshot.reason).toBe('GRANTED');
    }

    // Evidence was emitted for every action outcome (the evidence chain).
    expect(world.evidence.all().length).toBeGreaterThanOrEqual(world.actionEvents.entries().length);
  });

  it('every task node carries the mission and authority references (the P6 pin)', async () => {
    const world = await runFlagshipJourney();
    const state = world.journey.state();
    const nodes = await world.graph.nodes();
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.mission_ref).toBe(state.mission!.envelope.id);
      expect(node.authority_ref).toBe(state.authorityGrantId);
      expect(node.state).toBe('COMPLETED');
      expect(node.verification_ref).not.toBeNull();
    }
    // The durable records say the same (AWAITING_INPUT/QUEUED never linger).
    for (const node of nodes) {
      const record = await world.store.tasks.get(node.task_id);
      expect(record!.status).toBe('COMPLETED');
      expect(record!.final_verification!.verified).toBe(true);
    }
  });

  it('exact source revisions, evaluation results and remaining uncertainty are visible in the report', async () => {
    const world = await runFlagshipJourney();
    const report = world.journey.completionReport()!;

    // Exact revisions: workspace head, per-task commits, push, PR, deployment, imported base.
    expect(report.sourceRevisions.workspaceHead).toMatch(/^source:[0-9a-f]+$/);
    expect(report.sourceRevisions.importedBase).toMatchObject({ repository: { owner: 'acme', name: 'empty-repo' } });
    for (const commit of report.sourceRevisions.commits) {
      expect(commit.sha).toMatch(/^source:[0-9a-f]+$/);
    }

    // Evaluation results: every assurance constraint's evaluator passed, verdicts referenced.
    const plan = referencePlanOf(world);
    const requiredTypes = new Set(plan.assuranceConstraints.map((constraint) => constraint.evaluationType));
    expect(report.evaluation.passed).toBe(requiredTypes.size);
    expect(report.evaluation.failed).toBe(0);
    expect(report.evaluation.unknown).toBe(0);
    expect(report.evaluation.verdictRefs.length).toBe(requiredTypes.size);
    for (const ref of report.evaluation.verdictRefs) {
      expect(ref.targetSourceRevision).toBe(report.sourceRevisions.workspaceHead);
    }

    // Remaining uncertainty is retained honestly (reference-mode markers).
    expect(report.remainingUncertainty.some((entry) => entry.includes('SIMULATED'))).toBe(true);
    expect(report.remainingUncertainty.some((entry) => entry.includes('reference mode'))).toBe(true);

    // The certification was requested by the PIPELINE (system), produced by the body — never the reverse.
    expect(report.certifiedUponRequestBy.kind).toBe('system');
    expect(report.producedBy.kind).toBe('body');
    expect(report.producedBy.id).not.toBe(report.certifiedUponRequestBy.id);

    // Honest provider statuses ride along.
    expect(report.providerStatuses.map((status) => status.name).join('\n')).toContain('github-adapter');
  });

  it('the completion record reproduces bit-exactly (content-addressed)', async () => {
    const world = await runFlagshipJourney();
    const report = world.journey.completionReport()!;
    expect(recomputeCompletionId(report)).toBe(report.completionId);
    expect(world.journey.reproducedCompletionId()).toBe(report.completionId);

    // A SECOND, identical journey (fresh world, identical inputs) reproduces
    // the identical completion record — the §11 reproducibility pin.
    const second = await runFlagshipJourney();
    const secondReport = second.journey.completionReport()!;
    expect(secondReport).toEqual(report);
    expect(secondReport.completionId).toBe(report.completionId);

    // And the tick logs are identical (determinism end-to-end).
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

    // The combined timeline includes the task-graph and fabric events of the journey's tasks.
    const graphEvents = timeline.filter((event) => event.eventId.startsWith('graph-obs:'));
    const fabricEvents = timeline.filter((event) => event.eventId.startsWith('fabric-obs:'));
    expect(graphEvents.length).toBeGreaterThan(0);
    expect(fabricEvents.length).toBeGreaterThan(0);
    // The body's non-authoritative completion report is in the durable trace.
    expect(fabricEvents.some((event) => event.kind === 'task.body-completion-report')).toBe(true);

    // Every event carries the replayable shape (id, kind, instants, provenance).
    for (const event of timeline) {
      expect(event.eventId.length).toBeGreaterThan(0);
      expect(event.provenance.length).toBeGreaterThan(0);
      expect(event.occurredAt).toMatch(/^\d{4}-/);
    }
  });

  it('the scaffold component provisions the workspace before the goal components (dependency-gated)', async () => {
    const world = await runFlagshipJourney();
    const plan = referencePlanOf(world);
    const scaffold = plan.components.find((component) => component.id === SCAFFOLD_COMPONENT_ID)!;
    const expectedScaffoldSha = contentAddress(
      { repo: 'workspace', baseSha: WORLD_BASE_SHA, changes: scaffold.files.map((file) => ({ path: file.path, contents: file.contents })) },
      'source',
    );
    // The first realized commit is the scaffold at the expected content address.
    const state = world.journey.state();
    expect(state.realizedCommits[0]).toMatchObject({ taskId: `p13-${SCAFFOLD_COMPONENT_ID}`, sha: expectedScaffoldSha });
    // The workspace head advanced beyond the scaffold (goal components landed after it).
    expect(state.realizedCommits.length).toBe(plan.components.length);
  });
});
