import { describe, expect, it } from 'vitest';
import {
  RecoveryGate,
  assertValidGovernedException,
  assertValidRecoveryDeclaration,
  assertValidRecoveryMechanism,
  assertValidRecoveryTrigger,
  createRecoveryDeclaration,
  createRecoveryPolicy,
} from '../src/index.js';
import type { RecoveryDeclarationContent } from '../src/index.js';
import { CHANGE_REF, T0, T1, declarationContent, grantFor, makeDeclaration, rehearsalEvidence } from './helpers.js';

/**
 * Negative tests for @sos-2/recovery-control: unbounded recovery without a
 * governed exception, malformed mechanisms/triggers/exceptions, candidate
 * attempts to disable controls, and gate refusals. Every refusal is loud.
 */

describe('declaration validation rejects malformed content (loudly)', () => {
  it('rejects non-Evidence evidence references and non-spine change/authority references', () => {
    expect(() =>
      createRecoveryDeclaration({
        content: declarationContent({ evidence_ref: 'sos://Mission/abcdef0123456789abcdef0123456789' }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/kind Evidence/);
    expect(() =>
      createRecoveryDeclaration({
        content: declarationContent({ change_ref: 'payments-service' }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/change_ref/);
    expect(() =>
      createRecoveryDeclaration({
        content: declarationContent({ authority_ref: 'the-team' }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/authority_ref/);
  });

  it('rejects wrong field sets at content level (all four declarations are mandatory)', () => {
    const content = declarationContent() as unknown as Record<string, unknown>;
    delete content['trigger'];
    expect(() =>
      createRecoveryDeclaration({
        content: content as unknown as RecoveryDeclarationContent,
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/mechanism, trigger, authority and evidence are ALL mandatory/);
  });

  it('rejects malformed mechanisms', () => {
    expect(() => assertValidRecoveryMechanism({ kind: 'WE FIGURE IT OUT' })).toThrow(/kind must be one of/);
    expect(() =>
      assertValidRecoveryMechanism({ kind: 'ROLLBACK_DEPLOYMENT', to_deployment_id: '' }),
    ).toThrow(/to_deployment_id/);
    expect(() => assertValidRecoveryMechanism({ kind: 'DISABLE_FEATURE' })).toThrow(/feature_id/);
    expect(() => assertValidRecoveryMechanism({ kind: 'RESTORE_STATE', snapshot_id: null })).toThrow(/snapshot_id/);
    expect(() => assertValidRecoveryMechanism({ kind: 'CUSTOM_PROCEDURE', procedure_ref: '' })).toThrow(
      /procedure_ref/,
    );
    expect(() => assertValidRecoveryMechanism({ kind: 'UNSPECIFIED', extra: 1 })).toThrow(/exactly \{ kind \}/);
  });

  it('rejects malformed triggers ("someone will notice" is not a trigger)', () => {
    expect(() => assertValidRecoveryTrigger({ kind: 'VIBES' })).toThrow(/kind must be one of/);
    expect(() =>
      assertValidRecoveryTrigger({ kind: 'BUDGET', metric: '', threshold: '0.01', window_ms: 1000 }),
    ).toThrow(/BUDGET trigger/);
    expect(() =>
      assertValidRecoveryTrigger({ kind: 'BUDGET', metric: 'm', threshold: '0.01', window_ms: 0 }),
    ).toThrow(/BUDGET trigger/);
    expect(() =>
      assertValidRecoveryTrigger({ kind: 'BUDGET', metric: 'm', threshold: '0.01', window_ms: 1.5 }),
    ).toThrow(/BUDGET trigger/);
    expect(() => assertValidRecoveryTrigger({ kind: 'DEADLINE', within_ms: -5 })).toThrow(/DEADLINE trigger/);
    expect(() => assertValidRecoveryTrigger({ kind: 'MANUAL', authority_ref: 'on-call' })).toThrow(
      /MANUAL trigger/,
    );
  });

  it('rejects malformed governed exceptions (no anonymous exceptions)', () => {
    expect(() => assertValidGovernedException(null)).toThrow();
    expect(() => assertValidGovernedException({ authority_ref: 'boss', containment: 'c', provenance: ['p'] })).toThrow(
      /authority_ref/,
    );
    expect(() =>
      assertValidGovernedException({
        authority_ref: 'sos://Decision/abcdef0123456789abcdef0123456789',
        containment: '',
        provenance: ['p'],
      }),
    ).toThrow(/containment/);
    expect(() =>
      assertValidGovernedException({
        authority_ref: 'sos://Decision/abcdef0123456789abcdef0123456789',
        containment: 'c',
        provenance: [],
      }),
    ).toThrow(/provenance/);
  });

  it('rejects non-object artifacts and wrong envelope kinds at full validation', () => {
    expect(() => assertValidRecoveryDeclaration(null)).toThrow();
    expect(() => assertValidRecoveryDeclaration('decl')).toThrow();
    const declaration = makeDeclaration();
    // Changing the envelope kind breaks the spine id/kind integrity FIRST
    // (the id segment still declares RecoveryDeclaration) — the kind check
    // is reached through the spine's own envelope validation.
    expect(() =>
      assertValidRecoveryDeclaration({ envelope: { ...declaration.envelope, kind: 'Mission' }, content: declaration.content }),
    ).toThrow(/RecoveryDeclaration/);
  });
});

describe('the gate rejects invalid registration input (loudly)', () => {
  function gate() {
    return new RecoveryGate(
      createRecoveryPolicy({ provenance: ['x'], created_at: T0, status: 'ACTIVE' }),
    );
  }

  it('rejects bad instants, non-array evidence and invalid declarations', () => {
    const grant = grantFor({ kind: 'ARTIFACT', artifact_id: CHANGE_REF }, ['PROMOTE']);
    const declaration = makeDeclaration({ authority_ref: grant.envelope.id });
    expect(() =>
      gate().registerLiveChange({ declaration, grant, now: 'later', evidence: [] }),
    ).toThrow(/RFC3339/);
    expect(() =>
      gate().registerLiveChange({ declaration, grant, now: T1, evidence: 'pool' as never }),
    ).toThrow(/array/);
    expect(() =>
      gate().registerLiveChange({ declaration: null as never, grant, now: T1, evidence: [] }),
    ).toThrow();
  });

  it('rejects an evidence pool containing invalid records', () => {
    const grant = grantFor({ kind: 'ARTIFACT', artifact_id: CHANGE_REF }, ['PROMOTE']);
    const declaration = makeDeclaration({ authority_ref: grant.envelope.id });
    const bogus = { ...rehearsalEvidence(), provenance: [] };
    expect(() =>
      gate().registerLiveChange({ declaration, grant, now: T1, evidence: [bogus] }),
    ).toThrow(/invalid record/);
  });

  it('rejects an unbounded declaration even when the grant and evidence are perfect (policy first, fail-safe)', () => {
    const grant = grantFor({ kind: 'ARTIFACT', artifact_id: CHANGE_REF }, ['PROMOTE']);
    const unbounded = makeDeclaration({ authority_ref: grant.envelope.id, mechanism: { kind: 'UNSPECIFIED' } });
    expect(() =>
      gate().registerLiveChange({ declaration: unbounded, grant, now: T1, evidence: [rehearsalEvidence()] }),
    ).toThrow(/UNBOUNDED RECOVERY REJECTED/);
  });
});
