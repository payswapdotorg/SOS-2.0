/**
 * P18-A deterministic reference-mode suite (6/6): REPLAY / RECONCILIATION.
 *
 * The data-plane replay + reconciliation semantics across successive
 * live-mission requests over the SAME world (same providers, same
 * durable row):
 *
 *   - run 1 (baseline): the first observation persists to the canonical
 *     store at storage version 1; the production claim reconciles
 *     ALIGNED; no shortfall detections;
 *   - replay WITHIN one drain: GitHub redelivery (the SAME durable
 *     event id twice in one poll) deduplicates through the
 *     replay-protected pipeline — applied 1, duplicates 1, ONE folded
 *     head (never double-counted);
 *   - run 2 (a replayed provider state — the same events re-read on a
 *     fresh request): the identical observation; the durable claim from
 *     run 1's snapshot reconciles ALIGNED (nothing changed); the
 *     snapshot upserts at the EXACT incremented storage version 2;
 *   - run 3 (the repository moved): the durable claim from run 2's
 *     snapshot reconciles DIVERGED; the deployment claim stays ALIGNED
 *     (production did not move); the deployment/source-SHA binding is
 *     DIVERGED and the honest detections fire (DEPLOYED_NOT_AT_HEAD +
 *     STATE_DIVERGED — difference only, ordering never claimed);
 *   - the durable snapshot row always records the observed head (the
 *     reconciliation input of the NEXT request — the durable loop).
 */

import { describe, expect, it } from 'vitest';
import { assertValidLiveDataPlaneView } from '@web-contracts/live';
import { rerunPlane, runPlane } from './harness';
import { HEAD_A, HEAD_B } from './world';

describe('the live data plane replay/reconciliation (deterministic reference mode)', () => {
  it('run 1: the baseline observation persists at storage version 1 and reconciles the production claim ALIGNED', async () => {
    const run = await runPlane();
    expect(run.result.durability.persisted).toBe(true);
    expect(run.result.durability.storageVersion).toBe(1);
    expect(run.world.neonRow.snapshot).toMatchObject({ observedHead: HEAD_A });
    const production = run.result.report!.findings.find((finding) => finding.subject === 'deploy:environment:production');
    expect(production?.kind).toBe('ALIGNED');
    expect(run.result.report!.detections).toEqual([]);
    // no previous durable snapshot existed -> no main-branch claim this run (nothing fabricated)
    expect(run.result.report!.findings.find((finding) => finding.subject.includes('@main'))).toBeUndefined();
  });

  it('replayed delivery WITHIN one drain deduplicates (applied 1, duplicates 1 — never double-counted)', async () => {
    const { result } = await runPlane({ githubEvents: 'push-a-replayed' });
    const githubSummary = result.report!.sourceSummaries.find((summary) => summary.source.startsWith('github:rest-events'))!;
    expect(githubSummary.applied).toBe(1);
    expect(githubSummary.duplicates).toBe(1);
    expect(result.data.repository.branchHeads).toHaveLength(1);
    expect(result.data.repository.branchHeads[0]!.head).toBe(HEAD_A);
    assertValidLiveDataPlaneView(result.view);
  });

  it('run 2 (the replayed provider state): identical observation, durable claim ALIGNED, storage version increments to 2', async () => {
    const run1 = await runPlane();
    const run2 = await rerunPlane(run1);
    // the durable previous snapshot (run 1) claims the observed head — reconciliation proves nothing changed
    expect(run2.result.report!.findings.find((finding) => finding.subject === 'github:repo:payswapdotorg/SOS-2.0@main')?.kind).toBe('ALIGNED');
    expect(run2.result.report!.findings.find((finding) => finding.subject === 'deploy:environment:production')?.kind).toBe('ALIGNED');
    // the identical observation (same provider state -> same projections)
    expect(run2.result.data.repository.branchHeads[0]!.head).toBe(HEAD_A);
    expect(run2.result.data.ci.latestByPipeline[0]!.runId).toBe('9101');
    expect(run2.result.data.deployments.byEnvironment[0]!.revision).toBe(HEAD_A);
    // the durable upsert increments the EXACT storage revision
    expect(run2.result.durability.persisted).toBe(true);
    expect(run2.result.durability.storageVersion).toBe(2);
    expect(run2.world.neonRow.storageVersion).toBe(2);
    expect(run2.result.view.snapshot_durability.storage_version).toBe(2);
    expect(run2.result.report!.detections).toEqual([]);
  });

  it('run 3 (the repository moved): durable claim DIVERGED, deployment claim ALIGNED, the honest detections fire', async () => {
    const run1 = await runPlane();
    await rerunPlane(run1);
    run1.clock.advance(60_000);
    const run3 = await rerunPlane(run1, { githubEvents: 'push-b', githubCi: 'success-b', branchProbe: 'head-b' });
    // the durable claim from run 2's snapshot (HEAD_A) vs the observed head (HEAD_B) — DIVERGED
    const mainFinding = run3.result.report!.findings.find((finding) => finding.subject === 'github:repo:payswapdotorg/SOS-2.0@main');
    expect(mainFinding?.kind).toBe('DIVERGED');
    expect(mainFinding?.claimedRevision).toBe(HEAD_A);
    expect(mainFinding?.observedRevision).toBe(HEAD_B);
    // the deployment claim (production at HEAD_A) reconciles ALIGNED — production did NOT move
    expect(run3.result.report!.findings.find((finding) => finding.subject === 'deploy:environment:production')?.kind).toBe('ALIGNED');
    // the deployment/source-SHA binding: DIVERGED (difference only)
    expect(run3.result.view.deployment_binding?.verdict).toBe('DIVERGED');
    expect(run3.result.view.deployment_binding?.source_revision_sha).toBe(HEAD_A);
    expect(run3.result.view.deployment_binding?.observed_repository_head).toBe(HEAD_B);
    // the honest detections
    const codes = run3.result.report!.detections.map((detection) => detection.code).sort();
    expect(codes).toEqual(['DEPLOYED_NOT_AT_HEAD', 'STATE_DIVERGED']);
    const deployedNotAtHead = run3.result.report!.detections.find((detection) => detection.code === 'DEPLOYED_NOT_AT_HEAD')!;
    expect(deployedNotAtHead.detail).toContain('ordering NOT asserted');
    // the DTO carries the findings + detections for the surface to render
    expect(run3.result.data.findings.map((finding) => finding.kind).sort()).toEqual(['ALIGNED', 'DIVERGED']);
    expect(run3.result.data.detections.map((detection) => detection.code).sort()).toEqual(['DEPLOYED_NOT_AT_HEAD', 'STATE_DIVERGED']);
    // the durable snapshot advances to the new head at version 3 (the NEXT reconciliation input)
    expect(run3.result.durability.storageVersion).toBe(3);
    expect(run3.world.neonRow.snapshot).toMatchObject({ observedHead: HEAD_B });
    assertValidLiveDataPlaneView(run3.result.view);
  });

  it('a failed durable write is honestly recorded (never fabricated persistence)', async () => {
    const run1 = await runPlane({ neonPut: 'fail' });
    expect(run1.result.selection.mode).toBe('PRODUCTION_DURABLE');
    expect(run1.result.durability.persisted).toBe(false);
    expect(run1.result.durability.note).toContain('failed with the real reason');
    expect(run1.result.view.snapshot_durability.persisted).toBe(false);
    expect(run1.result.view.snapshot_durability.storage_version).toBeNull();
    // the view still validates (production-durable store mode + honest not-persisted durability)
    assertValidLiveDataPlaneView(run1.result.view);
    // and the next request over the same world has NO durable claim (the write never landed — nothing fabricated)
    const run2 = await rerunPlane(run1);
    expect(run2.result.report!.findings.find((finding) => finding.subject.includes('@main'))).toBeUndefined();
  });
});
