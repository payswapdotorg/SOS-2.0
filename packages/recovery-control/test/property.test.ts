import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  RecoveryGate,
  checkRecoveryDeclarationAgainstPolicy,
  createRecoveryDeclaration,
  createRecoveryPolicy,
  updateRecoveryPolicy,
  validateRecoveryDeclaration,
} from '../src/index.js';
import type { RecoveryMechanism, RecoveryTrigger } from '../src/index.js';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import {
  CHANGE_REF,
  GOVERNED_EXCEPTION,
  T0,
  T1,
  T2,
  grantFor,
  rehearsalEvidence,
} from './helpers.js';

/**
 * Property tests for @sos-2/recovery-control (fixed seed — deterministic
 * and reproducible): creation/update/gate determinism + canonical round
 * trips + policy-check totality over randomized declarations.
 */

const fcMechanism: fc.Arbitrary<RecoveryMechanism> = fc.oneof(
  fc.record({ kind: fc.constant('ROLLBACK_DEPLOYMENT' as const), to_deployment_id: fc.stringMatching(/^deploy-[a-z0-9-]{3,20}$/) }),
  fc.record({ kind: fc.constant('DISABLE_FEATURE' as const), feature_id: fc.stringMatching(/^feature-[a-z0-9-]{3,20}$/) }),
  fc.record({ kind: fc.constant('RESTORE_STATE' as const), snapshot_id: fc.stringMatching(/^snap-[a-z0-9-]{3,20}$/) }),
  fc.record({ kind: fc.constant('CUSTOM_PROCEDURE' as const), procedure_ref: fc.stringMatching(/^runbook\/[a-z0-9-]{3,20}$/) }),
  fc.record({ kind: fc.constant('UNSPECIFIED' as const) }),
);

const fcTrigger: fc.Arbitrary<RecoveryTrigger> = fc.oneof(
  fc.record({
    kind: fc.constant('BUDGET' as const),
    metric: fc.stringMatching(/^payments\.[a-z_.]{3,20}$/),
    threshold: fc.stringMatching(/^0\.[0-9]{1,4}$/),
    window_ms: fc.integer({ min: 1, max: 3_600_000 }),
  }),
  fc.record({ kind: fc.constant('DEADLINE' as const), within_ms: fc.integer({ min: 1, max: 86_400_000 }) }),
  fc.record({
    kind: fc.constant('MANUAL' as const),
    authority_ref: fc.constant('sos://Decision/abcdef0123456789abcdef0123456789'),
  }),
);

const fcException = fc.option(
  fc.record({
    authority_ref: fc.constant('sos://Decision/abcdef0123456789abcdef0123456789'),
    containment: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 .,-]{8,60}$/),
    provenance: fc.array(fc.stringMatching(/^[a-z]+:[a-z0-9-]{2,20}$/), { minLength: 1, maxLength: 3 }),
  }),
  { nil: null },
);

describe('property: randomized recovery declarations', () => {
  it('every generated declaration is valid, deterministic and round-trips canonically', () => {
    fc.assert(
      fc.property(fcMechanism, fcTrigger, fcException, (mechanism, trigger, exception) => {
        const grantId = grantFor({ kind: 'ARTIFACT', artifact_id: CHANGE_REF }, ['PROMOTE']).envelope.id;
        const content = {
          change_ref: CHANGE_REF,
          mechanism,
          trigger,
          authority_ref: grantId,
          evidence_ref: rehearsalEvidence().id,
          exception,
        };
        const input = { content, provenance: ['W8:property-test'], created_at: T1, status: 'ACTIVE' as const };
        const a = createRecoveryDeclaration(input);
        const b = createRecoveryDeclaration(JSON.parse(JSON.stringify(input)));
        expect(a).toEqual(b);
        expect(validateRecoveryDeclaration(a)).toBe(true);
        const round = JSON.parse(JSON.stringify(a));
        expect(validateRecoveryDeclaration(round)).toBe(true);
        expect(round).toEqual(a);
        return true;
      }),
    );
  });

  it('policy check totality: satisfaction is exactly (bounded OR exception OR policy-off)', () => {
    fc.assert(
      fc.property(fcMechanism, fcException, fc.boolean(), (mechanism, exception, policyOn) => {
        const verdict = checkRecoveryDeclarationAgainstPolicy(mechanism, exception, policyOn);
        const bounded = mechanism.kind !== 'UNSPECIFIED';
        const expected = !policyOn || bounded || exception !== null;
        expect(verdict.satisfied).toBe(expected);
        expect(verdict.required).toBe(policyOn);
        return true;
      }),
    );
  });
});

describe('property: policy updates and gate behavior', () => {
  it('policy updates are deterministic for identical change input', () => {
    fc.assert(
      fc.property(fc.boolean(), (weaken) => {
        const policy = createRecoveryPolicy({ provenance: ['W8:property-test'], created_at: T0, status: 'ACTIVE' });
        const grant = grantFor({ kind: 'KIND', artifact_kind: 'RecoveryPolicy' }, ['REVISE']);
        const change = {
          origin: 'TRUSTED_OPERATORS' as const,
          set: { require_bounded_recovery: !weaken },
          grant,
          at: { kind: 'TIME' as const, now: T1 },
          governed_exception: weaken ? GOVERNED_EXCEPTION : null,
          provenance: ['W8:property-test:policy'],
          created_at: T2,
        };
        expect(updateRecoveryPolicy(policy, change)).toEqual(
          updateRecoveryPolicy(policy, JSON.parse(JSON.stringify(change))),
        );
        return true;
      }),
    );
  });

  it('gate registration is deterministic for identical inputs', () => {
    fc.assert(
      fc.property(fcMechanism.filter((mechanism) => mechanism.kind !== 'UNSPECIFIED'), fcTrigger, (mechanism, trigger) => {
        const grant = grantFor({ kind: 'ARTIFACT', artifact_id: CHANGE_REF }, ['PROMOTE']);
        const declaration = createRecoveryDeclaration({
          content: {
            change_ref: CHANGE_REF,
            mechanism,
            trigger,
            authority_ref: grant.envelope.id,
            evidence_ref: rehearsalEvidence().id,
            exception: null,
          },
          provenance: ['W8:property-test'],
          created_at: T1,
          status: 'ACTIVE',
        });
        const gateA = new RecoveryGate(
          createRecoveryPolicy({ provenance: ['W8:property-test'], created_at: T0, status: 'ACTIVE' }),
        );
        const gateB = new RecoveryGate(
          createRecoveryPolicy({ provenance: ['W8:property-test'], created_at: T0, status: 'ACTIVE' }),
        );
        const registration = {
          declaration,
          grant,
          now: T1,
          evidence: [rehearsalEvidence()] as const,
        };
        expect(gateA.registerLiveChange(registration)).toEqual(gateB.registerLiveChange(registration));
        expect(gateA.liveChanges()).toEqual(gateB.liveChanges());
        return true;
      }),
    );
  });

  it('a minted declaration id always carries the RecoveryPolicy-free RecoveryDeclaration kind segment', () => {
    fc.assert(
      fc.property(fcMechanism.filter((m) => m.kind !== 'UNSPECIFIED'), (mechanism) => {
        const grantId = deriveDeterministicArtifactId('AuthorityGrant', { note: 'property-grant' });
        const declaration = createRecoveryDeclaration({
          content: {
            change_ref: CHANGE_REF,
            mechanism,
            trigger: { kind: 'DEADLINE', within_ms: 1000 },
            authority_ref: grantId,
            evidence_ref: rehearsalEvidence().id,
            exception: null,
          },
          provenance: ['W8:property-test'],
          created_at: T1,
          status: 'ACTIVE',
        });
        expect(declaration.envelope.id).toMatch(/^sos:\/\/RecoveryDeclaration\/[0-9a-f]{32}$/);
        return true;
      }),
    );
  });
});
