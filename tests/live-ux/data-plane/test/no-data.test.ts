/**
 * P18-A deterministic reference-mode suite (5/6): the NO-DATA state.
 *
 * Every source ANSWERED (200) but the providers carry zero SOS-2.0
 * events: no pushes, no CI runs, no deployments. Pinned:
 *
 *   - the sources are honestly CONNECTED (the API answered) while the
 *     projections are honestly NO_DATA — the two are NEVER conflated
 *     (an answered empty provider is never an outage, and never data);
 *   - the DTO carries the honest NO_DATA everywhere, zero events,
 *     empty findings/detections (nothing fabricated);
 *   - the durable snapshot still persists (the durable record of
 *     "nothing observed at this instant" is honest durable evidence);
 *   - the deployment binding is NO_DEPLOYMENT (the provider answered;
 *     no sha-bound production deployment exists);
 *   - the producer signature sanity: the seam producer callable
 *     returns exactly this DTO shape.
 */

import { describe, expect, it } from 'vitest';
import { assertValidLiveDataPlaneView } from '@web-contracts/live';
import { emptyLiveObservation } from '@live-mission/dto';
import { runPlane } from './harness';

describe('the live data plane in the NO-DATA state (deterministic reference mode)', () => {
  const noData = {
    githubEvents: 'empty' as const,
    githubCi: 'empty' as const,
    branchProbe: 'empty' as const,
    harnessDeployment: 'empty' as const,
    observationDeployment: 'empty' as const,
    deploymentProbe: 'empty' as const,
  };

  it('distinguishes CONNECTED sources from NO_DATA projections (an answered empty provider is never an outage, and never data)', async () => {
    const { result } = await runPlane(noData);
    expect(result.data.drainedAt).not.toBeNull();
    const bySource = new Map(result.data.sources.map((source) => [source.source, source.state]));
    expect(bySource.get('github:rest-events:payswapdotorg/SOS-2.0')).toBe('CONNECTED');
    expect(bySource.get('ci:github-actions:payswapdotorg/SOS-2.0')).toBe('CONNECTED');
    expect(bySource.get('deploy:vercel')).toBe('CONNECTED');
    expect(result.data.repository.freshness).toBe('NO_DATA');
    expect(result.data.ci.freshness).toBe('NO_DATA');
    expect(result.data.deployments.freshness).toBe('NO_DATA');
  });

  it('carries the honest empty observation (nothing fabricated: no heads, no runs, no deployments, no findings)', async () => {
    const { result } = await runPlane(noData);
    // the repository/CI/deployment sources answered EMPTY (zero events applied by those families)
    const summaries = new Map(result.report!.sourceSummaries.map((summary) => [summary.source, summary]));
    expect(summaries.get('github:rest-events:payswapdotorg/SOS-2.0')?.applied).toBe(0);
    expect(summaries.get('ci:github-actions:payswapdotorg/SOS-2.0')?.applied).toBe(0);
    expect(summaries.get('deploy:vercel')?.applied).toBe(0);
    // only the provider-health probes produced events (their signals ARE real observation events)
    expect(result.data.eventsInWindow).toBe(result.report!.sourceSummaries.find((summary) => summary.source === 'provider-health:real-probes')?.applied ?? 0);
    expect(result.data.repository.branchHeads).toEqual([]);
    expect(result.data.repository.openPullRequests).toEqual([]);
    expect(result.data.ci.latestByPipeline).toEqual([]);
    expect(result.data.deployments.byEnvironment).toEqual([]);
    expect(result.data.findings).toEqual([]);
    expect(result.data.detections).toEqual([]);
    expect(result.data.providerHealth.length).toBeGreaterThan(0); // provider-health signals ARE data (the probes ran)
    expect(result.data.watchingWithoutBody).toBe(true);
  });

  it('persists the honest empty snapshot to the durable store (the durable record of "nothing observed")', async () => {
    const { result, world } = await runPlane(noData);
    expect(result.selection.mode).toBe('PRODUCTION_DURABLE');
    expect(result.durability.persisted).toBe(true);
    expect(result.durability.storageVersion).toBe(1);
    expect(world.neonRow.snapshot).toMatchObject({ observedHead: null, storeMode: 'PRODUCTION_DURABLE' });
  });

  it('binds NO_DEPLOYMENT (the provider answered; no sha-bound production deployment exists)', async () => {
    const { result } = await runPlane(noData);
    expect(result.view.deployment_binding?.verdict).toBe('NO_DEPLOYMENT');
    expect(result.view.deployment_binding?.deployment_id).toBeNull();
    expect(result.view.deployment_binding?.source_revision_sha).toBeNull();
    assertValidLiveDataPlaneView(result.view);
    const provenance = new Map(result.view.provenance.map((entry) => [entry.field, entry]));
    expect(provenance.get('deployments.byEnvironment')).toMatchObject({ state: 'CONNECTED', freshness: 'NO_DATA' });
    expect(provenance.get('deployments.byEnvironment')!.note).toContain('NO_DATA: absence of observation is never success');
  });

  it('renders the same honest structure as the seam default empty state (the P17-C contract shape)', async () => {
    const { result } = await runPlane(noData);
    // the P17-C honest empty state (what the seam renders unwired) — the same field families, honestly NO_DATA
    const empty = emptyLiveObservation('reference:in-memory-observation-store', result.data.asOf, 'github:repo:payswapdotorg/SOS-2.0');
    expect(Object.keys(empty).sort()).toEqual(Object.keys(result.data).sort());
    expect(result.data.repository.subject).toBe(empty.repository.subject);
    expect(result.data.repository.freshness).toBe(empty.repository.freshness);
  });
});
