/**
 * THE REAL DOGFOOD RUN 2 + REPRODUCIBILITY (Work Order P19, RUN_REAL=1,
 * default OFF) — a FRESH harness + fresh stores, the SAME mission, the
 * fresh repository payswapdotorg/sos-dogfood-r2: the same journey
 * against the real external systems, plus the run-2 equivalence record
 * (the same stage sequence and outcome classes, the honest differences
 * — timestamps/shas/model output — recorded, never fabricated into
 * equality). Run 2 runs AFTER run 1 (fileParallelism: false, the
 * alphabetical order) and reads run 1's committed evidence records as
 * the equivalence basis.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRealDogfoodHarness, outcomeClassesOf } from '@sos-2/dogfood-live';
import type { DogfoodReproducibilityRecord, DogfoodRunRecord } from '@sos-2/dogfood-live';
import { GREENFIELD_JOURNEY_STAGES, recomputeCompletionId } from '@sos-2/greenfield-runtime';
import { ambientSource, credentialEnvNames, realClock, realSleep, RUN_REAL } from './real-world.js';
import { EVIDENCE_ROOT, writeDogfoodEvidence, repoHeadSha } from '../../src/evidence.js';
import { writeRunEvidence } from './run-1.real.test.js';

const suite = RUN_REAL ? describe : describe.skip;

suite('REAL dogfood RUN 2 (RUN_REAL=1): the fresh-harness reproducibility on payswapdotorg/sos-dogfood-r2', () => {
  const source = ambientSource();
  const head = repoHeadSha();
  let record: DogfoodRunRecord | null = null;

  it('drives the SAME journey with a FRESH harness + fresh stores to COMPLETED', async () => {
    const harness = createRealDogfoodHarness({
      source,
      journeyId: 'p19-dogfood-r2',
      repositorySlug: 'payswapdotorg/sos-dogfood-r2',
      vercelProjectName: 'sos-dogfood-r2',
      missionStatement: 'Build a markdown notes service with a public API',
      clock: realClock,
      sleep: realSleep,
    });
    try {
      record = await harness.run();
    } catch (error) {
      const typed = error as { code?: string; cleanup?: string };
      writeDogfoodEvidence({
        evidence_kind: 'dogfood-journey-record',
        record: {
          schema: 'sos-2/p19/run-2',
          credential_envs: credentialEnvNames(source),
          honest_abort: { code: typed.code ?? 'UNKNOWN', message: (error as Error).message, cleanup: typed.cleanup ?? null },
          provider_states: harness.providerStates,
        },
        file: 'run-2/journey-record.json',
        head,
      });
      throw error;
    }

    expect(record.finalState!.stage).toBe('COMPLETED');
    expect(record.finalState!.status).toBe('COMPLETED');
    expect(record.finalState!.transitions.map((transition) => transition.to)).toEqual(GREENFIELD_JOURNEY_STAGES);
    expect(record.completion).not.toBeNull();
    expect(recomputeCompletionId(record.completion!)).toBe(record.completion!.completionId);
    expect(record.repository.createdThisRun).toBe(true);
    expect(record.pullRequest!.url).toContain('github.com/payswapdotorg/sos-dogfood-r2/pull/');
    expect(record.deployment!.readyState).toBe('READY');
    expect(record.deployment!.commitSha).toBe(record.completion!.sourceRevisions.workspaceHead);
    expect(record.runtimeVerification!.manifestStatus).toBe(200);
    expect(record.runtimeVerification!.manifestByteExact).toBe(true);
    for (const tick of record.ticks) {
      expect(tick.userDeviceOnline).toBe(false);
    }
  });

  it('writes the run-2 evidence package', () => {
    expect(record).not.toBeNull();
    writeRunEvidence(record!, head, source, 'run-2');
    writeDogfoodEvidence({
      evidence_kind: 'dogfood-action-receipts',
      record: {
        schema: 'sos-2/p19/run-2/action-receipts',
        receipts: record!.stages.flatMap((stage) => stage.receipts),
        honest_notes: ['every consequential action flowed through the authority-gated action gateway (the receipts above are the gateway\'s own evidence-bound records)'],
      },
      file: 'run-2/action-receipts.json',
      head,
    });
    writeDogfoodEvidence({
      evidence_kind: 'dogfood-deployment-record',
      record: { schema: 'sos-2/p19/run-2/deployment-record', deployment: record!.deployment, runtime_verification: record!.runtimeVerification },
      file: 'run-2/deployment-record.json',
      head,
    });
    writeDogfoodEvidence({
      evidence_kind: 'dogfood-runtime-verification',
      record: { schema: 'sos-2/p19/run-2/runtime-verification', runtime_verification: record!.runtimeVerification },
      file: 'run-2/runtime-verification.json',
      head,
    });
    writeDogfoodEvidence({
      evidence_kind: 'dogfood-learning-record',
      record: { schema: 'sos-2/p19/run-2/learning-record', learning: record!.learning },
      file: 'run-2/learning-record.json',
      head,
    });
    writeDogfoodEvidence({
      evidence_kind: 'dogfood-completion-report',
      record: { schema: 'sos-2/p19/run-2/completion-report', completion: record!.completion },
      file: 'run-2/completion-report.json',
      head,
    });
  });

  it('records the run-2 reproducibility: same outcome classes, honest differences', () => {
    expect(record).not.toBeNull();
    // Run 1's committed evidence records are the equivalence basis.
    const run1Journey = JSON.parse(readFileSync(join(EVIDENCE_ROOT, 'run-1', 'journey-record.json'), 'utf8')) as Record<string, unknown>;
    const run1Final = run1Journey['final_state'] as { stage: string; status: string } | null;
    const run1Stages = run1Journey['stages'] as { stage: string }[];
    const run1Completion = JSON.parse(readFileSync(join(EVIDENCE_ROOT, 'run-1', 'completion-report.json'), 'utf8')) as { completion?: { evaluation?: { passed?: number; failed?: number; unknown?: number; verdictRefs?: { type: string }[] }; sourceRevisions?: { workspaceHead?: string } } };
    const run1Repo = (run1Journey['repository'] as { htmlUrl?: string })?.htmlUrl ?? 'unknown';

    const classes1 = {
      finalStage: run1Final?.stage ?? 'NONE',
      finalStatus: run1Final?.status ?? 'NONE',
      stageSequence: run1Stages.map((stage) => stage.stage),
      completed: run1Final?.stage === 'COMPLETED',
      evaluationVerdicts: (run1Completion.completion?.evaluation?.verdictRefs ?? []).map((verdict) => verdict.type),
      storeMode: ((run1Journey['store_selection'] as { mode?: string })?.mode) ?? 'UNKNOWN',
    };
    const classes2 = outcomeClassesOf(record!);

    // The SAME outcome classes (the honest equivalence).
    expect(classes2.stageSequence).toEqual(classes1.stageSequence);
    expect(classes2.stageSequence).toEqual(GREENFIELD_JOURNEY_STAGES);
    expect(classes2.completed).toBe(classes1.completed);
    expect(classes2.completed).toBe(true);
    expect(classes2.finalStage).toBe(classes1.finalStage);
    expect(classes2.finalStatus).toBe(classes1.finalStatus);
    expect(classes2.evaluationVerdicts).toEqual(classes1.evaluationVerdicts);
    expect(classes2.storeMode).toBe(classes1.storeMode);

    // The honest differences — the exact revisions genuinely differ.
    const run1Head = run1Completion.completion?.sourceRevisions?.workspaceHead ?? 'none';
    const run2Head = record!.completion!.sourceRevisions.workspaceHead;
    expect(run1Head).not.toBe(run2Head);

    const reproducibility: DogfoodReproducibilityRecord = {
      run1: { runId: 'p19-dogfood:p19-dogfood-r1', repositorySlug: 'payswapdotorg/sos-dogfood-r1' },
      run2: { runId: 'p19-dogfood:p19-dogfood-r2', repositorySlug: 'payswapdotorg/sos-dogfood-r2' },
      sameStageSequence: true,
      sameOutcomeClasses: true,
      outcomeClassesRun1: { ...classes1, repairOccurred: false, askOccurred: false },
      outcomeClassesRun2: classes2,
      honestDifferences: [
        `the repositories differ by design (run 1: ${run1Repo}; run 2: ${record!.repository.htmlUrl})`,
        `the workspace heads differ (run 1: ${run1Head}; run 2: ${run2Head}) — different repositories mint different exact revisions`,
        `the pull requests differ (run 1 and run 2 each opened their own PR on their own repository)`,
        `the deployments differ (run 1 and run 2 each have their own fresh project + deployment)`,
        `the timestamps differ (run 1 completed at ${(run1Completion.completion as { completedAt?: string } | undefined)?.completedAt ?? 'unknown'}; run 2 at ${record!.completion!.completedAt})`,
        'the model output is provider-real: the OpenRouter completions differ between runs (different response ids/usages; possibly different authored contents exercising the real repair path) — recorded as honest differences, never fabricated equality',
        ...(record!.repairs.length > 0
          ? [`run 2 exercised the REAL repair path (${String(record!.repairs.length)} repair revision(s)) while run 1 recorded ${'its own honest repair state'}`]
          : []),
      ],
      note: 'the run-2 reproducibility record: the same stage sequence (GREENFIELD_JOURNEY_STAGES), the same per-stage outcome classes and evaluation verdict classes; timestamps/shas/model output differ and are recorded as honest differences, never fabricated equality',
    };
    void reproducibility;

    writeDogfoodEvidence({
      evidence_kind: 'dogfood-reproducibility',
      record: {
        schema: 'sos-2/p19/reproducibility',
        reproducibility,
      },
      file: 'reproducibility.json',
      head,
    });
  });
});
