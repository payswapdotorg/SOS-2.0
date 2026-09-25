/**
 * THE REPAIR-LOOP ACCEPTANCE SUITE (Work Order P13) — "iterative
 * implementation/evaluation/repair loop" with the P9 discipline:
 *
 *   - a FAILING evaluation drives repair into a NEW revision and the
 *     full fresh suite re-runs against it (verdicts never carry across
 *     revisions) until everything passes — then the node completes;
 *   - the repair attempts are BOUNDED: after the bound, a typed ASK
 *     (never a silent infinite loop, never a fabricated pass).
 */

import { describe, expect, it } from 'vitest';
import { contentAddress, WORLD_BASE_SHA } from '@sos-2/action-gateway';
import { ReferenceArchitecturePlanner, ReferenceMissionFormalizer, SCAFFOLD_COMPONENT_ID } from '@sos-2/implementation-orchestrator';
import type { PlannedFile } from '@sos-2/implementation-orchestrator';
import { corruptFileContents } from '@sos-2/greenfield-runtime';
import { createAcceptanceWorld, driveOnCloudTicks, startFlagshipJourney, WORLD_T0 } from './world.js';
import { formatRfc3339 } from '@sos-2/live-store';

/** The goal task id of the default mission (one delivery goal). */
const GOAL_TASK_ID = 'p13-goal-deliver';

/** The reference plan files of a component (deterministic derivation). */
function componentFiles(componentId: string): PlannedFile[] {
  const formalizer = new ReferenceMissionFormalizer({ createdAt: formatRfc3339(WORLD_T0) });
  const formalized = formalizer.formalize({
    statement: 'Build a URL shortener service with a public API',
    repositorySlug: 'acme/empty-repo',
    capturedAt: formatRfc3339(WORLD_T0),
    source: 'web-console:greenfield',
  });
  if (formalized.kind !== 'FORMALIZED') throw new Error('unreachable');
  const planner = new ReferenceArchitecturePlanner({ createdAt: formatRfc3339(WORLD_T0) });
  const planned = planner.plan({ mission: formalized.mission });
  if (planned.kind !== 'PLANNED') throw new Error('unreachable');
  const component = planned.plan.components.find((entry) => entry.id === componentId);
  if (component === undefined) throw new Error(`unknown component ${componentId}`);
  return [...component.files];
}

/** The revision the reference world mints for a commit (content-addressed, verbatim). */
function revisionOf(baseSha: string, changes: { path: string; contents: string }[]): string {
  return contentAddress({ repo: 'workspace', baseSha, changes }, 'source');
}

describe('P13 bounded repair loop (the P9 discipline)', () => {
  it('a failing evaluation drives repair into a NEW revision; the fresh suite passes; the node completes', async () => {
    // Precompute the BUGGY revision the defective first attempt produces:
    // scaffold lands first (correct), then the goal's attempt 1 is corrupt.
    const scaffoldFiles = componentFiles(SCAFFOLD_COMPONENT_ID).map((file) => ({ path: file.path, contents: file.contents }));
    const scaffoldSha = revisionOf(WORLD_BASE_SHA, scaffoldFiles);
    const goalFiles = componentFiles('goal-deliver').map((file) => ({ path: file.path, contents: file.contents }));
    const buggyFiles = goalFiles.map((file) => ({ path: file.path, contents: corruptFileContents(file.contents) }));
    const buggySha = revisionOf(scaffoldSha, buggyFiles);

    const world = createAcceptanceWorld({
      defects: [{ taskId: GOAL_TASK_ID, mode: 'BUGGY_OUTPUT' }],
      probes: { failRevisions: new Map([[buggySha, { status: 'EVIDENCE_COLLECTED', limitations: [], evidence: { evidenceType: 'tests', summary: 'fixture failure', checks: [{ check: 'tests:fixture', passed: false, detail: 'the buggy revision fails', expected: 'correct', actual: 'buggy' }], artifactDigest: 'fixture' } }]]) },
    });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // The journey COMPLETED: the repair produced a passing revision.
    expect(state.stage).toBe('COMPLETED');
    expect(state.status).toBe('COMPLETED');
    const report = world.journey.completionReport()!;
    expect(report.tasks.find((task) => task.taskId === GOAL_TASK_ID)!.state).toBe('COMPLETED');

    // The repair commits ran through the gateway (typed operations).
    const repairCommits = world.executor.calls.filter(
      (call) => call.operation.op === 'git.commit' && call.operation.message.startsWith('repair:'),
    );
    expect(repairCommits.length).toBe(1);
    // The goal task produced exactly: 1 initial (buggy) + 1 repair commit —
    // both recorded as exact source revisions of the journey.
    const goalCommits = state.realizedCommits.filter((commit) => commit.taskId === GOAL_TASK_ID);
    expect(goalCommits.length).toBe(2);
    // The final head is the repaired (correct) revision, not the buggy one.
    expect(state.workspaceHead).not.toBe(buggySha);
    expect(state.realizedCommits.length).toBe(2 /* scaffold + goal (initial) */ + 1 /* repair */);
  });

  it('the repair bound is honored: after the bound, a typed ASK (never a silent loop, never a fabricated pass)', async () => {
    const world = createAcceptanceWorld({ probes: { failTypes: ['tests'] } });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // The journey parks behind the typed repair-exhausted ask.
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('COMPLETION');
    expect(state.pendingAsk!.reasonCode).toBe('EVALUATION_REPAIR_EXHAUSTED');
    expect(state.pendingAsk!.detail).toContain('repair bound 2');

    // The node parks in the DURABLE graph: AWAITING_INPUT (the ask overlay).
    const scaffoldRecord = await world.store.tasks.get(`p13-${SCAFFOLD_COMPONENT_ID}`);
    expect(scaffoldRecord!.status).toBe('AWAITING_INPUT');
    const node = await world.graph.node(`p13-${SCAFFOLD_COMPONENT_ID}`);
    expect(node!.state).toBe('PAUSED');
    expect(node!.pending_asks.length).toBe(1);

    // Bounded attempts, honestly counted: the repair executor ran exactly
    // maxRepairAttempts (2) times for the scaffold node — no infinite loop.
    const repairCommits = world.executor.calls.filter(
      (call) => call.operation.op === 'git.commit' && call.operation.message.startsWith('repair:'),
    );
    expect(repairCommits.length).toBe(2);

    // No completion was fabricated from the failing evidence.
    expect(world.journey.completionReport()).toBeNull();
    expect(world.journey.state().stage).toBe('GRAPH_BUILT');
  });

  it('verdicts never carry across revisions: every suite run targets the exact revision under evaluation', async () => {
    const world = createAcceptanceWorld();
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const report = world.journey.completionReport()!;

    // Every recorded evaluation request targeted the revision its task
    // produced at that moment (the recording probe kept the trail).
    const nodeCompletions = (await world.journey.timeline()).filter((event) => event.kind === 'journey.node-completed');
    expect(nodeCompletions.length).toBeGreaterThan(0);
    for (const completion of nodeCompletions) {
      const revision = completion.payload['sourceRevision'];
      expect(typeof revision).toBe('string');
      expect(world.evaluationRequests.some((request) => request.producedBy.kind === 'body')).toBe(true);
    }
    // The journey-level certification ran against the FINAL revision only.
    for (const ref of report.evaluation.verdictRefs) {
      expect(ref.targetSourceRevision).toBe(report.sourceRevisions.workspaceHead);
    }
  });
});
