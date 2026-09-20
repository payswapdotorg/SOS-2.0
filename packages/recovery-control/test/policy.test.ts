import { describe, expect, it } from 'vitest';
import {
  createRecoveryPolicy,
  defaultRecoveryPolicyContent,
  updateRecoveryPolicy,
  validateRecoveryPolicy,
} from '../src/index.js';
import { evaluateGrant } from '@sos-2/authority';
import { GOVERNED_EXCEPTION, T0, T1, T2, grantFor } from './helpers.js';

/** A KIND-scoped RecoveryPolicy grant carrying REVISE. */
function policyGrant(permissions: string[] = ['REVISE']) {
  return grantFor({ kind: 'KIND', artifact_kind: 'RecoveryPolicy' }, permissions);
}

function defaultPolicy() {
  return createRecoveryPolicy({
    provenance: ['W8:policy-test:default'],
    created_at: T0,
    status: 'ACTIVE',
  });
}

describe('recovery policy artifact', () => {
  it('the default policy requires bounded recovery (the section 13 rule)', () => {
    expect(defaultRecoveryPolicyContent()).toEqual({ require_bounded_recovery: true });
    const policy = defaultPolicy();
    expect(validateRecoveryPolicy(policy)).toBe(true);
    expect(policy.content.require_bounded_recovery).toBe(true);
    expect(policy.envelope.kind).toBe('RecoveryPolicy');
  });

  it('creation is deterministic and canonical round trips preserve validity', () => {
    const input = { provenance: ['W8:policy-test:default'], created_at: T0, status: 'ACTIVE' as const };
    expect(createRecoveryPolicy(input)).toEqual(createRecoveryPolicy(JSON.parse(JSON.stringify(input))));
    const policy = defaultPolicy();
    const round = JSON.parse(JSON.stringify(policy));
    expect(validateRecoveryPolicy(round)).toBe(true);
    expect(round).toEqual(policy);
  });
});

describe('trusted boundary — candidate code can NEVER disable assurance policy', () => {
  it('THE test: a candidate-originated disable attempt with a FULLY VALID grant is rejected', () => {
    const policy = defaultPolicy();
    const grant = policyGrant(['REVISE', 'PROMOTE', 'DELEGATE']);
    expect(evaluateGrant(grant, { kind: 'TIME', now: T1 })).toBe('VALID'); // the grant is valid...
    expect(() =>
      updateRecoveryPolicy(policy, {
        origin: 'CANDIDATE',
        set: { require_bounded_recovery: false },
        grant,
        at: { kind: 'TIME', now: T1 },
        governed_exception: GOVERNED_EXCEPTION,
        provenance: ['candidate:please-disable-recovery'],
        created_at: T2,
      }),
    ).toThrow(/TRUSTED BOUNDARY/); // ...and the attempt is rejected anyway.
  });

  it('candidate-originated STRENGTHENING attempts are equally rejected (no policy mutation from candidates)', () => {
    const policy = defaultPolicy();
    expect(() =>
      updateRecoveryPolicy(policy, {
        origin: 'CANDIDATE',
        set: { require_bounded_recovery: true },
        grant: policyGrant(),
        at: { kind: 'TIME', now: T1 },
        governed_exception: null,
        provenance: ['candidate:strengthens'],
        created_at: T2,
      }),
    ).toThrow(/TRUSTED BOUNDARY/);
  });

  it('the candidate rejection fires BEFORE any authority evaluation (even a broken grant input is refused as CANDIDATE first)', () => {
    const policy = defaultPolicy();
    const expired = grantFor({ kind: 'KIND', artifact_kind: 'RecoveryPolicy' }, ['REVISE'], {
      expiryAt: '2025-03-01T00:00:00.000Z',
    });
    expect(() =>
      updateRecoveryPolicy(policy, {
        origin: 'CANDIDATE',
        set: { require_bounded_recovery: false },
        grant: expired,
        at: { kind: 'TIME', now: T2 },
        governed_exception: null,
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/TRUSTED BOUNDARY/);
  });
});

describe('authority-gated policy updates (trusted origin)', () => {
  it('trusted origin + valid grant + governed exception CAN weaken the policy (the governed path exists)', () => {
    const policy = defaultPolicy();
    const next = updateRecoveryPolicy(policy, {
      origin: 'TRUSTED_OPERATORS',
      set: { require_bounded_recovery: false },
      grant: policyGrant(),
      at: { kind: 'TIME', now: T1 },
      governed_exception: GOVERNED_EXCEPTION,
      provenance: ['W8:policy-test:weaken', 'exception:approved'],
      created_at: T2,
    });
    expect(next.content.require_bounded_recovery).toBe(false);
    expect(next.envelope.version).toBe(policy.envelope.version + 1);
    expect(next.envelope.supersedes).toBe(policy.envelope.id);
    expect(validateRecoveryPolicy(next)).toBe(true);
  });

  it('trusted origin + valid grant CAN strengthen the policy without an exception', () => {
    const weakened = updateRecoveryPolicy(defaultPolicy(), {
      origin: 'TRUSTED_OPERATORS',
      set: { require_bounded_recovery: false },
      grant: policyGrant(),
      at: { kind: 'TIME', now: T1 },
      governed_exception: GOVERNED_EXCEPTION,
      provenance: ['W8:policy-test:weaken'],
      created_at: T2,
    });
    const restored = updateRecoveryPolicy(weakened, {
      origin: 'TRUSTED_OPERATORS',
      set: { require_bounded_recovery: true },
      grant: policyGrant(),
      at: { kind: 'TIME', now: T2 },
      governed_exception: null,
      provenance: ['W8:policy-test:restore'],
      created_at: T2,
    });
    expect(restored.content.require_bounded_recovery).toBe(true);
    expect(restored.envelope.version).toBe(3);
  });

  it('an ARTIFACT-scoped grant for exactly this policy also authorizes (narrow grants work)', () => {
    const policy = defaultPolicy();
    const narrow = grantFor({ kind: 'ARTIFACT', artifact_id: policy.envelope.id }, ['REVISE']);
    const next = updateRecoveryPolicy(policy, {
      origin: 'TRUSTED_OPERATORS',
      set: { require_bounded_recovery: false },
      grant: narrow,
      at: { kind: 'TIME', now: T1 },
      governed_exception: GOVERNED_EXCEPTION,
      provenance: ['W8:policy-test:narrow'],
      created_at: T2,
    });
    expect(next.content.require_bounded_recovery).toBe(false);
  });

  it('trusted + granted weakening WITHOUT a governed exception is rejected', () => {
    const policy = defaultPolicy();
    expect(() =>
      updateRecoveryPolicy(policy, {
        origin: 'TRUSTED_OPERATORS',
        set: { require_bounded_recovery: false },
        grant: policyGrant(),
        at: { kind: 'TIME', now: T1 },
        governed_exception: null,
        provenance: ['W8:policy-test:weaken-attempt'],
        created_at: T2,
      }),
    ).toThrow(/requires an explicit governed exception record/);
  });

  it('a malformed governed exception is rejected even on the governed path', () => {
    const policy = defaultPolicy();
    expect(() =>
      updateRecoveryPolicy(policy, {
        origin: 'TRUSTED_OPERATORS',
        set: { require_bounded_recovery: false },
        grant: policyGrant(),
        at: { kind: 'TIME', now: T1 },
        governed_exception: { ...GOVERNED_EXCEPTION, authority_ref: 'not-an-id' },
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/governed exception authority_ref/);
  });

  it('updateRecoveryPolicy is deterministic for identical change input', () => {
    const policy = defaultPolicy();
    const change = {
      origin: 'TRUSTED_OPERATORS' as const,
      set: { require_bounded_recovery: false },
      grant: policyGrant(),
      at: { kind: 'TIME' as const, now: T1 },
      governed_exception: GOVERNED_EXCEPTION,
      provenance: ['W8:policy-test:weaken'],
      created_at: T2,
    };
    expect(updateRecoveryPolicy(policy, change)).toEqual(
      updateRecoveryPolicy(policy, JSON.parse(JSON.stringify(change))),
    );
  });
});
