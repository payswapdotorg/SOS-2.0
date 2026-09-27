/**
 * THE REAL DOGFOOD RUN 1 (Work Order P19, RUN_REAL=1, default OFF) —
 * the §11 flagship journey against the REAL external systems on
 * payswapdotorg/sos-dogfood-r1:
 *
 *   preflight probes → create the repository via the real API → the
 *   user-present phase (kickoff with the real clock; the PAT whoami
 *   handshake; real discovery + empty-repository detection; the
 *   pre-approved typed authority) → the cloud-tick drive (the reference
 *   formalizer/planner; the durable task graph over the honestly
 *   selected store; the REAL OpenRouter-backed body; REAL GitHub
 *   commits through the gateway; the real push + pull request; the
 *   fresh Vercel project + the production deployment of the exact PR
 *   head revision; the REAL runtime verification) → the independent
 *   evaluation gates completion → the post-journey package learning →
 *   the evidence records (every consequential call a transcript/receipt;
 *   every stage's exact revision in the journey record).
 *
 * A pre-existing repository/project is a typed abort with cleanup
 * instructions (never silently reused) — recorded as evidence, then the
 * run FAILS truthfully. A provider outage is recorded honestly
 * (DEGRADED/UNAVAILABLE) and fails truthfully. The artifacts (the
 * repository, the project, the PR, the deployment) ARE the evidence —
 * never deleted.
 */

import { describe, expect, it } from 'vitest';
import { createRealDogfoodHarness } from '@sos-2/dogfood-live';
import type { DogfoodRunRecord } from '@sos-2/dogfood-live';
import { GREENFIELD_JOURNEY_STAGES, recomputeCompletionId } from '@sos-2/greenfield-runtime';
import { ambientSource, credentialEnvNames, realClock, realSleep, RUN_REAL } from './real-world.js';
import { writeDogfoodEvidence, repoHeadSha } from '../../src/evidence.js';

const suite = RUN_REAL ? describe : describe.skip;

/** Write the full evidence package of one real run (§5 run-N/). */
export function writeRunEvidence(record: DogfoodRunRecord, head: string, source: Readonly<Record<string, string>>, runDir: 'run-1' | 'run-2'): void {
  writeDogfoodEvidence({
    evidence_kind: 'dogfood-journey-record',
    record: {
      schema: `sos-2/p19/${runDir}`,
      credential_envs: credentialEnvNames(source),
      mission: record.mission,
      repository: record.repository,
      implementation_branch: record.implementationBranch,
      store_selection: record.storeSelection,
      model_calls: record.modelCalls,
      repairs: record.repairs,
      asks: record.asks,
      stages: record.stages,
      ticks: record.ticks,
      pull_request: record.pullRequest,
      deployment: record.deployment,
      runtime_verification: record.runtimeVerification,
      final_state: record.finalState === null ? null : { stage: record.finalState.stage, status: record.finalState.status },
      pending_ask: record.pendingAsk,
      honest_notes: record.honestNotes,
    },
    file: `${runDir}/journey-record.json`,
    head,
  });
  writeDogfoodEvidence({
    evidence_kind: 'dogfood-provider-states',
    record: {
      schema: `sos-2/p19/${runDir}/provider-states`,
      credential_envs: credentialEnvNames(source),
      provider_states: record.providerStates,
      store_selection: record.storeSelection,
    },
    file: `${runDir}/provider-states.json`,
    head,
  });
}

suite('REAL dogfood RUN 1 (RUN_REAL=1): the flagship journey on payswapdotorg/sos-dogfood-r1', () => {
  const source = ambientSource();
  const head = repoHeadSha();
  let record: DogfoodRunRecord | null = null;

  it('drives the full §11 journey against the real external systems to COMPLETED', async () => {
    const harness = createRealDogfoodHarness({
      source,
      journeyId: 'p19-dogfood-r1',
      repositorySlug: 'payswapdotorg/sos-dogfood-r1',
      vercelProjectName: 'sos-dogfood-r1',
      missionStatement: 'Build a markdown notes service with a public API',
      clock: realClock,
      sleep: realSleep,
    });
    try {
      record = await harness.run();
    } catch (error) {
      // The honest abort (a pre-existing repo/project, a provider outage):
      // recorded as evidence, then the run fails truthfully.
      const typed = error as { code?: string; cleanup?: string };
      writeDogfoodEvidence({
        evidence_kind: 'dogfood-journey-record',
        record: {
          schema: 'sos-2/p19/run-1',
          credential_envs: credentialEnvNames(source),
          honest_abort: { code: typed.code ?? 'UNKNOWN', message: (error as Error).message, cleanup: typed.cleanup ?? null },
          provider_states: harness.providerStates,
        },
        file: 'run-1/journey-record.json',
        head,
      });
      throw error;
    }

    // THE JOURNEY COMPLETED with the exact stage sequence.
    expect(record.finalState!.stage).toBe('COMPLETED');
    expect(record.finalState!.status).toBe('COMPLETED');
    expect(record.finalState!.transitions.map((transition) => transition.to)).toEqual(GREENFIELD_JOURNEY_STAGES);
    expect(record.stages.map((stage) => stage.stage)).toEqual(GREENFIELD_JOURNEY_STAGES);
    expect(record.completion).not.toBeNull();
    expect(recomputeCompletionId(record.completion!)).toBe(record.completion!.completionId);
  });

  it('the §7 pin: EVERY cloud tick recorded the user device offline', () => {
    expect(record).not.toBeNull();
    for (const tick of record!.ticks) {
      expect(tick.userDeviceOnline).toBe(false);
    }
  });

  it('the repository/PR/deployment are REAL with exact revisions at every stage', () => {
    expect(record!.repository.createdThisRun).toBe(true);
    expect(record!.repository.htmlUrl).toBe('https://github.com/payswapdotorg/sos-dogfood-r1');
    expect(record!.pullRequest).not.toBeNull();
    expect(record!.pullRequest!.url).toContain('github.com/payswapdotorg/sos-dogfood-r1/pull/');
    expect(record!.pullRequest!.headSha).toBe(record!.completion!.sourceRevisions.workspaceHead);
    expect(record!.deployment).not.toBeNull();
    expect(record!.deployment!.readyState).toBe('READY');
    expect(record!.deployment!.commitSha).toBe(record!.completion!.sourceRevisions.workspaceHead);
    expect(record!.deployment!.url).toContain('vercel.app');
    const byStage = new Map(record!.stages.map((stage) => [stage.stage, stage]));
    expect(byStage.get('WORKSPACE_PROVISIONED')!.revision).toBe(record!.realizedCommitShas[0]);
    expect(byStage.get('DEPLOYED')!.revision).toBe(record!.deployment!.commitSha);
    expect(byStage.get('COMPLETED')!.revision).toBe(record!.completion!.sourceRevisions.workspaceHead);
  });

  it('the body executed through REAL OpenRouter completions (provider facts recorded)', () => {
    expect(record!.modelCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of record!.modelCalls) {
      expect(call.model).toBeTruthy();
      expect(call.responseId).toBeTruthy();
    }
  });

  it('the independent evaluation gated completion (5 evaluator types, 0 failed/unknown)', () => {
    expect(record!.completion!.evaluation.passed).toBe(5);
    expect(record!.completion!.evaluation.failed).toBe(0);
    expect(record!.completion!.evaluation.unknown).toBe(0);
    expect(record!.completion!.certifiedUponRequestBy.id).not.toBe(record!.completion!.producedBy.id);
  });

  it('the runtime verification: the deployed URL answered 200 with the exact-revision content', () => {
    expect(record!.runtimeVerification).not.toBeNull();
    expect(record!.runtimeVerification!.readmeStatus).toBe(200);
    expect(record!.runtimeVerification!.readmeByteExact).toBe(true);
    expect(record!.runtimeVerification!.deployedRevision).toBe(record!.deployment!.commitSha);
  });

  it('writes the full evidence package (journey record, provider states, receipts, deployment, runtime, learning, completion)', async () => {
    const harnessStores = record!;
    writeRunEvidence(harnessStores, head, source, 'run-1');
    const { DogfoodVercelClient } = await import('@sos-2/dogfood-live');
    void DogfoodVercelClient;
    // The action receipts + the deployment/runtime/learning/completion records.
    writeDogfoodEvidence({
      evidence_kind: 'dogfood-action-receipts',
      record: {
        schema: 'sos-2/p19/run-1/action-receipts',
        receipts: record!.stages.flatMap((stage) => stage.receipts),
        honest_notes: ['every consequential action flowed through the authority-gated action gateway (the receipts above are the gateway\'s own evidence-bound records)'],
      },
      file: 'run-1/action-receipts.json',
      head,
    });
    writeDogfoodEvidence({
      evidence_kind: 'dogfood-deployment-record',
      record: { schema: 'sos-2/p19/run-1/deployment-record', deployment: record!.deployment, runtime_verification: record!.runtimeVerification },
      file: 'run-1/deployment-record.json',
      head,
    });
    writeDogfoodEvidence({
      evidence_kind: 'dogfood-runtime-verification',
      record: { schema: 'sos-2/p19/run-1/runtime-verification', runtime_verification: record!.runtimeVerification },
      file: 'run-1/runtime-verification.json',
      head,
    });
    writeDogfoodEvidence({
      evidence_kind: 'dogfood-learning-record',
      record: { schema: 'sos-2/p19/run-1/learning-record', learning: record!.learning },
      file: 'run-1/learning-record.json',
      head,
    });
    writeDogfoodEvidence({
      evidence_kind: 'dogfood-completion-report',
      record: { schema: 'sos-2/p19/run-1/completion-report', completion: record!.completion },
      file: 'run-1/completion-report.json',
      head,
    });
  });
});
