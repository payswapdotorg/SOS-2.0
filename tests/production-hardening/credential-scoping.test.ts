/**
 * Credential scoping acceptance: PINNED — a credential scoped to X
 * cannot mint actions of family Y; broker scope escalation is a typed
 * violation. The action-family vocabulary is verified EQUAL to the
 * merged P9 ACTION_FAMILIES (imported through the test-time alias).
 */
import { describe, expect, it } from 'vitest';
import { ACTION_FAMILIES } from '@sos-2/action-gateway';
import {
  ACTION_FAMILY_VOCABULARY,
  evaluateCredentialScope,
  assertNoBrokerScopeEscalation,
  type CredentialScopeRecord,
} from '@sos-2/security';

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

describe('acceptance: credential scoping over the P9 action families', () => {
  it('PINNED: the P14 vocabulary IS the merged P9 ACTION_FAMILIES (equal sets, equal order)', () => {
    expect([...ACTION_FAMILY_VOCABULARY]).toEqual([...ACTION_FAMILIES]);
  });

  it('PINNED: a credential scoped to [commit, push] cannot mint actions of family rollback or deployment', () => {
    for (const family of ['rollback', 'deployment', 'body-lifecycle'] as const) {
      const decision = evaluateCredentialScope(credential(), family, NOW);
      expect(decision.kind, `family ${family}`).toBe('SCOPE_EXCEEDED');
    }
  });

  it('every family of the merged P9 vocabulary is scoppable (the vocabulary is total over the nine families)', () => {
    const all = credential({ families: [...ACTION_FAMILIES] });
    for (const family of ACTION_FAMILIES) {
      expect(evaluateCredentialScope(all, family, NOW).kind, `family ${family}`).toBe('SCOPE_GRANTED');
    }
  });

  it('PINNED: scope escalation through the broker is a typed violation (added family, widened expiry, holder or project change)', () => {
    const escalationByFamily = assertNoBrokerScopeEscalation(
      credential({ families: ['commit'] }),
      credential({ families: ['commit', 'push'] }),
    );
    expect(escalationByFamily?.addedFamilies).toEqual(['push']);

    const escalationByExpiry = assertNoBrokerScopeEscalation(
      credential({ expiresAt: NOW + 10_000 }),
      credential({ expiresAt: NOW + 100_000 }),
    );
    expect(escalationByExpiry?.widenedExpiry).toBe(true);

    const escalationByHolder = assertNoBrokerScopeEscalation(credential(), credential({ holderId: 'body-2' }));
    expect(escalationByHolder).not.toBeNull();

    const escalationByProject = assertNoBrokerScopeEscalation(credential(), credential({ projectId: 'project-B' }));
    expect(escalationByProject).not.toBeNull();
  });

  it('scope NARROWING is legal (the broker may shrink, never widen)', () => {
    expect(assertNoBrokerScopeEscalation(credential({ families: ['commit', 'push'] }), credential({ families: ['commit'] }))).toBeNull();
    expect(
      assertNoBrokerScopeEscalation(credential({ expiresAt: NOW + 100_000 }), credential({ expiresAt: NOW + 10_000 })),
    ).toBeNull();
  });
});
