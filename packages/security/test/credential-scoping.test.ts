// No vitest import: the borrowed toolchain runs with `globals: true`.
import {
  ACTION_FAMILY_VOCABULARY,
  evaluateCredentialScope,
  assertNoBrokerScopeEscalation,
  CredentialScopeError,
  type CredentialScopeRecord,
} from '../src/index.js';

const NOW = 1_000_000;

function credential(overrides: Partial<CredentialScopeRecord> = {}): CredentialScopeRecord {
  return {
    credentialId: 'cred-1',
    heldBy: 'body',
    holderId: 'body-1',
    families: ['commit', 'push'],
    expiresAt: NOW + 10_000,
    projectId: 'project-A',
    ...overrides,
  };
}

describe('credential scoping (pinned: scoped-to-X cannot mint family Y; escalation is typed)', () => {
  it('the vocabulary mirrors the nine P9 action families', () => {
    expect(ACTION_FAMILY_VOCABULARY).toEqual([
      'commit',
      'push',
      'pull-request',
      'deployment',
      'configuration',
      'remediation',
      'promotion',
      'rollback',
      'body-lifecycle',
    ]);
  });

  it('grants a held, unexpired family', () => {
    const decision = evaluateCredentialScope(credential(), 'commit', NOW);
    expect(decision.kind).toBe('SCOPE_GRANTED');
  });

  it('PINNED: a credential scoped to [commit, push] cannot mint actions of family rollback (SCOPE_EXCEEDED)', () => {
    const decision = evaluateCredentialScope(credential(), 'rollback', NOW);
    expect(decision.kind).toBe('SCOPE_EXCEEDED');
    if (decision.kind === 'SCOPE_EXCEEDED') {
      expect(decision.family).toBe('rollback');
      expect(decision.heldFamilies).toEqual(['commit', 'push']);
      expect(decision.detail).toContain('cannot mint');
    }
  });

  it('PINNED: an expired credential fails closed for every family (no grace period)', () => {
    const expired = credential({ expiresAt: NOW });
    for (const family of ['commit', 'push'] as const) {
      const decision = evaluateCredentialScope(expired, family, NOW);
      expect(decision.kind).toBe('CREDENTIAL_EXPIRED');
    }
    const justBefore = evaluateCredentialScope(expired, 'commit', NOW - 1);
    expect(justBefore.kind).toBe('SCOPE_GRANTED');
  });

  it('an unknown or malformed credential holds NOTHING (fail-closed)', () => {
    expect(evaluateCredentialScope(null, 'commit', NOW).kind).toBe('CREDENTIAL_UNKNOWN');
    const malformed = { ...credential(), families: [] };
    expect(evaluateCredentialScope(malformed, 'commit', NOW).kind).toBe('CREDENTIAL_UNKNOWN');
  });

  it('rejects a family outside the vocabulary with the typed error', () => {
    expect(() =>
      evaluateCredentialScope(credential(), 'not-a-family' as never, NOW),
    ).toThrow(CredentialScopeError);
  });

  it('PINNED: scope escalation through the broker is a typed violation (families added)', () => {
    const before = credential();
    const after = credential({ families: ['commit', 'push', 'rollback'] });
    const violation = assertNoBrokerScopeEscalation(before, after);
    expect(violation).not.toBeNull();
    expect(violation?.addedFamilies).toEqual(['rollback']);
    expect(violation?.detail).toContain('cannot silently escalate');
  });

  it('scope escalation via widened expiry is a typed violation', () => {
    const before = credential({ expiresAt: NOW + 10_000 });
    const after = credential({ expiresAt: NOW + 100_000 });
    const violation = assertNoBrokerScopeEscalation(before, after);
    expect(violation?.widenedExpiry).toBe(true);
  });

  it('scope escalation via holder/project change is a typed violation', () => {
    const holderChange = assertNoBrokerScopeEscalation(
      credential(),
      credential({ holderId: 'body-2' }),
    );
    expect(holderChange?.detail).toContain('holder changed');

    const projectChange = assertNoBrokerScopeEscalation(
      credential(),
      credential({ projectId: 'project-B' }),
    );
    expect(projectChange?.detail).toContain('project changed');
  });

  it('a scope NARROWING transition is not a violation (broker may shrink)', () => {
    const before = credential({ families: ['commit', 'push'] });
    const after = credential({ families: ['commit'] });
    expect(assertNoBrokerScopeEscalation(before, after)).toBeNull();
  });

  it('different credential ids describe separate mints, not escalations', () => {
    expect(assertNoBrokerScopeEscalation(credential(), credential({ credentialId: 'cred-2', families: ['rollback'] }))).toBeNull();
  });
});
