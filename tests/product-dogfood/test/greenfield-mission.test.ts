/**
 * THE GREENFIELD FLAGSHIP JOURNEY (P15 Lane A — first-time greenfield
 * mission). Drives the full §11 mission-to-implementation journey
 * end-to-end as a USER would: mission statement -> connected empty
 * GitHub repository (reference adapter) -> typed authority grant ->
 * pipeline runs on CLOUD ticks without any user-online tick after
 * kick-off (the §7 device-optional pin) -> task + evidence timeline
 * observed -> repository contains the implemented system (reference
 * executors) -> exact source revisions + evaluation results +
 * remaining uncertainty visible -> completion record reproduces
 * bit-exactly.
 *
 * The journey asserts the P15 acceptance shape:
 *   (a) composition: every consequential product surface composed
 *       behind reference adapters — no real GitHub, no real providers,
 *       no real deployment targets.
 *   (b) terminal state: COMPLETED.
 *   (c) evidence graph: every consequential artifact carries an exact
 *       revision link (workspace head, per-task commits, push, PR,
 *       deployment, evaluation verdict refs).
 *   (d) retained uncertainty: VISIBLE (SIMULATED markers, reference-mode
 *       notes, provider-status honesty) — never a fabricated HEALTHY.
 */

import { describe, expect, it } from 'vitest';
import { contentAddress, WORLD_BASE_SHA } from '@sos-2/action-gateway';
import { GREENFIELD_JOURNEY_STAGES, recomputeCompletionId } from '@sos-2/greenfield-runtime';
import { ReferenceArchitecturePlanner, ReferenceMissionFormalizer, SCAFFOLD_COMPONENT_ID } from '@sos-2/implementation-orchestrator';
import type { ImplementationPlan } from '@sos-2/implementation-orchestrator';
import { formatRfc3339 } from '@sos-2/live-store';
import {
  DEFAULT_RAW_MISSION,
  EMPTY_REPOSITORY_SLUG,
  VITEST_SEED,
  WORLD_T0,
  createProductDogfoodWorld,
  driveOnCloudTicks,
  startFlagshipJourney,
} from './world.js';
import type { ProductDogfoodWorld } from './world.js';

/** Run the complete flagship journey on a fresh world. */
async function runFlagshipJourney(): Promise<ProductDogfoodWorld> {
  const world = createProductDogfoodWorld();
  await startFlagshipJourney(world);
  await driveOnCloudTicks(world);
  return world;
}

/** The reference plan of the default mission (deterministic derivation for revision precomputation). */
function referencePlanOf(_world: ProductDogfoodWorld): ImplementationPlan {
  const formalizer = new ReferenceMissionFormalizer({ createdAt: formatRfc3339(WORLD_T0) });
  const formalized = formalizer.formalize(DEFAULT_RAW_MISSION);
  if (formalized.kind !== 'FORMALIZED') throw new Error('unreachable: the default mission formalizes');
  const planner = new ReferenceArchitecturePlanner({ createdAt: formatRfc3339(WORLD_T0) });
  const planned = planner.plan({ mission: formalized.mission });
  if (planned.kind !== 'PLANNED') throw new Error('unreachable: the default mission plans');
  return planned.plan;
}

describe('P15 Lane A — first-time greenfield mission (§11 end-to-end)', () => {
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

    // Every body the journey leased is a CLOUD body (the user's computer was offline).
    const report = world.journey.completionReport();
    expect(report).not.toBeNull();
    for (const task of report!.tasks) {
      expect(task.bodyId, `task ${task.taskId} ran on a cloud body`).toMatch(/^p15-cloud-body-\d+$/);
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

    // Gateway action events cover every consequential family the journey used.
    const families = new Set(world.actionEvents.entries().map((event) => event.family));
    expect(families).toContain('commit');
    expect(families).toContain('push');
    expect(families).toContain('pull-request');
    expect(families).toContain('deployment');
    for (const event of world.actionEvents.entries()) {
      expect(event.type).toBe('action.succeeded');
    }

    // Action-time authority was actually re-evaluated for every action.
    expect(world.authority.evaluations.length).toBeGreaterThanOrEqual(world.actionEvents.entries().length);
    for (const evaluation of world.authority.evaluations) {
      expect(evaluation.snapshot.reason).toBe('GRANTED');
    }

    // Evidence was emitted for every action outcome (the evidence chain).
    expect(world.evidence.all().length).toBeGreaterThanOrEqual(world.actionEvents.entries().length);
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

    // Remaining uncertainty is retained honestly (reference-mode markers — never fabricated HEALTHY).
    expect(report.remainingUncertainty.some((entry) => entry.includes('SIMULATED'))).toBe(true);
    expect(report.remainingUncertainty.some((entry) => entry.includes('reference mode'))).toBe(true);

    // The certification was requested by the PIPELINE (system), produced by the body — never the reverse.
    expect(report.certifiedUponRequestBy.kind).toBe('system');
    expect(report.producedBy.kind).toBe('body');
    expect(report.producedBy.id).not.toBe(report.certifiedUponRequestBy.id);

    // Honest provider statuses ride along.
    expect(report.providerStatuses.map((status) => status.name).join('\n')).toContain('github-adapter');
  });

  it('the completion record reproduces bit-exactly (content-addressed) — run-to-run identical (determinism)', async () => {
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

  it('the fixed vitest seed is configured (the repository convention)', async () => {
    expect(VITEST_SEED).toBe(424242);
  });
});
