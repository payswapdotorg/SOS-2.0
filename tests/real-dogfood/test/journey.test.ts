/**
 * THE FULL SCRIPTED FLAGSHIP JOURNEY (Work Order P19, deterministic
 * suite) — the REAL harness logic over the scripted seams: the §11
 * flagship journey driven end-to-end to COMPLETED with the EXACT stage
 * sequence, the §7 device pin, exact-revision links across repository /
 * pull request / deployment / runtime, and the independent-evaluation
 * completion gate (the body never certifies itself).
 */

import { describe, expect, it } from 'vitest';
import { recomputeCompletionId, GREENFIELD_JOURNEY_STAGES } from '@sos-2/greenfield-runtime';
import { createScriptedDogfoodWorld, defaultScriptedModelEntries, runScriptedWorld } from './scripted-world.js';
import type { ScriptedDogfoodWorld } from './scripted-world.js';

async function runDefaultWorld(repositorySlug = 'payswapdotorg/sos-dogfood-r1', journeyId = 'p19-dogfood-r1'): Promise<{ world: ScriptedDogfoodWorld; record: Awaited<ReturnType<typeof runScriptedWorld>> }> {
  const world = createScriptedDogfoodWorld({
    journeyId,
    repositorySlug,
    vercelProjectName: 'sos-dogfood-r1',
    modelEntries: defaultScriptedModelEntries(),
  });
  const record = await runScriptedWorld(world);
  return { world, record };
}

describe('P19 scripted dogfood: the full §11 journey to COMPLETED (offline, deterministic)', () => {
  it('completes the journey with the EXACT stage sequence (GREENFIELD_JOURNEY_STAGES)', async () => {
    const { record } = await runDefaultWorld();
    const state = record.finalState!;
    expect(state.stage).toBe('COMPLETED');
    expect(state.status).toBe('COMPLETED');
    expect(state.pendingAsk).toBeNull();
    expect(state.transitions.map((transition) => transition.to)).toEqual(GREENFIELD_JOURNEY_STAGES);
    expect(record.stages.map((stage) => stage.stage)).toEqual(GREENFIELD_JOURNEY_STAGES);
    expect(record.completion).not.toBeNull();
    expect(recomputeCompletionId(record.completion!)).toBe(record.completion!.completionId);
  });

  it('the §7 pin: EVERY cloud tick records userDeviceOnline=false (presence never consulted)', async () => {
    const { record } = await runDefaultWorld();
    expect(record.ticks.length).toBeGreaterThan(0);
    for (const tick of record.ticks) {
      expect(tick.userDeviceOnline, `tick ${String(tick.tick)} must record the user device offline`).toBe(false);
    }
  });

  it('the body executed the work programs through the (scripted) model seam — REAL harness drive, node-executed test', async () => {
    const { record } = await runDefaultWorld();
    expect(record.modelCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of record.modelCalls) {
      expect(call.ok).toBe(true);
      expect(call.model).toBe('qwen/qwen3-coder-flash');
      expect((call.usage?.total_tokens ?? 0) > 0).toBe(true);
    }
    // The evaluator probe EXECUTED the generated test under node (the real
    // spawnSync runner over the scripted contents — exit 0).
    expect(record.completion!.evaluation.passed).toBe(5);
    expect(record.completion!.evaluation.failed).toBe(0);
    expect(record.completion!.evaluation.unknown).toBe(0);
  });

  it('exact-revision links across commits, push, pull request, deployment and runtime', async () => {
    const { world, record } = await runDefaultWorld();
    const repo = world.github.repo('sos-dogfood-r1')!;
    const branch = `sos/mission-p19-dogfood-r1`;

    // Every realized commit is a REAL (scripted-provider) sha on the branch.
    expect(record.realizedCommitShas.length).toBe(2);
    const implHead = repo.branches.get(branch);
    expect(implHead).toBe(record.realizedCommitShas[record.realizedCommitShas.length - 1]);

    // The pull request: exact head sha, one PR on the implementation branch.
    expect(record.pullRequest).not.toBeNull();
    expect(record.pullRequest!.headBranch).toBe(branch);
    expect(record.pullRequest!.headSha).toBe(implHead);
    expect(repo.pullRequests.length).toBe(1);
    expect(repo.pullRequests[0]!.number).toBe(record.pullRequest!.number);

    // The default branch 'main' was provisioned at the FIRST realized commit
    // (an empty GitHub repository carries no branch; the honest note records it).
    expect(repo.branches.get('main')).toBe(record.realizedCommitShas[0]);
    expect(record.honestNotes.some((note) => note.includes("the default branch 'main' was provisioned"))).toBe(true);

    // The deployment: the EXACT PR head revision, READY, binding verified.
    expect(record.deployment).not.toBeNull();
    expect(record.deployment!.readyState).toBe('READY');
    expect(record.deployment!.commitSha).toBe(implHead);
    expect(record.deployment!.url).toContain('sos-dogfood-r1');

    // The runtime verification: the deployed URL serves the README byte-exact
    // at the deployed revision; the root 404 is recorded honestly (no index.html).
    expect(record.runtimeVerification).not.toBeNull();
    expect(record.runtimeVerification!.readmeStatus).toBe(200);
    expect(record.runtimeVerification!.readmeByteExact).toBe(true);
    expect(record.runtimeVerification!.deployedRevision).toBe(implHead);
    expect(record.runtimeVerification!.rootStatus).toBe(404);

    // The completion report's source revisions are the exact real shas.
    expect(record.completion!.sourceRevisions.workspaceHead).toBe(implHead);
    expect(record.completion!.sourceRevisions.push?.sha).toBe(implHead);
    expect(record.completion!.sourceRevisions.pullRequest?.pullRequestId).toBe(String(record.pullRequest!.number));
    expect(record.completion!.sourceRevisions.deployment?.sourceSha).toBe(implHead);
  });

  it('every stage record carries its EXACT revision and transcript references', async () => {
    const { record } = await runDefaultWorld();
    const byStage = new Map(record.stages.map((stage) => [stage.stage, stage]));
    expect(byStage.get('WORKSPACE_PROVISIONED')!.revision).toBe(record.realizedCommitShas[0]);
    expect(byStage.get('IMPLEMENTED')!.revision).toBe(record.realizedCommitShas[record.realizedCommitShas.length - 1]);
    expect(byStage.get('CHANGE_REALIZED')!.revision).toBe(record.pullRequest!.headSha);
    expect(byStage.get('DEPLOYED')!.revision).toBe(record.deployment!.commitSha);
    expect(byStage.get('COMPLETED')!.revision).toBe(record.completion!.sourceRevisions.workspaceHead);
    for (const stage of record.stages) {
      expect(stage.transcriptRefs.some((ref) => ref.provider === 'github' && ref.requests > 0)).toBe(true);
    }
  });

  it('the honest empty-repository state is recorded (never a fabricated imported revision)', async () => {
    const { record } = await runDefaultWorld();
    const connected = record.stages.find((stage) => stage.stage === 'REPOSITORY_CONNECTED')!;
    expect(connected.revision).toBeNull();
    expect(connected.detail).toContain('the honest empty-repository state');
  });

  it('the honest store selection: the reference fallback with the EXPLICIT marker (no DATABASE_URL)', async () => {
    const { record } = await runDefaultWorld();
    expect(record.storeSelection.mode).toBe('REFERENCE_FALLBACK');
    expect(record.storeSelection.storeRef).toBe('reference:in-memory-live-store');
    expect(record.storeSelection.referenceMode).toBe(true);
    expect(record.storeSelection.canonical.state).toBe('UNKNOWN');
    expect(record.storeSelection.note).toContain('explicitly NOT production durable state');
    expect(record.honestNotes.some((note) => note.includes('reference:in-memory-live-store'))).toBe(true);
  });

  it('the provider snapshot is honest (CONNECTED rows carry real probe evidence; names only)', async () => {
    const { record } = await runDefaultWorld();
    for (const provider of ['github', 'vercel', 'openrouter', 'neon', 'upstash']) {
      const row = record.providerStates.find((state) => state.provider === provider);
      expect(row, `the ${provider} provider row must exist`).toBeDefined();
    }
    const githubRow = record.providerStates.find((state) => state.provider === 'github')!;
    expect(githubRow.state).toBe('CONNECTED');
    expect(githubRow.credentialEnv).toBe('PAYSWAP_GITHUB_TOKEN');
    const serialized = JSON.stringify(record.providerStates);
    expect(serialized.includes('gh-fixture')).toBe(false);
    expect(serialized.includes('or-fixture')).toBe(false);
  });

  it('the post-journey package learning carries the REAL evidence refs (data-only records)', async () => {
    const { record } = await runDefaultWorld();
    const learning = record.learning!;
    expect(learning).not.toBeNull();
    expect(learning.packageIds.length).toBe(2);
    expect(learning.compositionId).toMatch(/^sos:\/\/PackageComposition\/[0-9a-f]{32}$/);
    for (const id of learning.packageIds) {
      expect(id).toMatch(/^sos:\/\/Package\/[0-9a-f]{32}$/);
    }
    for (const evidenceId of learning.evidenceIds) {
      expect(evidenceId).toMatch(/^sos:\/\/Evidence\/[0-9a-f]{32}$/);
    }
    expect(learning.realEvidenceRefs.pullRequestUrl).toContain('/pull/');
    expect(learning.realEvidenceRefs.pullRequestHeadSha).toBe(record.pullRequest!.headSha);
    expect(learning.realEvidenceRefs.deploymentUrl).toBe(record.deployment!.url);
    expect(learning.realEvidenceRefs.evaluatorVerdictRefs.length).toBeGreaterThan(0);
    expect(learning.ecologyAssertion?.kind).toBe('COMPATIBLE_WITH');
  });

  it('no repair, no ask — recorded honestly (the happy path)', async () => {
    const { record } = await runDefaultWorld();
    expect(record.repairs.length).toBe(0);
    expect(record.asks.length).toBe(0);
    expect(record.honestNotes.some((note) => note.includes('no repair occurred'))).toBe(true);
  });
});
