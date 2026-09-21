/**
 * Authority gate tests (Work Order P5): current-grant-head resolution over
 * the durable P2 grant repository and per-operation re-evaluation through
 * @sos-2/authority's evaluateGrant (the W12 pattern).
 */

import { describe, expect, it } from 'vitest';
import { createGrant, revokeGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import { evaluateTaskAuthority, resolveCurrentGrantHead } from '../src/index.js';

const T0 = Date.parse('2026-01-15T09:00:00Z');
const LATER = Date.parse('2026-01-15T12:00:00Z');

function liveGrant(expiresAtEpochMs: number, grantee = 'spirit:persistent'): AuthorityGrantArtifact {
  return createGrant({
    grantee,
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(expiresAtEpochMs) },
    provenance: ['p5-authority-gate-test'],
    created_at: formatRfc3339(T0),
    status: 'ACTIVE',
  });
}

describe('current-grant-head resolution over the durable store', () => {
  it('resolves a stored grant without successors to itself', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(T0) });
    const grant = liveGrant(T0 + 3_600_000);
    await store.authorityGrants.put(grant);
    const head = await resolveCurrentGrantHead(store.authorityGrants, grant.envelope.id);
    expect(head?.envelope.id).toBe(grant.envelope.id);
  });

  it('follows a revocation successor to the CURRENT head (the revoked revision, not the stale one)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(T0) });
    const grant = liveGrant(T0 + 3_600_000);
    await store.authorityGrants.put(grant);
    const revoked = revokeGrant(grant, {
      at: { kind: 'TIME', now: formatRfc3339(T0 + 1_000) },
      provenance: ['security-incident'],
      created_at: formatRfc3339(T0 + 1_000),
    });
    await store.authorityGrants.put(revoked);

    // Resolving the ORIGINAL reference finds the revoked head.
    const head = await resolveCurrentGrantHead(store.authorityGrants, grant.envelope.id);
    expect(head?.envelope.id).toBe(revoked.envelope.id);
    expect(head?.content.revoked_at).not.toBeNull();
  });

  it('an unknown reference resolves to nothing (a minted grant ref authorizes nothing)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(T0) });
    const head = await resolveCurrentGrantHead(store.authorityGrants, `sos://AuthorityGrant/${'f'.repeat(32)}`);
    expect(head).toBeUndefined();
  });
});

describe('the task authority gate (evaluateGrant consumed, W12 pattern)', () => {
  it('a live grant authorizes', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(T0) });
    const grant = liveGrant(T0 + 3_600_000);
    await store.authorityGrants.put(grant);
    const outcome = await evaluateTaskAuthority(store.authorityGrants, [grant.envelope.id], T0, 'task-0001');
    expect(outcome.status).toBe('VALID');
    if (outcome.status === 'VALID') {
      expect(outcome.grants).toHaveLength(1);
    }
  });

  it('an EXPIRED grant denies with the typed code (never authorizes)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(T0) });
    const grant = liveGrant(T0 + 60_000);
    await store.authorityGrants.put(grant);
    const outcome = await evaluateTaskAuthority(store.authorityGrants, [grant.envelope.id], T0 + 61_000, 'task-0001');
    expect(outcome.status).toBe('DENIED');
    if (outcome.status === 'DENIED') {
      expect(outcome.denial.code).toBe('AUTHORITY_GRANT_EXPIRED');
      expect(outcome.denial.grant_ref).toBe(grant.envelope.id);
    }
  });

  it('a REVOKED grant (revocation recorded as a successor revision) denies at the CURRENT head', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(T0) });
    const grant = liveGrant(T0 + 3_600_000);
    await store.authorityGrants.put(grant);
    const revoked = revokeGrant(grant, {
      at: { kind: 'TIME', now: formatRfc3339(T0 + 1_000) },
      provenance: ['security-incident'],
      created_at: formatRfc3339(T0 + 1_000),
    });
    await store.authorityGrants.put(revoked);
    // The task references the ORIGINAL grant id; the gate resolves the
    // current (revoked) head and denies.
    const outcome = await evaluateTaskAuthority(store.authorityGrants, [grant.envelope.id], LATER, 'task-0001');
    expect(outcome.status).toBe('DENIED');
    if (outcome.status === 'DENIED') {
      expect(outcome.denial.code).toBe('AUTHORITY_GRANT_REVOKED');
    }
  });

  it('a missing grant reference denies — grants resolve from the durable store ONLY', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(T0) });
    const outcome = await evaluateTaskAuthority(store.authorityGrants, [`sos://AuthorityGrant/${'a'.repeat(32)}`], T0, 'task-0001');
    expect(outcome.status).toBe('DENIED');
    if (outcome.status === 'DENIED') {
      expect(outcome.denial.code).toBe('AUTHORITY_GRANT_MISSING');
    }
  });

  it('no grant references at all denies (consequential operations require authority)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(T0) });
    const outcome = await evaluateTaskAuthority(store.authorityGrants, [], T0, 'task-0001');
    expect(outcome.status).toBe('DENIED');
    if (outcome.status === 'DENIED') {
      expect(outcome.denial.code).toBe('AUTHORITY_GRANT_ABSENT');
    }
  });

  it('a stored grant that cannot be evaluated at a time point denies as INVALID (indeterminacy is never VALID)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(T0) });
    // A REVISION-bound grant evaluated against the clock is INDETERMINATE
    // in @sos-2/authority's evaluateGrant — the gate maps the loud
    // evaluation failure to the typed AUTHORITY_GRANT_INVALID denial.
    const revisionBound = createGrant({
      grantee: 'spirit:persistent',
      scope: { kind: 'KIND', artifact_kind: 'Mission' },
      permissions: ['READ'],
      expiry: { kind: 'REVISION', artifact_id: `sos://Mission/${'c'.repeat(32)}`, max_version: 3 },
      provenance: ['p5-authority-gate-test'],
      created_at: formatRfc3339(T0),
      status: 'ACTIVE',
    });
    await store.authorityGrants.put(revisionBound);
    const outcome = await evaluateTaskAuthority(store.authorityGrants, [revisionBound.envelope.id], T0, 'task-0001');
    expect(outcome.status).toBe('DENIED');
    if (outcome.status === 'DENIED') {
      expect(outcome.denial.code).toBe('AUTHORITY_GRANT_INVALID');
      expect(outcome.denial.reason).toContain('indeterminate evaluation');
    }
  });
});
