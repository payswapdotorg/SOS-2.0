import { describe, expect, it } from 'vitest';
import {
  GrantStore,
  canTransitionGrantStatus,
  createGrant,
  evaluateGrant,
  isGrantValid,
  revokeGrant,
} from '../src/index.js';
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

describe('deterministic grant evaluation (unit)', () => {
  it('a time-bound grant is VALID strictly before its expiry instant and EXPIRED from it on', () => {
    const timeGrant = createTimeGrant();
    expect(evaluateGrant(timeGrant, { kind: 'TIME', now: T0 })).toBe('VALID');
    expect(evaluateGrant(timeGrant, { kind: 'TIME', now: '2025-05-31T23:59:59.999Z' })).toBe('VALID');
    expect(evaluateGrant(timeGrant, { kind: 'TIME', now: T2 })).toBe('EXPIRED'); // boundary: at == expiry
    expect(evaluateGrant(timeGrant, { kind: 'TIME', now: AFTER })).toBe('EXPIRED');
  });

  it('time comparison honors offsets (instants, not strings)', () => {
    const timeGrant = createTimeGrant(); // expires 2025-06-01T00:00:00.000Z
    // 2025-05-31T19:00:00-05:00 IS 2025-06-01T00:00:00Z -> expired
    expect(evaluateGrant(timeGrant, { kind: 'TIME', now: '2025-05-31T19:00:00-05:00' })).toBe('EXPIRED');
    // 2025-06-01T02:00:00+03:00 IS 2025-05-31T23:00:00Z -> valid
    expect(evaluateGrant(timeGrant, { kind: 'TIME', now: '2025-06-01T02:00:00+03:00' })).toBe('VALID');
  });

  it('a revision-bound grant expires exactly past its max_version', () => {
    const grant = createGrantWithRevisionExpiry();
    expect(evaluateGrant(grant, { kind: 'REVISION', artifact_id: MISSION_ID, version: 1 })).toBe('VALID');
    expect(evaluateGrant(grant, { kind: 'REVISION', artifact_id: MISSION_ID, version: 2 })).toBe('VALID');
    expect(evaluateGrant(grant, { kind: 'REVISION', artifact_id: MISSION_ID, version: 3 })).toBe('EXPIRED');
    expect(evaluateGrant(grant, { kind: 'REVISION', artifact_id: MISSION_ID, version: 99 })).toBe('EXPIRED');
  });

  it('indeterminate evaluations fail loudly (never silently VALID)', () => {
    const timeGrant = createTimeGrant();
    expect(() => evaluateGrant(timeGrant, { kind: 'REVISION', artifact_id: MISSION_ID, version: 1 })).toThrow(
      /indeterminate evaluation/,
    );
    const revisionGrant = createGrantWithRevisionExpiry();
    expect(() => evaluateGrant(revisionGrant, { kind: 'TIME', now: T0 })).toThrow(/indeterminate evaluation/);
    expect(() =>
      evaluateGrant(revisionGrant, { kind: 'REVISION', artifact_id: OTHER_MISSION_ID, version: 1 }),
    ).toThrow(/indeterminate evaluation/);
  });

  it('revocation beats expiry: a revoked grant evaluates REVOKED regardless of the clock', () => {
    const store = new GrantStore();
    const issued = store.issue(baseGrantInput({ status: 'ACTIVE' }));
    const revoked = store.revoke(issued.envelope.id, {
      at: { kind: 'TIME', now: T1 },
      provenance: [...PROVENANCE, 'revoked'],
      created_at: T1,
    });
    expect(evaluateGrant(revoked, { kind: 'TIME', now: T0 })).toBe('REVOKED'); // before expiry, after revocation
    expect(evaluateGrant(revoked, { kind: 'TIME', now: AFTER })).toBe('REVOKED'); // after expiry too
    expect(isGrantValid(revoked, { kind: 'TIME', now: T0 })).toBe(false);
  });

  it('evaluation is deterministic: same grant + same point -> same status', () => {
    const timeGrant = createTimeGrant();
    for (const point of [{ kind: 'TIME', now: T1 }, { kind: 'TIME', now: AFTER }] as const) {
      expect(evaluateGrant(timeGrant, point)).toBe(evaluateGrant(timeGrant, point));
    }
  });

  it('malformed evaluation inputs are rejected loudly', () => {
    const timeGrant = createTimeGrant();
    expect(() => evaluateGrant(timeGrant, { kind: 'TIME', now: 'nope' } as never)).toThrow(/TIME evaluation input/);
    expect(() => evaluateGrant(timeGrant, null as never)).toThrow(/evaluation input must be/);
    expect(() => evaluateGrant(timeGrant, { kind: 'MAYBE' } as never)).toThrow(/evaluation input kind must be/);
  });
});

describe('revocation workflow (unit + negative)', () => {
  it('revoking a VALID grant creates the revoked successor revision with provenance', () => {
    const store = new GrantStore();
    const issued = store.issue(baseGrantInput({ status: 'ACTIVE' }));
    const head = store.latest(issued.envelope.id)!;
    const revoked = revokeGrant(head, {
      at: { kind: 'TIME', now: T1 },
      provenance: [...PROVENANCE, 'rotation'],
      created_at: T1,
    });
    expect(revoked.envelope.version).toBe(2);
    expect(revoked.envelope.supersedes).toBe(issued.envelope.id);
    expect(revoked.envelope.status).toBe('ACTIVE');
    expect(revoked.content.revoked_at).toBe(T1);
    expect(revoked.content.revocation_provenance).toEqual([...PROVENANCE, 'rotation']);
    expect(revoked.envelope.id).not.toBe(issued.envelope.id);
    // deterministic: same revocation -> same id
    const again = revokeGrant(head, {
      at: { kind: 'TIME', now: T1 },
      provenance: [...PROVENANCE, 'rotation'],
      created_at: T1,
    });
    expect(again.envelope.id).toBe(revoked.envelope.id);
  });

  it('the store workflow: old head becomes SUPERSEDED, history is complete', () => {
    const store = new GrantStore();
    const issued = store.issue(baseGrantInput({ status: 'ACTIVE' }));
    const revoked = store.revoke(issued.envelope.id, {
      at: { kind: 'TIME', now: T1 },
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(store.get(issued.envelope.id)!.envelope.status).toBe('SUPERSEDED');
    expect(store.latest(issued.envelope.id)!.envelope.id).toBe(revoked.envelope.id);
    const history = store.history(issued.envelope.id);
    expect(history.map((g) => g.envelope.version)).toEqual([1, 2]);
    expect(history[0]!.content.revoked_at).toBeNull();
    expect(history[1]!.content.revoked_at).toBe(T1);
  });

  it('revoking a REVOKED grant fails loudly (terminal transition)', () => {
    const store = new GrantStore();
    const issued = store.issue(baseGrantInput({ status: 'ACTIVE' }));
    store.revoke(issued.envelope.id, {
      at: { kind: 'TIME', now: T1 },
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(() =>
      store.revoke(issued.envelope.id, {
        at: { kind: 'TIME', now: T2 },
        provenance: PROVENANCE,
        created_at: T2,
      }),
    ).toThrow(/already REVOKED/);
  });

  it('revoking an EXPIRED grant fails loudly (terminal transition)', () => {
    const store = new GrantStore();
    const issued = store.issue(baseGrantInput({ status: 'ACTIVE' }));
    expect(() =>
      store.revoke(issued.envelope.id, {
        at: { kind: 'TIME', now: AFTER },
        provenance: PROVENANCE,
        created_at: AFTER,
      }),
    ).toThrow(/already EXPIRED/);
  });

  it('the transition table backs the workflow (VALID can leave; terminal cannot)', () => {
    expect(canTransitionGrantStatus('VALID', 'REVOKED')).toBe(true);
    expect(canTransitionGrantStatus('REVOKED', 'VALID')).toBe(false);
    expect(canTransitionGrantStatus('EXPIRED', 'REVOKED')).toBe(false);
  });

  it('the store enforces complete, contiguous grant revision history', () => {
    const store = new GrantStore();
    const issued = store.issue(baseGrantInput({ status: 'ACTIVE' }));
    const head = store.latest(issued.envelope.id)!;
    const revoked = revokeGrant(head, {
      at: { kind: 'TIME', now: T1 },
      provenance: PROVENANCE,
      created_at: T1,
    });
    // a version jump cannot be put
    const jumped = { ...revoked, envelope: { ...revoked.envelope, version: 4 } };
    expect(() => store.put(jumped)).toThrow(/exactly previous.version \+ 1/);
    // a dangling supersedes target cannot be put
    const dangling = { ...revoked, envelope: { ...revoked.envelope, supersedes: `sos://AuthorityGrant/${'d'.repeat(32)}` } };
    expect(() => store.put(dangling)).toThrow(/supersedes unknown artifact/);
    // duplicate ids are rejected
    expect(() => store.put(issued)).toThrow(/already registered/);
    // unknown ids fail loudly on queries
    expect(() => store.history(`sos://AuthorityGrant/${'e'.repeat(32)}`)).toThrow(/unknown grant id/);
    expect(store.latest(`sos://AuthorityGrant/${'e'.repeat(32)}`)).toBeUndefined();
  });
});

function createTimeGrant() {
  return createGrant(baseGrantInput({ status: 'ACTIVE' }));
}

function createGrantWithRevisionExpiry() {
  return createGrant(
    baseGrantInput({
      status: 'ACTIVE',
      expiry: { kind: 'REVISION', artifact_id: MISSION_ID, max_version: 2 },
    }),
  );
}
