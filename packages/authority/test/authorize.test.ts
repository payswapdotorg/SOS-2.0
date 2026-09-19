import { describe, expect, it } from 'vitest';
import {
  GrantStore,
  authorize,
  canAuthorize,
  createGrant,
  delegateGrant,
  scopeCovers,
} from '../src/index.js';
import type { AuthorizationTarget } from '../src/index.js';
import {
  AFTER,
  MISSION_ID,
  OTHER_MISSION_ID,
  PROVENANCE,
  T0,
  T1,
  T2,
  baseGrantInput,
} from './helpers.js';

const artifactTarget = (id: string): AuthorizationTarget => ({ kind: 'ARTIFACT', artifact_id: id });
const kindTarget = (kind: string): AuthorizationTarget => ({ kind: 'KIND', artifact_kind: kind });

/** An instant strictly between T0 and T1 (grants are valid strictly BEFORE their expiry). */
const BEFORE_T1 = '2025-02-01T00:00:00.000Z';

describe('scope covering rule (unit)', () => {
  it('ARTIFACT scope covers exactly its own artifact', () => {
    const scope = { kind: 'ARTIFACT' as const, artifact_id: MISSION_ID };
    expect(scopeCovers(scope, artifactTarget(MISSION_ID))).toBe(true);
    expect(scopeCovers(scope, artifactTarget(OTHER_MISSION_ID))).toBe(false);
    expect(scopeCovers(scope, kindTarget('Mission'))).toBe(false); // narrower never authorizes broader
  });

  it('KIND scope covers artifacts of that kind and the kind itself', () => {
    const scope = { kind: 'KIND' as const, artifact_kind: 'Mission' };
    expect(scopeCovers(scope, artifactTarget(MISSION_ID))).toBe(true);
    expect(scopeCovers(scope, artifactTarget(`sos://Evidence/${'f'.repeat(32)}`))).toBe(false);
    expect(scopeCovers(scope, kindTarget('Mission'))).toBe(true);
    expect(scopeCovers(scope, kindTarget('Evidence'))).toBe(false);
  });
});

describe('authorization gate (unit + negative)', () => {
  it('a VALID, in-scope, permitted grant authorizes and returns the grant', () => {
    const grant = createGrant(baseGrantInput({ status: 'ACTIVE', permissions: ['REVISE'] }));
    const result = authorize(grant, {
      action: 'REVISE',
      target: artifactTarget(MISSION_ID),
      at: { kind: 'TIME', now: T1 },
    });
    expect(result.envelope.id).toBe(grant.envelope.id);
    expect(
      canAuthorize(grant, { action: 'REVISE', target: artifactTarget(MISSION_ID), at: { kind: 'TIME', now: T1 } }),
    ).toBe(true);
  });

  it('an expired grant NEVER authorizes (fails loudly)', () => {
    const grant = createGrant(baseGrantInput({ status: 'ACTIVE', permissions: ['REVISE'] }));
    expect(() =>
      authorize(grant, { action: 'REVISE', target: artifactTarget(MISSION_ID), at: { kind: 'TIME', now: AFTER } }),
    ).toThrow(/authorization refused: grant .* is EXPIRED/);
    expect(
      canAuthorize(grant, { action: 'REVISE', target: artifactTarget(MISSION_ID), at: { kind: 'TIME', now: AFTER } }),
    ).toBe(false);
  });

  it('a revoked grant NEVER authorizes (fails loudly)', () => {
    const store = new GrantStore();
    const issued = store.issue(baseGrantInput({ status: 'ACTIVE', permissions: ['REVISE'] }));
    store.revoke(issued.envelope.id, {
      at: { kind: 'TIME', now: T1 },
      provenance: PROVENANCE,
      created_at: T1,
    });
    const revoked = store.latest(issued.envelope.id)!;
    expect(() =>
      authorize(revoked, { action: 'REVISE', target: artifactTarget(MISSION_ID), at: { kind: 'TIME', now: T1 } }),
    ).toThrow(/is REVOKED/);
  });

  it('a scope violation fails loudly', () => {
    const grant = createGrant(baseGrantInput({ status: 'ACTIVE', permissions: ['REVISE'] }));
    expect(() =>
      authorize(grant, { action: 'REVISE', target: artifactTarget(OTHER_MISSION_ID), at: { kind: 'TIME', now: T1 } }),
    ).toThrow(/scope violation/);
    // artifact-scoped grant never authorizes kind-wide requests
    expect(() =>
      authorize(grant, { action: 'REVISE', target: kindTarget('Mission'), at: { kind: 'TIME', now: T1 } }),
    ).toThrow(/scope violation/);
  });

  it('a missing permission fails loudly', () => {
    const grant = createGrant(baseGrantInput({ status: 'ACTIVE', permissions: ['READ'] }));
    expect(() =>
      authorize(grant, { action: 'REVISE', target: artifactTarget(MISSION_ID), at: { kind: 'TIME', now: T1 } }),
    ).toThrow(/does not carry permission/);
  });

  it('an unknown permission is never authorized', () => {
    const grant = createGrant(baseGrantInput({ status: 'ACTIVE', permissions: ['READ', 'REVISE', 'RETIRE', 'PROMOTE', 'DELEGATE'] }));
    expect(
      canAuthorize(grant, { action: 'ADMIN', target: artifactTarget(MISSION_ID), at: { kind: 'TIME', now: T1 } }),
    ).toBe(false);
  });

  it('KIND-scoped grants authorize artifact requests of that kind', () => {
    const grant = createGrant(
      baseGrantInput({ status: 'ACTIVE', scope: { kind: 'KIND', artifact_kind: 'Mission' }, permissions: ['REVISE'] }),
    );
    expect(
      canAuthorize(grant, { action: 'REVISE', target: artifactTarget(MISSION_ID), at: { kind: 'TIME', now: T1 } }),
    ).toBe(true);
    expect(
      canAuthorize(grant, { action: 'REVISE', target: kindTarget('Mission'), at: { kind: 'TIME', now: T1 } }),
    ).toBe(true);
  });
});

describe('delegation (unit + negative: escalation attempts rejected)', () => {
  it('a DELEGATE-permitted parent can mint a strictly-narrower child grant', () => {
    const parent = createGrant(
      baseGrantInput({
        status: 'ACTIVE',
        scope: { kind: 'KIND', artifact_kind: 'Mission' },
        permissions: ['READ', 'REVISE', 'DELEGATE'],
      }),
    );
    const child = delegateGrant(parent, {
      grantee: 'mission-editor',
      scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
      permissions: ['REVISE'],
      expiry: { kind: 'TIME', at: T1 }, // <= parent expiry T2
      provenance: PROVENANCE,
      created_at: T1,
      at: { kind: 'TIME', now: BEFORE_T1 },
    });
    expect(child.content.grantee).toBe('mission-editor');
    expect(child.content.scope).toEqual({ kind: 'ARTIFACT', artifact_id: MISSION_ID });
    expect(child.envelope.authority_ref).toBe(parent.envelope.id);
    expect(child.envelope.status).toBe('ACTIVE');
    expect(child.content.permissions).toEqual(['REVISE']);
    expect(child.envelope.provenance).toContain(`delegated-from:${parent.envelope.id}`);
    // the child actually works for its narrow scope (strictly before its expiry)
    expect(
      canAuthorize(child, { action: 'REVISE', target: artifactTarget(MISSION_ID), at: { kind: 'TIME', now: BEFORE_T1 } }),
    ).toBe(true);
  });

  it('escalation: a parent without DELEGATE cannot delegate (fails loudly)', () => {
    const parent = createGrant(baseGrantInput({ status: 'ACTIVE', permissions: ['READ', 'REVISE'] }));
    expect(() =>
      delegateGrant(parent, {
        grantee: 'child',
        scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
        permissions: ['READ'],
        expiry: { kind: 'TIME', at: T1 },
        provenance: PROVENANCE,
        created_at: T1,
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(/does not carry permission "DELEGATE"/);
  });

  it('escalation: an expired parent cannot delegate', () => {
    const parent = createGrant(
      baseGrantInput({ status: 'ACTIVE', permissions: ['DELEGATE'] }),
    );
    expect(() =>
      delegateGrant(parent, {
        grantee: 'child',
        scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
        permissions: ['READ'],
        expiry: { kind: 'TIME', at: AFTER },
        provenance: PROVENANCE,
        created_at: AFTER,
        at: { kind: 'TIME', now: AFTER },
      }),
    ).toThrow(/is EXPIRED/);
  });

  it('escalation: a broader child scope is rejected', () => {
    const parent = createGrant(
      baseGrantInput({
        status: 'ACTIVE',
        scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
        permissions: ['READ', 'DELEGATE'],
      }),
    );
    // kind-wide child under an artifact-scoped parent
    expect(() =>
      delegateGrant(parent, {
        grantee: 'child',
        scope: { kind: 'KIND', artifact_kind: 'Mission' },
        permissions: ['READ'],
        expiry: { kind: 'TIME', at: T1 },
        provenance: PROVENANCE,
        created_at: T1,
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(/scope violation/);
    // different artifact child
    expect(() =>
      delegateGrant(parent, {
        grantee: 'child',
        scope: { kind: 'ARTIFACT', artifact_id: OTHER_MISSION_ID },
        permissions: ['READ'],
        expiry: { kind: 'TIME', at: T1 },
        provenance: PROVENANCE,
        created_at: T1,
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(/scope violation/);
  });

  it('escalation: child permissions beyond the parent are rejected', () => {
    const parent = createGrant(
      baseGrantInput({ status: 'ACTIVE', permissions: ['READ', 'DELEGATE'] }),
    );
    expect(() =>
      delegateGrant(parent, {
        grantee: 'child',
        scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
        permissions: ['READ', 'REVISE'], // REVISE not held by parent
        expiry: { kind: 'TIME', at: T1 },
        provenance: PROVENANCE,
        created_at: T1,
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(/escalation rejected: child grant requests permissions/);
  });

  it('escalation: a child that would outlive the parent is rejected', () => {
    const parent = createGrant(
      baseGrantInput({ status: 'ACTIVE', permissions: ['READ', 'DELEGATE'] }),
    );
    // TIME child beyond parent TIME expiry
    expect(() =>
      delegateGrant(parent, {
        grantee: 'child',
        scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
        permissions: ['READ'],
        expiry: { kind: 'TIME', at: AFTER }, // parent expires at T2
        provenance: PROVENANCE,
        created_at: T1,
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(/escalation rejected: child grant expiry/);
    // mismatched expiry kinds cannot be proven within-bound -> rejected
    expect(() =>
      delegateGrant(parent, {
        grantee: 'child',
        scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
        permissions: ['READ'],
        expiry: { kind: 'REVISION', artifact_id: MISSION_ID, max_version: 1 },
        provenance: PROVENANCE,
        created_at: T1,
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(/escalation rejected: child grant expiry/);
  });

  it('revision-bound parents delegate revision-bound children within the bound', () => {
    const parent = createGrant(
      baseGrantInput({
        status: 'ACTIVE',
        permissions: ['READ', 'DELEGATE'],
        expiry: { kind: 'REVISION', artifact_id: MISSION_ID, max_version: 5 },
      }),
    );
    const child = delegateGrant(parent, {
      grantee: 'child',
      scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
      permissions: ['READ'],
      expiry: { kind: 'REVISION', artifact_id: MISSION_ID, max_version: 3 },
      provenance: PROVENANCE,
      created_at: T1,
      at: { kind: 'REVISION', artifact_id: MISSION_ID, version: 1 },
    });
    expect(child.content.expiry).toEqual({ kind: 'REVISION', artifact_id: MISSION_ID, max_version: 3 });
    // a child bound beyond the parent bound is rejected
    expect(() =>
      delegateGrant(parent, {
        grantee: 'child2',
        scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
        permissions: ['READ'],
        expiry: { kind: 'REVISION', artifact_id: MISSION_ID, max_version: 9 },
        provenance: PROVENANCE,
        created_at: T1,
        at: { kind: 'REVISION', artifact_id: MISSION_ID, version: 1 },
      }),
    ).toThrow(/escalation rejected: child grant expiry/);
  });

  it('delegation chains: a child cannot itself delegate without DELEGATE', () => {
    const parent = createGrant(
      baseGrantInput({ status: 'ACTIVE', permissions: ['READ', 'DELEGATE'] }),
    );
    const child = delegateGrant(parent, {
      grantee: 'child',
      scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
      permissions: ['READ'],
      expiry: { kind: 'TIME', at: T1 },
      provenance: PROVENANCE,
      created_at: T1,
      at: { kind: 'TIME', now: BEFORE_T1 },
    });
    expect(() =>
      delegateGrant(child, {
        grantee: 'grandchild',
        scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
        permissions: ['READ'],
        expiry: { kind: 'TIME', at: T1 },
        provenance: PROVENANCE,
        created_at: T1,
        at: { kind: 'TIME', now: BEFORE_T1 },
      }),
    ).toThrow(/does not carry permission "DELEGATE"/);
  });
});
