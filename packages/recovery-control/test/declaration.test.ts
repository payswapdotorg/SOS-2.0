import { describe, expect, it } from 'vitest';
import {
  checkRecoveryDeclarationAgainstPolicy,
  createRecoveryDeclaration,
  isBoundedRecoveryMechanism,
  recoveryDeclarationArtifactId,
  validateRecoveryDeclaration,
} from '../src/index.js';
import { isRegisteredArtifactKind } from '@sos-2/semantic-spine';
import { T1, declarationContent, makeDeclaration } from './helpers.js';

describe('recovery declaration creation', () => {
  it('registers the RecoveryDeclaration extension kind in the spine (add-only)', () => {
    expect(isRegisteredArtifactKind('RecoveryDeclaration')).toBe(true);
    expect(isRegisteredArtifactKind('RecoveryPolicy')).toBe(true);
  });

  it('creates a valid declaration with a deterministic content-addressed id', () => {
    const artifact = makeDeclaration();
    expect(validateRecoveryDeclaration(artifact)).toBe(true);
    expect(artifact.envelope.kind).toBe('RecoveryDeclaration');
    expect(artifact.envelope.id).toMatch(/^sos:\/\/RecoveryDeclaration\/[0-9a-f]{32}$/);
    expect(artifact.content.mechanism).toEqual({
      kind: 'ROLLBACK_DEPLOYMENT',
      to_deployment_id: 'deploy-prod-2025-02-28',
    });
    expect(artifact.content.trigger).toEqual({
      kind: 'BUDGET',
      metric: 'payments.error_rate',
      threshold: '0.01',
      window_ms: 300_000,
    });
  });

  it('reproduces identical ids for identical creation input (determinism)', () => {
    const input = {
      content: declarationContent(),
      provenance: ['W8:recovery-control-fixture:declaration'],
      created_at: T1,
      status: 'ACTIVE' as const,
    };
    const a = createRecoveryDeclaration(input);
    const b = createRecoveryDeclaration(JSON.parse(JSON.stringify(input)));
    expect(a).toEqual(b);
    expect(recoveryDeclarationArtifactId(input)).toBe(a.envelope.id);
  });

  it('different mechanism content yields a different id (content sensitivity)', () => {
    const a = makeDeclaration();
    const b = makeDeclaration({
      mechanism: { kind: 'ROLLBACK_DEPLOYMENT', to_deployment_id: 'deploy-prod-2025-02-27' },
    });
    expect(a.envelope.id).not.toBe(b.envelope.id);
  });

  it('canonical round trips preserve validity', () => {
    const artifact = makeDeclaration();
    const round = JSON.parse(JSON.stringify(artifact));
    expect(validateRecoveryDeclaration(round)).toBe(true);
    expect(round).toEqual(artifact);
  });
});

describe('boundedness and policy checks', () => {
  it('bounded mechanisms are recognized; UNSPECIFIED is not bounded', () => {
    expect(isBoundedRecoveryMechanism({ kind: 'ROLLBACK_DEPLOYMENT', to_deployment_id: 'd1' })).toBe(true);
    expect(isBoundedRecoveryMechanism({ kind: 'DISABLE_FEATURE', feature_id: 'f1' })).toBe(true);
    expect(isBoundedRecoveryMechanism({ kind: 'RESTORE_STATE', snapshot_id: 's1' })).toBe(true);
    expect(isBoundedRecoveryMechanism({ kind: 'CUSTOM_PROCEDURE', procedure_ref: 'runbook/rb-12' })).toBe(true);
    expect(isBoundedRecoveryMechanism({ kind: 'UNSPECIFIED' })).toBe(false);
  });

  it('under the default policy: bounded mechanisms satisfy; UNSPECIFIED without exception does not', () => {
    const bounded = checkRecoveryDeclarationAgainstPolicy(
      { kind: 'ROLLBACK_DEPLOYMENT', to_deployment_id: 'd1' },
      null,
      true,
    );
    expect(bounded).toMatchObject({ required: true, satisfied: true });

    const unbounded = checkRecoveryDeclarationAgainstPolicy({ kind: 'UNSPECIFIED' }, null, true);
    expect(unbounded.satisfied).toBe(false);
    expect(unbounded.reason).toContain('UNBOUNDED RECOVERY REJECTED');

    const excused = checkRecoveryDeclarationAgainstPolicy(
      { kind: 'UNSPECIFIED' },
      {
        authority_ref: 'sos://Decision/abcdef0123456789abcdef0123456789',
        containment: 'Out-of-band containment.',
        provenance: ['p'],
      },
      true,
    );
    expect(excused.satisfied).toBe(true);
    expect(excused.reason).toContain('governed exception');
  });

  it('a weakened policy (weakened only through the governed path) does not require boundedness', () => {
    const unbounded = checkRecoveryDeclarationAgainstPolicy({ kind: 'UNSPECIFIED' }, null, false);
    expect(unbounded).toMatchObject({ required: false, satisfied: true });
  });
});
