import { describe, expect, it } from 'vitest';
import { RecoveryGate, createRecoveryPolicy } from '../src/index.js';
import {
  CHANGE_REF,
  GOVERNED_EXCEPTION,
  T0,
  T1,
  T2,
  grantFor,
  makeDeclaration,
  rehearsalEvidence,
} from './helpers.js';

function defaultGate() {
  return new RecoveryGate(
    createRecoveryPolicy({
      provenance: ['W8:gate-test:policy'],
      created_at: T0,
      status: 'ACTIVE',
    }),
  );
}

/** A PROMOTE grant covering the live change artifact + the matching declaration. */
function registration() {
  const grant = grantFor({ kind: 'ARTIFACT', artifact_id: CHANGE_REF }, ['PROMOTE']);
  const declaration = makeDeclaration({ authority_ref: grant.envelope.id });
  return { grant, declaration, evidence: [rehearsalEvidence()], now: T1 };
}

describe('RecoveryGate — registering live changes', () => {
  it('registers a bounded, authorized, evidenced live change (the happy path)', () => {
    const gate = defaultGate();
    const { grant, declaration, evidence, now } = registration();
    const record = gate.registerLiveChange({ declaration, grant, now, evidence });
    expect(record).toMatchObject({
      change_ref: CHANGE_REF,
      declaration_id: declaration.envelope.id,
      declaration_version: 1,
      authorized_by: grant.envelope.id,
      registered_at: now,
      bounded: true,
      via_exception: false,
    });
    expect(gate.size).toBe(1);
    expect(gate.liveChanges()).toEqual([record]);
  });

  it('requires the declaration to name the presented grant (no grant substitution)', () => {
    const gate = defaultGate();
    const otherGrant = grantFor({ kind: 'KIND', artifact_kind: 'Decision' }, ['PROMOTE']);
    const { grant, declaration, evidence, now } = registration();
    expect(grant.envelope.id).not.toBe(otherGrant.envelope.id);
    expect(() => gate.registerLiveChange({ declaration, grant: otherGrant, now, evidence })).toThrow(
      /is not the grant the declaration names/,
    );
  });

  it('rejects an unbounded declaration without a governed exception (the core rollback contract)', () => {
    const gate = defaultGate();
    const { grant, declaration, evidence, now } = registration();
    const unbounded = makeDeclaration({
      authority_ref: grant.envelope.id,
      mechanism: { kind: 'UNSPECIFIED' },
    });
    expect(() => gate.registerLiveChange({ declaration: unbounded, grant, now, evidence })).toThrow(
      /UNBOUNDED RECOVERY REJECTED/,
    );
    expect(gate.size).toBe(0);
  });

  it('accepts an unbounded declaration WITH a governed exception', () => {
    const gate = defaultGate();
    const { grant, evidence, now } = registration();
    const excused = makeDeclaration({
      authority_ref: grant.envelope.id,
      mechanism: { kind: 'UNSPECIFIED' },
      exception: GOVERNED_EXCEPTION,
    });
    const record = gate.registerLiveChange({ declaration: excused, grant, now, evidence });
    expect(record.bounded).toBe(false);
    expect(record.via_exception).toBe(true);
  });

  it('rejects missing rehearsal evidence and non-SUCCESS rehearsal evidence', () => {
    const gate = defaultGate();
    const { grant, declaration, now } = registration();
    expect(() => gate.registerLiveChange({ declaration, grant, now, evidence: [] })).toThrow(
      /not in the provided evidence pool/,
    );
    const failed = rehearsalEvidence({ availability: 'FAILURE' });
    const failedDeclaration = makeDeclaration({
      authority_ref: grant.envelope.id,
      evidence_ref: failed.id,
    });
    expect(() =>
      gate.registerLiveChange({ declaration: failedDeclaration, grant, now, evidence: [failed] }),
    ).toThrow(/only SUCCESS evidence demonstrates a working recovery mechanism/);
  });

  it('rejects grants that are expired, revoked-by-content, out of scope or missing PROMOTE', () => {
    const gate = defaultGate();
    const { evidence, now } = registration();

    // Expired.
    const expiredGrant = grantFor({ kind: 'ARTIFACT', artifact_id: CHANGE_REF }, ['PROMOTE'], {
      expiryAt: '2025-03-01T12:00:00.000Z',
    });
    const expiredDeclaration = makeDeclaration({ authority_ref: expiredGrant.envelope.id });
    expect(() =>
      gate.registerLiveChange({ declaration: expiredDeclaration, grant: expiredGrant, now, evidence }),
    ).toThrow(/never authorize|EXPIRED|authorization refused/);

    // Out of scope: the grant covers a different artifact.
    const otherChange = grantFor({ kind: 'KIND', artifact_kind: 'Mission' }, ['PROMOTE']);
    const scopedDeclaration = makeDeclaration({ authority_ref: otherChange.envelope.id });
    expect(() =>
      gate.registerLiveChange({ declaration: scopedDeclaration, grant: otherChange, now, evidence }),
    ).toThrow(/authorization refused: scope violation/);

    // Missing permission.
    const noPromote = grantFor({ kind: 'ARTIFACT', artifact_id: CHANGE_REF }, ['READ']);
    const unpermittedDeclaration = makeDeclaration({ authority_ref: noPromote.envelope.id });
    expect(() =>
      gate.registerLiveChange({ declaration: unpermittedDeclaration, grant: noPromote, now, evidence }),
    ).toThrow(/does not carry permission/);
  });

  it('rejects the identical declaration registered twice', () => {
    const gate = defaultGate();
    const { grant, declaration, evidence, now } = registration();
    gate.registerLiveChange({ declaration, grant, now, evidence });
    expect(() => gate.registerLiveChange({ declaration, grant, now, evidence })).toThrow(/already registered/);
  });

  it('liveChanges() is deterministically ordered', () => {
    const gate = defaultGate();
    const grantA = grantFor({ kind: 'ARTIFACT', artifact_id: CHANGE_REF }, ['PROMOTE']);
    const declarationA = makeDeclaration({
      authority_ref: grantA.envelope.id,
      trigger: { kind: 'DEADLINE', within_ms: 3_600_000 },
    });
    const grantB = grantFor({ kind: 'KIND', artifact_kind: 'Decision' }, ['PROMOTE']);
    const declarationB = makeDeclaration({
      authority_ref: grantB.envelope.id,
      mechanism: { kind: 'DISABLE_FEATURE', feature_id: 'payments-v2' },
    });
    gate.registerLiveChange({ declaration: declarationA, grant: grantA, now: T1, evidence: [rehearsalEvidence()] });
    gate.registerLiveChange({ declaration: declarationB, grant: grantB, now: T1, evidence: [rehearsalEvidence()] });
    const records = gate.liveChanges();
    expect(records.length).toBe(2);
    const sorted = [...records].sort((a, b) => (a.declaration_id < b.declaration_id ? -1 : 1));
    expect(records.map((record) => record.declaration_id)).toEqual(sorted.map((record) => record.declaration_id));
  });
});

describe('RecoveryGate — policy interplay', () => {
  it('a policy weakened through the governed path lets unbounded declarations register (documented consequence)', () => {
    const gate = defaultGate();
    const policyGrant = grantFor({ kind: 'KIND', artifact_kind: 'RecoveryPolicy' }, ['REVISE']);
    gate.updatePolicy({
      origin: 'TRUSTED_OPERATORS',
      set: { require_bounded_recovery: false },
      grant: policyGrant,
      at: { kind: 'TIME', now: T1 },
      governed_exception: GOVERNED_EXCEPTION,
      provenance: ['W8:gate-test:weaken'],
      created_at: T2,
    });
    const { grant, evidence, now } = registration();
    const unbounded = makeDeclaration({
      authority_ref: grant.envelope.id,
      mechanism: { kind: 'UNSPECIFIED' },
    });
    const record = gate.registerLiveChange({ declaration: unbounded, grant, now, evidence });
    expect(record.bounded).toBe(false);
    expect(record.via_exception).toBe(false);
    // The record names the policy version under which it was accepted.
    expect(record.policy_version).toBe(2);
  });

  it('records pin the exact policy revision they were checked against', () => {
    const gate = defaultGate();
    const { grant, declaration, evidence, now } = registration();
    const record = gate.registerLiveChange({ declaration, grant, now, evidence });
    const policy = gate.policy();
    expect(record.policy_id).toBe(policy.envelope.id);
    expect(record.policy_version).toBe(policy.envelope.version);
  });

  it('the gate refuses to continue a chain from a terminal policy head', () => {
    const gate = defaultGate();
    const policyGrant = grantFor({ kind: 'KIND', artifact_kind: 'RecoveryPolicy' }, ['REVISE']);
    // Manually mark the head superseded (terminal) as the spine lifecycle would.
    const current = gate.policy();
    const terminal = {
      envelope: { ...current.envelope, status: 'SUPERSEDED' as const, version: current.envelope.version + 1 },
      content: current.content,
    };
    const terminalGate = new RecoveryGate(terminal);
    expect(() =>
      terminalGate.updatePolicy({
        origin: 'TRUSTED_OPERATORS',
        set: { require_bounded_recovery: false },
        grant: policyGrant,
        at: { kind: 'TIME', now: T1 },
        governed_exception: GOVERNED_EXCEPTION,
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/cannot be revised/);
  });
});

describe('updateRecoveryPolicy via the gate moves the gate head', () => {
  it('weakening through the gate affects subsequent registrations', () => {
    const gate = defaultGate();
    const { grant, evidence, now } = registration();
    const unbounded = makeDeclaration({ authority_ref: grant.envelope.id, mechanism: { kind: 'UNSPECIFIED' } });
    expect(() => gate.registerLiveChange({ declaration: unbounded, grant, now, evidence })).toThrow(
      /UNBOUNDED RECOVERY REJECTED/,
    );
    const policyGrant = grantFor({ kind: 'KIND', artifact_kind: 'RecoveryPolicy' }, ['REVISE']);
    gate.updatePolicy({
      origin: 'TRUSTED_OPERATORS',
      set: { require_bounded_recovery: false },
      grant: policyGrant,
      at: { kind: 'TIME', now: T1 },
      governed_exception: GOVERNED_EXCEPTION,
      provenance: ['W8:gate-test:weaken'],
      created_at: T2,
    });
    const record = gate.registerLiveChange({ declaration: unbounded, grant, now, evidence });
    expect(record.bounded).toBe(false);
  });
});
