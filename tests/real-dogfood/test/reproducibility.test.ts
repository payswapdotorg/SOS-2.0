/**
 * THE RUN-2 REPRODUCIBILITY LOGIC (Work Order P19, deterministic suite)
 * — two runs on FRESH harnesses + fresh stores, the SAME mission, two
 * different repositories: the outcome classes are EQUIVALENT (the same
 * stage sequence, the same per-stage outcome classes and evaluation
 * verdicts) and the differences are recorded HONESTLY (timestamps,
 * shas, repository identities differ — never fabricated into equality).
 */

import { describe, expect, it } from 'vitest';
import { outcomeClassesOf } from '@sos-2/dogfood-live';
import type { DogfoodReproducibilityRecord, DogfoodRunRecord } from '@sos-2/dogfood-live';
import { createScriptedDogfoodWorld, defaultScriptedModelEntries, runScriptedWorld } from './scripted-world.js';

async function runTwice(): Promise<{ run1: DogfoodRunRecord; run2: DogfoodRunRecord }> {
  const world1 = createScriptedDogfoodWorld({
    journeyId: 'p19-dogfood-r1',
    repositorySlug: 'payswapdotorg/sos-dogfood-r1',
    vercelProjectName: 'sos-dogfood-r1',
    modelEntries: defaultScriptedModelEntries(),
  });
  const run1 = await runScriptedWorld(world1);
  // RUN 2: a FRESH harness + fresh stores, the SAME mission, a fresh repository.
  const world2 = createScriptedDogfoodWorld({
    journeyId: 'p19-dogfood-r2',
    repositorySlug: 'payswapdotorg/sos-dogfood-r2',
    vercelProjectName: 'sos-dogfood-r2',
    modelEntries: defaultScriptedModelEntries(),
  });
  const run2 = await runScriptedWorld(world2);
  return { run1, run2 };
}

/** The run-2 equivalence record (the same derivation the real suite uses). */
function reproducibilityOf(run1: DogfoodRunRecord, run2: DogfoodRunRecord): DogfoodReproducibilityRecord {
  const classes1 = outcomeClassesOf(run1);
  const classes2 = outcomeClassesOf(run2);
  const sameStageSequence = JSON.stringify(classes1.stageSequence) === JSON.stringify(classes2.stageSequence);
  const sameOutcomeClasses =
    sameStageSequence &&
    classes1.finalStage === classes2.finalStage &&
    classes1.finalStatus === classes2.finalStatus &&
    classes1.completed === classes2.completed &&
    JSON.stringify(classes1.evaluationVerdicts) === JSON.stringify(classes2.evaluationVerdicts) &&
    classes1.repairOccurred === classes2.repairOccurred &&
    classes1.askOccurred === classes2.askOccurred &&
    classes1.storeMode === classes2.storeMode;
  const honestDifferences: string[] = [
    `the repositories differ by design (run 1: ${run1.mission.repositorySlug}; run 2: ${run2.mission.repositorySlug})`,
    `the workspace heads differ (run 1: ${run1.completion?.sourceRevisions.workspaceHead ?? 'none'}; run 2: ${run2.completion?.sourceRevisions.workspaceHead ?? 'none'}) — different repositories mint different exact revisions`,
    `the pull requests differ (run 1: ${run1.pullRequest?.url ?? 'none'}; run 2: ${run2.pullRequest?.url ?? 'none'})`,
    `the deployments differ (run 1: ${run1.deployment?.deploymentId ?? 'none'}; run 2: ${run2.deployment?.deploymentId ?? 'none'})`,
    `the timestamps differ (run 1 completed at ${run1.completion?.completedAt ?? 'never'}; run 2 at ${run2.completion?.completedAt ?? 'never'})`,
    'the model output is provider-real in the real suite: timestamps/shas/model output differ between runs — recorded as honest differences, never fabricated equality',
  ];
  return {
    run1: { runId: run1.runId, repositorySlug: run1.mission.repositorySlug },
    run2: { runId: run2.runId, repositorySlug: run2.mission.repositorySlug },
    sameStageSequence,
    sameOutcomeClasses,
    outcomeClassesRun1: classes1,
    outcomeClassesRun2: classes2,
    honestDifferences,
    note: 'the run-2 reproducibility record: the same stage sequence (GREENFIELD_JOURNEY_STAGES), the same per-stage outcome classes and evaluation verdicts; timestamps/shas/model output differ and are recorded as honest differences, never fabricated equality',
  };
}

describe('P19 scripted dogfood: the run-2 reproducibility (fresh harness + fresh stores, same mission)', () => {
  it('both runs COMPLETE with the SAME outcome classes (stage sequence, verdict classes, store mode)', async () => {
    const { run1, run2 } = await runTwice();
    const classes1 = outcomeClassesOf(run1);
    const classes2 = outcomeClassesOf(run2);

    expect(classes1.completed).toBe(true);
    expect(classes2.completed).toBe(true);
    expect(classes1.finalStage).toBe('COMPLETED');
    expect(classes2.finalStage).toBe('COMPLETED');
    expect(classes2.stageSequence).toEqual(classes1.stageSequence);
    expect(classes2.evaluationVerdicts).toEqual(classes1.evaluationVerdicts);
    expect(classes2.storeMode).toBe(classes1.storeMode);
    expect(classes2.repairOccurred).toBe(classes1.repairOccurred);
    expect(classes2.askOccurred).toBe(classes1.askOccurred);
  });

  it('the equivalence record is honest: the differences are recorded, never fabricated into equality', async () => {
    const { run1, run2 } = await runTwice();
    const record = reproducibilityOf(run1, run2);

    expect(record.sameStageSequence).toBe(true);
    expect(record.sameOutcomeClasses).toBe(true);
    expect(record.outcomeClassesRun1.completed).toBe(true);
    expect(record.outcomeClassesRun2.completed).toBe(true);
    // The honest differences: the exact revisions genuinely differ.
    expect(record.honestDifferences.length).toBeGreaterThanOrEqual(4);
    expect(run1.completion!.sourceRevisions.workspaceHead).not.toBe(run2.completion!.sourceRevisions.workspaceHead);
    expect(run1.pullRequest!.url).not.toBe(run2.pullRequest!.url);
    expect(run1.deployment!.deploymentId).not.toBe(run2.deployment!.deploymentId);
    // Both runs' repositories exist independently with their own commits.
    expect(run1.repository.name).toBe('sos-dogfood-r1');
    expect(run2.repository.name).toBe('sos-dogfood-r2');
  });

  it('the outcome-class derivation surfaces honest non-completion too (the ASK fixture)', async () => {
    const world = createScriptedDogfoodWorld({
      journeyId: 'p19-dogfood-ask-eq',
      repositorySlug: 'payswapdotorg/sos-dogfood-ask-eq',
      vercelProjectName: 'sos-dogfood-ask-eq',
      modelEntries: (await import('./scripted-world.js')).repairFixtureModelEntries(),
      failRepairCommits: true,
    });
    const record = await runScriptedWorld(world);
    const classes = outcomeClassesOf(record);
    expect(classes.completed).toBe(false);
    expect(classes.askOccurred).toBe(true);
    expect(classes.finalStatus).toBe('AWAITING_ASK');
  });
});
