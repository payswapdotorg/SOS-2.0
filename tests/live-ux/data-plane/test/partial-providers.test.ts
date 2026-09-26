/**
 * P18-A deterministic reference-mode suite (4/6): PARTIAL providers.
 *
 * GitHub repository events are connected while CI polling fails
 * (transport), the observation-plane Vercel source fails, the scheduled
 * probes fail, Upstash is NXDOMAIN — and Neon + the harness
 * deployment-state read still work. Partial availability never blocks
 * the plane and never fabricates the missing pieces. Pinned:
 *
 *   - per-source honest states (connected sources CONNECTED with data;
 *     failed sources UNAVAILABLE with the real reason);
 *   - the repository projection has data while CI/deployments are
 *     NO_DATA (absence of observation is never success);
 *   - the durable store still selects PRODUCTION_DURABLE (Neon is an
 *     independent provider);
 *   - the deployment binding compares the CONNECTED provider read
 *     against the observed head — the diverged verdict carried honestly
 *     with per-field states;
 *   - the provenance matrix carries the per-field honest states
 *     (repository CONNECTED/FRESH; ci UNAVAILABLE; deployments
 *     UNAVAILABLE; binding PROVIDER_READ/CONNECTED).
 */

import { describe, expect, it } from 'vitest';
import { assertValidLiveDataPlaneView } from '@web-contracts/live';
import { runPlane } from './harness';
import { HEAD_A, HEAD_B } from './world';

describe('the live data plane with PARTIAL providers (deterministic reference mode)', () => {
  const partial = {
    githubCi: 'fail' as const,
    observationDeployment: 'fail' as const,
    deploymentProbe: 'fail' as const,
    harnessDeployment: 'other' as const,
    upstashProbe: 'nxdomain' as const,
  };

  it('records per-source honest states — connected sources CONNECTED, failed sources UNAVAILABLE with the real reason', async () => {
    const { result } = await runPlane(partial);
    const bySource = new Map(result.data.sources.map((source) => [source.source, source.state]));
    expect(bySource.get('github:rest-events:payswapdotorg/SOS-2.0')).toBe('CONNECTED');
    expect(bySource.get('ci:github-actions:payswapdotorg/SOS-2.0')).toBe('UNAVAILABLE');
    expect(bySource.get('deploy:vercel')).toBe('UNAVAILABLE');
    expect(bySource.get('upstash:redis')).toBe('UNAVAILABLE');
    const ciSource = result.data.sources.find((source) => source.source.startsWith('ci:github-actions'))!;
    expect(ciSource.lastError).toContain('ETIMEDOUT');
    const vercelSource = result.data.sources.find((source) => source.source === 'deploy:vercel')!;
    expect(vercelSource.lastError).toContain('ETIMEDOUT');
  });

  it('projects the connected data while the missing families are honestly NO_DATA (never fabricated)', async () => {
    const { result } = await runPlane(partial);
    expect(result.data.repository.branchHeads[0]!.head).toBe(HEAD_A);
    expect(result.data.repository.freshness).toBe('FRESH');
    expect(result.data.ci.latestByPipeline).toEqual([]);
    expect(result.data.ci.freshness).toBe('NO_DATA');
    expect(result.data.deployments.byEnvironment).toEqual([]);
    expect(result.data.deployments.freshness).toBe('NO_DATA');
  });

  it('keeps the durable-store selection independent (Neon connected through the partial outage)', async () => {
    const { result } = await runPlane(partial);
    expect(result.selection.mode).toBe('PRODUCTION_DURABLE');
    expect(result.selection.canonical.state).toBe('CONNECTED');
    expect(result.selection.coordination.state).toBe('UNAVAILABLE');
    expect(result.durability.persisted).toBe(true);
    expect(result.durability.storageVersion).toBe(1);
  });

  it('carries the diverged deployment binding honestly (the connected read vs the observed head)', async () => {
    const { result } = await runPlane(partial);
    // the harness deployment read SUCCEEDED (a different, connected route) and shows production at HEAD_B
    expect(result.deploymentRead.state).toBe('CONNECTED');
    expect(result.deploymentRead.latestByTarget['production']?.commitSha).toBe(HEAD_B);
    // the observed repository head is HEAD_A -> the binding verdict is DIVERGED (difference only, ordering never claimed)
    expect(result.view.deployment_binding?.verdict).toBe('DIVERGED');
    expect(result.view.deployment_binding?.source_revision_sha).toBe(HEAD_B);
    expect(result.view.deployment_binding?.observed_repository_head).toBe(HEAD_A);
    expect(result.view.deployment_binding?.note).toContain('difference only, ordering is never claimed');
  });

  it('carries the per-field honest states in the provenance matrix (the partial-outage truth)', async () => {
    const { result } = await runPlane(partial);
    assertValidLiveDataPlaneView(result.view);
    const provenance = new Map(result.view.provenance.map((entry) => [entry.field, entry]));
    expect(provenance.get('repository.branchHeads')).toMatchObject({ state: 'CONNECTED', freshness: 'FRESH' });
    expect(provenance.get('ci.latestByPipeline')).toMatchObject({ state: 'UNAVAILABLE', freshness: 'NO_DATA' });
    expect(provenance.get('deployments.byEnvironment')).toMatchObject({ state: 'UNAVAILABLE', freshness: 'NO_DATA' });
    expect(provenance.get('deployments.byEnvironment')!.note).toContain('NO_DATA: absence of observation is never success');
    expect(provenance.get('deployments.sourceRevisionShaBinding')).toMatchObject({ store_kind: 'PROVIDER_READ', state: 'CONNECTED' });
    const rows = new Map(result.view.providers.map((row) => [row.provider, row]));
    expect(rows.get('vercel')?.state).toBe('CONNECTED');
    expect(rows.get('upstash')?.state).toBe('UNAVAILABLE');
    expect(rows.get('neon')?.state).toBe('CONNECTED');
  });

  it('the production claim stays UNVERIFIED while the deployment observation path is down (never reconciled on the read path alone)', async () => {
    const { result } = await runPlane(partial);
    const productionFinding = result.report!.findings.find((finding) => finding.subject === 'deploy:environment:production');
    expect(productionFinding?.kind).toBe('UNVERIFIED');
    expect(productionFinding?.observedRevision).toBeNull();
  });
});
