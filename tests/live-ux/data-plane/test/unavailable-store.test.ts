/**
 * P18-A deterministic reference-mode suite (2/6): the UNAVAILABLE store.
 *
 * The canonical Neon store is DNS-unreachable (the scripted transport
 * failure — the exact shape of today's real api.neon.tech NODATA) and
 * the Upstash REST host is NXDOMAIN. Pinned:
 *
 *   - honest UNAVAILABLE states with the REAL failure facts recorded
 *     verbatim (never silence, never fabricated success);
 *   - the explicit REFERENCE_FALLBACK mode: storeRef carries the
 *     'reference:' marker, the degradation note carries the DNS fact;
 *   - the observation STILL drains (GitHub/Vercel are independent
 *     providers — partial availability never blocks the whole plane);
 *   - NOTHING is persisted in reference mode (no durable write is even
 *     attempted — machine-checked by the request counts);
 *   - the view validates fail-closed with the reference separation;
 *   - the provenance matrix marks store-served fields
 *     REFERENCE_IN_MEMORY with the real reason.
 */

import { describe, expect, it } from 'vitest';
import { assertValidLiveDataPlaneView, isReferenceStoreRef } from '@web-contracts/live';
import { runPlane } from './harness';
import { HEAD_A } from './world';

describe('the live data plane with an UNAVAILABLE store (deterministic reference mode)', () => {
  it('records honest UNAVAILABLE states with the real DNS facts (Neon NODATA + Upstash NXDOMAIN)', async () => {
    const { result } = await runPlane({ neonProbe: 'dns-fail', upstashProbe: 'nxdomain' });
    expect(result.selection.mode).toBe('REFERENCE_FALLBACK');
    expect(result.selection.canonical.state).toBe('UNAVAILABLE');
    expect(result.selection.canonical.lastError).toContain('getaddrinfo ENOTFOUND ep-scripted-pooler.us-east-1.aws.neon.tech');
    expect(result.selection.canonical.detail).toContain('transport failure');
    expect(result.selection.coordination.state).toBe('UNAVAILABLE');
    expect(result.selection.coordination.lastError).toContain('NXDOMAIN');
    expect(result.selection.storeRef).toBe('reference:in-memory-observation-store');
    expect(isReferenceStoreRef(result.selection.storeRef)).toBe(true);
  });

  it('serves the live-mission DTO from the EXPLICIT reference store identity (never masquerading as production durable state)', async () => {
    const { result } = await runPlane({ neonProbe: 'dns-fail', upstashProbe: 'nxdomain' });
    expect(result.data.storeRef).toBe('reference:in-memory-observation-store');
    expect(result.data.storeRef.startsWith('reference:')).toBe(true);
    expect(result.data.storeRef).not.toContain('neon');
    // the observation still drained — partial availability is honest, not all-or-nothing
    expect(result.data.drainedAt).not.toBeNull();
    expect(result.data.repository.branchHeads[0]!.head).toBe(HEAD_A);
    expect(result.data.repository.freshness).toBe('FRESH');
    const bySource = new Map(result.data.sources.map((source) => [source.source, source.state]));
    expect(bySource.get('github:rest-events:payswapdotorg/SOS-2.0')).toBe('CONNECTED');
    expect(bySource.get('deploy:vercel')).toBe('CONNECTED');
  });

  it('persists NOTHING in reference mode (no durable write is even attempted)', async () => {
    const { result, world } = await runPlane({ neonProbe: 'dns-fail', upstashProbe: 'nxdomain' });
    expect(result.durability.persisted).toBe(false);
    expect(result.durability.storageVersion).toBeNull();
    expect(result.durability.note).toContain('NOT persisted');
    expect(world.counts['neon:probe']).toBe(1);
    expect(world.counts['neon:putRow']).toBeUndefined();
    expect(world.counts['neon:getRow']).toBeUndefined();
    expect(world.neonRow.present).toBe(false);
  });

  it('carries the degradation reason + the provider rows honestly (Vercel connected, Neon/Upstash down)', async () => {
    const { result } = await runPlane({ neonProbe: 'dns-fail', upstashProbe: 'nxdomain' });
    assertValidLiveDataPlaneView(result.view);
    expect(result.view.store.mode).toBe('REFERENCE_FALLBACK');
    expect(result.view.store.reference_mode).toBe(true);
    expect(result.view.store.degradation_note).toContain('UNAVAILABLE');
    expect(result.view.store.degradation_note).toContain('getaddrinfo ENOTFOUND ep-scripted-pooler.us-east-1.aws.neon.tech');
    expect(result.view.store.degradation_note).toContain('explicitly NOT production durable state');
    expect(result.view.store.coordination_note).toContain('never the canonical store');
    const rows = new Map(result.view.providers.map((row) => [row.provider, row]));
    expect(rows.get('neon')?.state).toBe('UNAVAILABLE');
    expect(rows.get('upstash')?.state).toBe('UNAVAILABLE');
    expect(rows.get('vercel')?.state).toBe('CONNECTED');
  });

  it('marks the store-served provenance fields REFERENCE_IN_MEMORY with the real reason', async () => {
    const { result } = await runPlane({ neonProbe: 'dns-fail', upstashProbe: 'nxdomain' });
    const storeRefEntry = result.view.provenance.find((entry) => entry.field === 'storeRef')!;
    expect(storeRefEntry.store_kind).toBe('REFERENCE_IN_MEMORY');
    expect(storeRefEntry.state).toBe('UNAVAILABLE');
    expect(storeRefEntry.revision).toBe('reference:in-memory-observation-store');
    expect(storeRefEntry.note).toContain('getaddrinfo ENOTFOUND');
    expect(storeRefEntry.note).toContain('explicitly NOT production durable state');
    // the observation fields still carry their own honest connected provenance
    const repositoryEntry = result.view.provenance.find((entry) => entry.field === 'repository.branchHeads')!;
    expect(repositoryEntry.state).toBe('CONNECTED');
    expect(repositoryEntry.freshness).toBe('FRESH');
  });

  it('still binds the deployment to the observed source revision (partial availability: the binding works on the connected providers)', async () => {
    const { result } = await runPlane({ neonProbe: 'dns-fail', upstashProbe: 'nxdomain' });
    expect(result.view.deployment_binding?.verdict).toBe('VERIFIED');
    expect(result.view.deployment_binding?.source_revision_sha).toBe(HEAD_A);
    expect(result.view.snapshot_durability.persisted).toBe(false);
    expect(JSON.parse(JSON.stringify(result.view)).store.store_ref).toBe('reference:in-memory-observation-store');
  });
});
