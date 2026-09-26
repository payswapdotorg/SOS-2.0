/**
 * P18-A deterministic reference-mode suite (1/6): the CONNECTED store.
 *
 * The canonical Neon store answered its REAL probe (scripted 200 SQL
 * ping), Upstash answered (PONG), the Vercel deployment-state read
 * succeeded, GitHub/CI/deployment observation flowed — the data plane
 * selects PRODUCTION_DURABLE, persists the observation snapshot to the
 * canonical store (putRow + read-back at the EXACT storage version),
 * and EVERY live-mission DTO field carries provenance. Pinned:
 *
 *   - the store selection (mode, storeRef, never-canonical note);
 *   - the honest source states (all probed sources CONNECTED);
 *   - the observation projection (head, CI status verbatim, deployment
 *     revision, freshness FRESH, events in window);
 *   - the durability binding (namespace, storage version 1, read-back);
 *   - the deployment/source-SHA binding VERIFIED (the deployed sha IS
 *     the observed head);
 *   - the per-field provenance matrix (DURABLE_CANONICAL store entries);
 *   - the fail-closed view validation + serializability.
 */

import { describe, expect, it } from 'vitest';
import { assertValidLiveDataPlaneView } from '@web-contracts/live';
import { runPlane } from './harness';
import { HEAD_A } from './world';

describe('the live data plane with a CONNECTED store (deterministic reference mode)', () => {
  it('selects PRODUCTION_DURABLE from the real probe and never promotes the coordination store', async () => {
    const { result } = await runPlane();
    expect(result.selection.mode).toBe('PRODUCTION_DURABLE');
    expect(result.selection.canonical.state).toBe('CONNECTED');
    expect(result.selection.canonical.provider).toBe('neon');
    expect(result.selection.storeRef).toBe('neon:postgres:sos@main');
    expect(result.selection.coordination.provider).toBe('upstash');
    expect(result.selection.coordination.state).toBe('CONNECTED');
    expect(result.selection.coordination.neverCanonicalNote).toContain('never the canonical store');
    expect(result.unwired).toBe(false);
    expect(result.missingEnv).toEqual([]);
  });

  it('serves the live-mission DTO from the durable storeRef with honest source states', async () => {
    const { result } = await runPlane();
    expect(result.data.storeRef).toBe('neon:postgres:sos@main');
    expect(result.data.drainedAt).not.toBeNull();
    expect(result.data.asOf).toBe('2026-09-25T12:00:00.000Z');
    const bySource = new Map(result.data.sources.map((source) => [source.source, source.state]));
    expect(bySource.get('github:rest-events:payswapdotorg/SOS-2.0')).toBe('CONNECTED');
    expect(bySource.get('ci:github-actions:payswapdotorg/SOS-2.0')).toBe('CONNECTED');
    expect(bySource.get('deploy:vercel')).toBe('CONNECTED');
    expect(bySource.get('provider-health:real-probes')).toBe('CONNECTED');
    // every source carries probe evidence (apiRevision + lastProbedAt)
    for (const source of result.data.sources) {
      expect(source.lastProbedAt).not.toBeNull();
    }
    expect(result.data.sources.find((source) => source.family === 'github')?.apiRevision).toContain('github.v3');
  });

  it('projects the real observation: head, CI status verbatim, deployment revision, freshness', async () => {
    const { result } = await runPlane();
    expect(result.data.repository.subject).toBe('github:repo:payswapdotorg/SOS-2.0');
    expect(result.data.repository.branchHeads).toHaveLength(1);
    expect(result.data.repository.branchHeads[0]).toMatchObject({ branch: 'main', head: HEAD_A });
    expect(result.data.repository.branchHeads[0]!.evidenceEventIds.length).toBeGreaterThan(0);
    expect(result.data.repository.freshness).toBe('FRESH');
    expect(result.data.ci.latestByPipeline.length).toBeGreaterThan(0);
    expect(result.data.ci.latestByPipeline[0]).toMatchObject({ pipeline: 'repository-contract', ref: HEAD_A, status: 'SUCCESS' });
    expect(result.data.ci.freshness).toBe('FRESH');
    expect(result.data.deployments.byEnvironment).toEqual([expect.objectContaining({ environment: 'production', revision: HEAD_A })]);
    expect(result.data.deployments.freshness).toBe('FRESH');
    expect(result.data.eventsInWindow).toBeGreaterThan(0);
    expect(result.data.watchingWithoutBody).toBe(true);
  });

  it('persists the observation snapshot to the canonical store and reads it back at the exact storage version', async () => {
    const { result, world } = await runPlane();
    expect(result.durability.persisted).toBe(true);
    expect(result.durability.namespace).toBe('live-mission/observation');
    expect(result.durability.storageVersion).toBe(1);
    expect(result.durability.note).toContain('storage version 1');
    // the durable write + the read-back really happened on the wire
    expect(world.counts['neon:putRow']).toBe(1);
    expect(world.counts['neon:getRow']).toBe(2);
    // the persisted row carries the observed head
    expect(world.neonRow.snapshot).toMatchObject({ observedHead: HEAD_A, storeMode: 'PRODUCTION_DURABLE', storeRef: 'neon:postgres:sos@main' });
  });

  it('binds the deployment to the observed source revision (VERIFIED) and carries provider rows', async () => {
    const { result } = await runPlane();
    expect(result.view.deployment_binding?.verdict).toBe('VERIFIED');
    expect(result.view.deployment_binding?.source_revision_sha).toBe(HEAD_A);
    expect(result.view.deployment_binding?.observed_repository_head).toBe(HEAD_A);
    const rows = new Map(result.view.providers.map((row) => [row.provider, row]));
    expect(rows.get('neon')).toMatchObject({ role: 'durable-canonical-state', state: 'CONNECTED' });
    expect(rows.get('upstash')).toMatchObject({ role: 'coordination-only-never-canonical', state: 'CONNECTED' });
    expect(rows.get('vercel')).toMatchObject({ role: 'deployment', state: 'CONNECTED' });
  });

  it('carries the per-field provenance matrix with DURABLE_CANONICAL store provenance', async () => {
    const { result } = await runPlane();
    const provenance = new Map(result.view.provenance.map((entry) => [entry.field, entry]));
    expect(provenance.get('storeRef')).toMatchObject({ store_kind: 'DURABLE_CANONICAL', state: 'CONNECTED', revision: 'neon:postgres:sos@main' });
    expect(provenance.get('repository.branchHeads')).toMatchObject({ state: 'CONNECTED', freshness: 'FRESH', revision: HEAD_A });
    expect(provenance.get('ci.latestByPipeline')).toMatchObject({ state: 'CONNECTED', freshness: 'FRESH' });
    expect(provenance.get('deployments.byEnvironment')).toMatchObject({ state: 'CONNECTED', freshness: 'FRESH' });
    expect(provenance.get('deployments.sourceRevisionShaBinding')).toMatchObject({ store_kind: 'PROVIDER_READ', state: 'CONNECTED' });
    expect(provenance.get('findings')).toMatchObject({ store_kind: 'OBSERVATION_PLANE' });
  });

  it('validates fail-closed and serializes across the boundary (plain JSON)', async () => {
    const { result } = await runPlane();
    assertValidLiveDataPlaneView(result.view);
    const serialized = JSON.parse(JSON.stringify(result.view));
    expect(serialized.store.mode).toBe('PRODUCTION_DURABLE');
    expect(serialized.snapshot_durability.storage_version).toBe(1);
    const serializedData = JSON.parse(JSON.stringify(result.data));
    expect(serializedData.repository.branchHeads[0].head).toBe(HEAD_A);
  });

  it('is deterministic: same scripted world -> deep-equal results', async () => {
    const first = await runPlane();
    const second = await runPlane();
    expect(second.result.data).toEqual(first.result.data);
    expect(second.result.view).toEqual(first.result.view);
    expect(second.result.durability).toEqual(first.result.durability);
  });
});
