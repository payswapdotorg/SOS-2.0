/**
 * Composed workflow: authority-controlled mission revision.
 *
 * @sos-2/mission requires an AuthorityGrant REFERENCE for revision and
 * validates its form. Deep grant semantics (validity, expiry, revocation,
 * scope, permission) live in @sos-2/authority — this test composes the two
 * packages exactly as the governing model intends (spec/architecture.md §3:
 * "Mission revision is explicit, versioned and authority-controlled").
 *
 * NOTE: this is a TEST-ONLY dependency (devDependency); the runtime
 * dependency surface of @sos-2/mission remains @sos-2/semantic-spine only.
 */

import { describe, expect, it } from 'vitest';
import { authorize, canAuthorize, createGrant, revokeGrant } from '@sos-2/authority';
import { MissionStore, createMission } from '../src/index.js';
import { CONSTITUTION_ANCHOR_ID, PROVENANCE, T0, T1, sampleMissionContent } from './helpers.js';

const NOW = T0;
const LATER = '2025-06-01T00:00:00.000Z';
const AFTER_EXPIRY = '2025-07-01T00:00:00.000Z';

function activeStoreWithMission(): { store: MissionStore; missionId: string } {
  const store = new MissionStore();
  const mission = store.put(
    createMission({
      content: sampleMissionContent(),
      provenance: PROVENANCE,
      created_at: T0,
      authority_ref: CONSTITUTION_ANCHOR_ID,
      status: 'ACTIVE',
    }),
  );
  return { store, missionId: mission.envelope.id };
}

describe('composed workflow: mission revision is authority-controlled', () => {
  it('a VALID, in-scope, REVISE-permitted grant authorizes a mission revision', () => {
    const { store, missionId } = activeStoreWithMission();
    const grant = createGrant({
      grantee: 'platform-architect',
      scope: { kind: 'ARTIFACT', artifact_id: missionId },
      permissions: ['REVISE'],
      expiry: { kind: 'TIME', at: LATER },
      provenance: PROVENANCE,
      created_at: NOW,
      authority_ref: CONSTITUTION_ANCHOR_ID,
    });

    expect(canAuthorize(grant, { action: 'REVISE', target: { kind: 'ARTIFACT', artifact_id: missionId }, at: { kind: 'TIME', now: T1 } })).toBe(true);
    const checked = authorize(grant, {
      action: 'REVISE',
      target: { kind: 'ARTIFACT', artifact_id: missionId },
      at: { kind: 'TIME', now: T1 },
    });
    expect(checked.envelope.id).toBe(grant.envelope.id);

    const result = store.revise(missionId, {
      content: sampleMissionContent(),
      authority_grant: grant.envelope.id,
      provenance: [...PROVENANCE, 'authorized-by-grant'],
      created_at: T1,
    });
    expect(result.revised.envelope.authority_ref).toBe(grant.envelope.id);
    expect(result.revised.envelope.version).toBe(2);
  });

  it('an expired grant never authorizes: the composed workflow rejects before revision', () => {
    const { store, missionId } = activeStoreWithMission();
    const grant = createGrant({
      grantee: 'platform-architect',
      scope: { kind: 'ARTIFACT', artifact_id: missionId },
      permissions: ['REVISE'],
      expiry: { kind: 'TIME', at: LATER },
      provenance: PROVENANCE,
      created_at: NOW,
    });
    expect(() =>
      authorize(grant, {
        action: 'REVISE',
        target: { kind: 'ARTIFACT', artifact_id: missionId },
        at: { kind: 'TIME', now: AFTER_EXPIRY },
      }),
    ).toThrow(/EXPIRED/);
    // the mission store still demands a well-formed grant reference; the
    // expired grant is therefore never usable in the composed workflow
    expect(canAuthorize(grant, {
      action: 'REVISE',
      target: { kind: 'ARTIFACT', artifact_id: missionId },
      at: { kind: 'TIME', now: AFTER_EXPIRY },
    })).toBe(false);
  });

  it('a revoked grant never authorizes', () => {
    const { missionId } = activeStoreWithMission();
    const grant = createGrant({
      grantee: 'platform-architect',
      scope: { kind: 'ARTIFACT', artifact_id: missionId },
      permissions: ['REVISE'],
      expiry: { kind: 'TIME', at: LATER },
      provenance: PROVENANCE,
      created_at: NOW,
    });
    const revoked = revokeGrant(grant, {
      at: { kind: 'TIME', now: T1 },
      provenance: [...PROVENANCE, 'revoked-in-test'],
      created_at: T1,
    });
    expect(() =>
      authorize(revoked, {
        action: 'REVISE',
        target: { kind: 'ARTIFACT', artifact_id: missionId },
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(/REVOKED/);
  });

  it('a scope violation fails loudly (grant scoped to a different artifact)', () => {
    const { missionId } = activeStoreWithMission();
    const grant = createGrant({
      grantee: 'auditor',
      scope: { kind: 'ARTIFACT', artifact_id: `sos://Mission/${'d'.repeat(32)}` },
      permissions: ['REVISE'],
      expiry: { kind: 'TIME', at: LATER },
      provenance: PROVENANCE,
      created_at: NOW,
    });
    expect(() =>
      authorize(grant, {
        action: 'REVISE',
        target: { kind: 'ARTIFACT', artifact_id: missionId },
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(/scope violation/);
  });

  it('a missing permission fails loudly (grant without REVISE)', () => {
    const { missionId } = activeStoreWithMission();
    const grant = createGrant({
      grantee: 'auditor',
      scope: { kind: 'KIND', artifact_kind: 'Mission' },
      permissions: ['READ'],
      expiry: { kind: 'TIME', at: LATER },
      provenance: PROVENANCE,
      created_at: NOW,
    });
    expect(() =>
      authorize(grant, {
        action: 'REVISE',
        target: { kind: 'ARTIFACT', artifact_id: missionId },
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(/does not carry permission/);
  });

  it('a revision-bound grant authorizes only up to its bound revision', () => {
    const { store, missionId } = activeStoreWithMission();
    const grant = createGrant({
      grantee: 'platform-architect',
      scope: { kind: 'ARTIFACT', artifact_id: missionId },
      permissions: ['REVISE'],
      expiry: { kind: 'REVISION', artifact_id: missionId, max_version: 1 },
      provenance: PROVENANCE,
      created_at: NOW,
    });
    // valid while the mission is at version 1
    expect(
      canAuthorize(grant, {
        action: 'REVISE',
        target: { kind: 'ARTIFACT', artifact_id: missionId },
        at: { kind: 'REVISION', artifact_id: missionId, version: 1 },
      }),
    ).toBe(true);
    store.revise(missionId, {
      content: sampleMissionContent(),
      authority_grant: grant.envelope.id,
      provenance: PROVENANCE,
      created_at: T1,
    });
    // after the revision, the mission is at version 2 > max_version 1: expired
    expect(() =>
      authorize(grant, {
        action: 'REVISE',
        target: { kind: 'ARTIFACT', artifact_id: missionId },
        at: { kind: 'REVISION', artifact_id: missionId, version: 2 },
      }),
    ).toThrow(/EXPIRED/);
  });
});
