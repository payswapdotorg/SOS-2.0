/**
 * P18-A deterministic reference-mode suite (3/6): STALE observations.
 *
 * The observation data answered, but every event is older than the
 * freshness window (freshAfterMs 60s; data 2h old; the scheduled
 * repo-head probe failed honestly so nothing freshens the projection).
 * Pinned:
 *
 *   - repository/CI/deployments projections report STALE (never
 *     folded into FRESH or success notes);
 *   - the DTO freshness fields carry STALE end-to-end;
 *   - a STALE reconciliation finding is its own truthful kind (STALE
 *     is NEVER reported as ALIGNED — the core discipline);
 *   - the provenance matrix carries the STALE freshness with the
 *     explicit note;
 *   - the durable store itself can still be CONNECTED (staleness of
 *     OBSERVATION is independent of store connectivity).
 */

import { describe, expect, it } from 'vitest';
import { assertValidLiveDataPlaneView } from '@web-contracts/live';
import { runPlane } from './harness';
import { HEAD_A } from './world';

describe('the live data plane with STALE observations (deterministic reference mode)', () => {
  const stale = { dataAgeMs: 2 * 60 * 60 * 1000, branchProbe: 'fail' as const, ciProbe: 'fail' as const, deploymentProbe: 'fail' as const };

  it('reports STALE freshness on every observation family (never folded into success)', async () => {
    const { result } = await runPlane(stale, { freshAfterMs: 60_000 });
    expect(result.data.repository.freshness).toBe('STALE');
    expect(result.data.ci.freshness).toBe('STALE');
    expect(result.data.deployments.freshness).toBe('STALE');
    expect(result.data.repository.branchHeads[0]).toMatchObject({ branch: 'main', head: HEAD_A, freshness: 'STALE' });
  });

  it('reports a STALE reconciliation finding — STALE is never ALIGNED', async () => {
    const { result } = await runPlane(stale, { freshAfterMs: 60_000 });
    // the production claim exists (the deployment record) and an observation exists but is older than the window
    const productionFinding = result.report!.findings.find((finding) => finding.subject === 'deploy:environment:production');
    expect(productionFinding?.kind).toBe('STALE');
    expect(productionFinding?.observedRevision).toBe(HEAD_A);
    const aligned = result.report!.findings.filter((finding) => finding.kind === 'ALIGNED');
    expect(aligned).toEqual([]);
    const dtoFinding = result.data.findings.find((finding) => finding.subject === 'deploy:environment:production');
    expect(dtoFinding?.kind).toBe('STALE');
  });

  it('carries the STALE freshness into the provenance matrix with the explicit note', async () => {
    const { result } = await runPlane(stale, { freshAfterMs: 60_000 });
    const repositoryEntry = result.view.provenance.find((entry) => entry.field === 'repository.branchHeads')!;
    expect(repositoryEntry.freshness).toBe('STALE');
    expect(repositoryEntry.note).toContain('STALE: older than the freshness window');
    const ciEntry = result.view.provenance.find((entry) => entry.field === 'ci.latestByPipeline')!;
    expect(ciEntry.freshness).toBe('STALE');
    const deploymentsEntry = result.view.provenance.find((entry) => entry.field === 'deployments.byEnvironment')!;
    expect(deploymentsEntry.freshness).toBe('STALE');
  });

  it('keeps the durable store connectivity independent of observation staleness (honest separation)', async () => {
    const { result } = await runPlane(stale, { freshAfterMs: 60_000 });
    expect(result.selection.mode).toBe('PRODUCTION_DURABLE');
    expect(result.selection.canonical.state).toBe('CONNECTED');
    expect(result.durability.persisted).toBe(true);
    assertValidLiveDataPlaneView(result.view);
    expect(result.view.store.mode).toBe('PRODUCTION_DURABLE');
    expect(result.view.provenance.find((entry) => entry.field === 'storeRef')?.store_kind).toBe('DURABLE_CANONICAL');
  });

  it('the failed scheduled probes are recorded honestly (UNAVAILABLE sources; never a fabricated refresh)', async () => {
    const { result } = await runPlane(stale, { freshAfterMs: 60_000 });
    const probeSource = result.data.sources.find((source) => source.source.startsWith('scheduled-probe:probe-repo-head'));
    expect(probeSource?.state).toBe('UNAVAILABLE');
    expect(probeSource?.lastError).toContain('ETIMEDOUT');
    const ciProbeSource = result.data.sources.find((source) => source.source.startsWith('scheduled-probe:probe-ci-latest'));
    expect(ciProbeSource?.state).toBe('UNAVAILABLE');
  });
});
