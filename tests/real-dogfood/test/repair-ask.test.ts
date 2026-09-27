/**
 * THE REPAIR + ASK PATHS (Work Order P19, deterministic suite) — the
 * engine's bounded repair discipline runs for real over the scripted
 * seams, and the typed ASK surfaces honestly when the bound is
 * exhausted or the repository is not empty:
 *
 *   - REPAIR: the first body output fails a check (the generated test
 *     fails under node) → the repair revision (the planned files) → the
 *     FULL FRESH suite re-runs against the EXACT new revision → pass →
 *     COMPLETED with the repair recorded honestly;
 *   - ASK (repair unavailable): the same failing fixture with repair
 *     commits refused by the provider → REPAIR_UNAVAILABLE → the journey
 *     parks behind the typed ask — never a silent skip, never a
 *     fabricated pass;
 *   - ASK (repository not empty): the honest NOT_EMPTY refusal (the
 *     greenfield journey realizes into an empty repository, never
 *     overwrites existing work).
 */

import { describe, expect, it } from 'vitest';
import { createScriptedDogfoodWorld, repairFixtureModelEntries, runScriptedWorld, SCRIPTED_GITHUB_LOGIN } from './scripted-world.js';

describe('P19 scripted dogfood: the repair path (bounded, honest, fresh-suite)', () => {
  it('a failing first body output → the repair revision → the FULL fresh suite re-runs → pass → COMPLETED', async () => {
    const world = createScriptedDogfoodWorld({
      journeyId: 'p19-dogfood-repair',
      repositorySlug: 'payswapdotorg/sos-dogfood-repair',
      vercelProjectName: 'sos-dogfood-repair',
      modelEntries: repairFixtureModelEntries(),
    });
    const record = await runScriptedWorld(world);

    // The journey COMPLETED after the repair discipline ran for real.
    expect(record.finalState!.stage).toBe('COMPLETED');
    expect(record.finalState!.status).toBe('COMPLETED');
    expect(record.repairs.length).toBe(1);
    const repair = record.repairs[0]!;
    expect(repair.taskId).toBe('p13-goal-deliver');
    expect(repair.newSourceRevision).not.toBeNull();
    expect(repair.detail).toContain('re-committed the planned (correct) files');

    // The repair produced a NEW revision: the realized commit sequence
    // grew (model commit + repair commit on the goal node), and the final
    // head is the repair revision.
    expect(record.realizedCommitShas.length).toBe(3);
    expect(record.realizedCommitShas[record.realizedCommitShas.length - 1]).toBe(repair.newSourceRevision);
    expect(record.completion!.sourceRevisions.workspaceHead).toBe(repair.newSourceRevision);

    // The verdicts never carried across revisions: the fresh suite ran
    // against the EXACT new revision (5 passed, 0 failed/unknown).
    expect(record.completion!.evaluation.passed).toBe(5);
    expect(record.completion!.evaluation.failed).toBe(0);
    expect(record.completion!.evaluation.unknown).toBe(0);

    // The repair commit is a REAL (scripted-provider) commit on the branch
    // whose message follows the merged repair-executor format.
    const repo = world.github.repo('sos-dogfood-repair')!;
    const repairCommit = repo.commits.get(repair.newSourceRevision!)!;
    expect(repairCommit.message).toMatch(/^repair: Implement: Deliver: Build a markdown notes service with a public API \(attempt 1; \d+ failure\(s\)\)$/);
    // The repaired revision carries the PLANNED files (the reference module + test).
    expect(repairCommit.files.has('src/goal-deliver/module.ts')).toBe(true);
    expect(repairCommit.files.has('src/goal-deliver/module.test.ts')).toBe(true);
  });

  it('the repair-exhaustion/unavailable path: a typed ASK, never a silent skip, never a fabricated pass', async () => {
    const world = createScriptedDogfoodWorld({
      journeyId: 'p19-dogfood-ask',
      repositorySlug: 'payswapdotorg/sos-dogfood-ask',
      vercelProjectName: 'sos-dogfood-ask',
      modelEntries: repairFixtureModelEntries(),
      failRepairCommits: true,
    });
    const record = await runScriptedWorld(world);

    // The journey parked behind the typed ask — honestly, without completing.
    expect(record.finalState!.status).toBe('AWAITING_ASK');
    expect(record.finalState!.pendingAsk).not.toBeNull();
    expect(record.finalState!.pendingAsk!.reasonCode).toBe('REPAIR_UNAVAILABLE');
    expect(record.finalState!.pendingAsk!.stage).toBe('COMPLETION');
    expect(record.completion).toBeNull();
    expect(record.pendingAsk!.detail).toContain('could not produce a corrected revision');
    expect(record.asks.some((ask) => ask.reasonCode === 'REPAIR_UNAVAILABLE')).toBe(true);
  });

  it('the non-empty repository: the honest NOT_EMPTY ask (never overwrites existing work)', async () => {
    const world = createScriptedDogfoodWorld({
      journeyId: 'p19-dogfood-notempty',
      repositorySlug: 'payswapdotorg/sos-dogfood-notempty',
      vercelProjectName: 'sos-dogfood-notempty',
      modelEntries: repairFixtureModelEntries(),
    });
    // The busy-repo decoy exists and is NOT empty in the scripted GitHub.
    const repo = world.github.repo('busy-repo')!;
    expect(repo.branches.size).toBeGreaterThan(0);

    await world.harness.preflight();
    const journey = world.harness.journey;
    await journey.kickoff({
      statement: 'Build a markdown notes service with a public API',
      repositorySlug: `${SCRIPTED_GITHUB_LOGIN}/busy-repo`,
      capturedAt: new Date(0).toISOString(),
      source: 'web-console:greenfield',
    });
    await world.harness.provider.verifyToken(new Date(0).toISOString());
    const connect = await journey.connectRepository(`${SCRIPTED_GITHUB_LOGIN}/busy-repo`);
    expect(connect.kind).toBe('NOT_EMPTY');
    if (connect.kind === 'NOT_EMPTY') {
      expect(connect.ask.reasonCode).toBe('REPOSITORY_NOT_EMPTY');
      expect(connect.ask.openQuestions.length).toBeGreaterThan(0);
    }
    // The journey parked behind the typed ask at the connect stage.
    const state = journey.state();
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.reasonCode).toBe('REPOSITORY_NOT_EMPTY');
    // The dogfood repo of THIS run (sos-dogfood-notempty) WAS created (the
    // harness creates its own fresh repository) — the busy-repo was untouched.
    expect(world.github.repo('sos-dogfood-notempty')).toBeDefined();
  });
});
