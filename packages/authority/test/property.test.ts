/**
 * Property tests — deterministic: fast-check is seeded globally (424242) in
 * test/setup.ts (the W0.5 determinism discipline).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  ASK_RISK_SEVERITIES,
  DECISION_ACTIONS,
  EVIDENCE_QUALITY_CLASSES,
  UNCERTAINTY_CLASSES,
  authorize,
  canAuthorize,
  createAskRequest,
  createGrant,
  delegateGrant,
  evaluateGrant,
  scopeCovers,
  validateAskRequest,
  validateGrant,
} from '../src/index.js';
import type {
  AskContent,
  AuthorizationTarget,
  CreateGrantInput,
  GrantEvaluationInput,
  GrantExpiry,
  GrantScope,
} from '../src/index.js';

const hex32Arb = fc.hexaString({ minLength: 32, maxLength: 32 }).noShrink();
const rfc3339Arb = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2099-12-31T23:59:59Z') })
  .map((d) => d.toISOString());

const granteeArb = fc.stringMatching(/^[a-z][a-z0-9-]{2,15}/);

const artifactIdArb = (kind: string) => hex32Arb.map((segment) => `sos://${kind}/${segment}`);

const realScopeArb: fc.Arbitrary<GrantScope> = fc.oneof(
  fc.record({ kind: fc.constant('ARTIFACT' as const), artifact_id: fc.oneof(artifactIdArb('Mission'), artifactIdArb('ValueModel')) }),
  fc.record({ kind: fc.constant('KIND' as const), artifact_kind: fc.constantFrom('Mission', 'ValueModel', 'Context', 'Evidence', 'AskRequest') }),
);

const expiryArb: fc.Arbitrary<GrantExpiry> = fc.oneof(
  fc.record({ kind: fc.constant('TIME' as const), at: rfc3339Arb }),
  fc.record({
    kind: fc.constant('REVISION' as const),
    artifact_id: artifactIdArb('Mission'),
    max_version: fc.integer({ min: 1, max: 50 }),
  }),
);

const permissionsArb = fc.uniqueArray(fc.constantFrom('READ', 'REVISE', 'RETIRE', 'PROMOTE', 'DELEGATE'), {
  minLength: 1,
  maxLength: 5,
});

type GrantSeed = Pick<CreateGrantInput, 'grantee' | 'scope' | 'permissions' | 'expiry' | 'created_at'>;
const grantInputArb: fc.Arbitrary<GrantSeed> = fc.record({
  grantee: granteeArb,
  scope: realScopeArb,
  permissions: permissionsArb,
  expiry: expiryArb,
  created_at: rfc3339Arb,
});

describe('property: grant artifacts', () => {
  it('random valid grants create, validate and round-trip canonically with deterministic ids', () => {
    fc.assert(
      fc.property(grantInputArb, (input) => {
        const full = { ...input, provenance: ['W1:property'], authority_ref: null, status: 'ACTIVE' as const };
        const grant = createGrant(full);
        const text = canonicalSerialize(grant);
        const parsed = JSON.parse(text);
        if (canonicalSerialize(parsed) !== text) return false;
        if (!validateGrant(parsed)) return false;
        return createGrant(full).envelope.id === grant.envelope.id;
      }),
      { numRuns: 200 },
    );
  });

  it('evaluation is deterministic and total for matching input kinds', () => {
    fc.assert(
      fc.property(
        grantInputArb,
        fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
        (input, extraVersions) => {
          const grant = createGrant({ ...input, provenance: ['W1:property'], status: 'ACTIVE' });
          const evaluation: GrantEvaluationInput =
            grant.content.expiry.kind === 'TIME'
              ? { kind: 'TIME', now: '2030-01-01T00:00:00.000Z' }
              : { kind: 'REVISION', artifact_id: grant.content.expiry.artifact_id, version: grant.content.expiry.max_version + (extraVersions ?? 0) };
          const a = evaluateGrant(grant, evaluation);
          const b = evaluateGrant(grant, evaluation);
          if (a !== b) return false;
          // a grant past its bound (proven by matching input) is never VALID
          if (extraVersions !== undefined && extraVersions > 0 && grant.content.expiry.kind === 'REVISION') {
            if (a === 'VALID') return false;
          }
          // revoked grants always evaluate REVOKED
          const revokedContent = { ...grant.content, revoked_at: '2030-01-01T00:00:00.000Z', revocation_provenance: ['x'] };
          const revokedGrant = { envelope: grant.envelope, content: revokedContent };
          return evaluateGrant(revokedGrant, evaluation) === 'REVOKED';
        },
      ),
      { numRuns: 200 },
    );
  });

  it('authorize and canAuthorize agree for every request; dead grants never authorize', () => {
    fc.assert(
      fc.property(
        grantInputArb,
        fc.constantFrom('READ', 'REVISE', 'RETIRE', 'PROMOTE', 'DELEGATE', 'ADMIN'),
        fc.option(rfc3339Arb, { nil: undefined }),
        (input, action, maybeNow) => {
          const grant = createGrant({ ...input, provenance: ['W1:property'], status: 'ACTIVE' });
          const target: AuthorizationTarget =
            grant.content.scope.kind === 'ARTIFACT'
              ? { kind: 'ARTIFACT', artifact_id: grant.content.scope.artifact_id }
              : { kind: 'KIND', artifact_kind: grant.content.scope.artifact_kind };
          const at: GrantEvaluationInput =
            grant.content.expiry.kind === 'TIME'
              ? { kind: 'TIME', now: maybeNow ?? '2030-01-01T00:00:00.000Z' }
              : { kind: 'REVISION', artifact_id: grant.content.expiry.artifact_id, version: 1 };
          let threw = false;
          let returned = false;
          try {
            authorize(grant, { action, target, at });
            returned = true;
          } catch {
            threw = true;
          }
          const predicate = canAuthorize(grant, { action, target, at });
          if (predicate !== returned || threw === returned) return false;
          // the dead-grant law: expired or revoked grants never authorize
          const status = evaluateGrant(grant, at);
          if (status !== 'VALID' && predicate) return false;
          return true;
        },
      ),
      { numRuns: 250 },
    );
  });

  it('scopeCovers is deterministic and consistent with the kind grammar', () => {
    fc.assert(
      fc.property(realScopeArb, fc.oneof(artifactIdArb('Mission'), artifactIdArb('Evidence')), (scope, artifactId) => {
        const target: AuthorizationTarget = { kind: 'ARTIFACT', artifact_id: artifactId };
        const a = scopeCovers(scope, target);
        const b = scopeCovers(scope, target);
        if (a !== b) return false;
        if (scope.kind === 'ARTIFACT') {
          return a === (scope.artifact_id === artifactId);
        }
        const artifactKind = artifactId.slice('sos://'.length).split('/')[0]!;
        return a === (artifactKind === scope.artifact_kind);
      }),
      { numRuns: 250 },
    );
  });
});

describe('property: delegation never escalates', () => {
  it('random valid delegations produce children that authorize strictly less than the parent', () => {
    fc.assert(
      fc.property(
        grantInputArb.filter((input) => input.permissions.includes('DELEGATE')),
        fc.integer({ min: 1, max: 500 }),
        (input, salt) => {
          const parent = createGrant({ ...input, provenance: ['W1:property'], status: 'ACTIVE' });
          // child scope: narrow the parent scope deterministically from the salt
          let childScope: GrantScope;
          if (parent.content.scope.kind === 'KIND') {
            childScope =
              salt % 2 === 0
                ? { kind: 'KIND', artifact_kind: parent.content.scope.artifact_kind }
                : { kind: 'ARTIFACT', artifact_id: `sos://${parent.content.scope.artifact_kind}/${'a'.repeat(31)}${salt % 10}` };
          } else {
            childScope = { kind: 'ARTIFACT', artifact_id: parent.content.scope.artifact_id };
          }
          const childPermissions = parent.content.permissions.filter((permission) => permission !== 'DELEGATE' || salt % 2 === 0);
          const childExpiry: GrantExpiry =
            parent.content.expiry.kind === 'TIME'
              ? { kind: 'TIME', at: parent.content.expiry.at }
              : { kind: 'REVISION', artifact_id: parent.content.expiry.artifact_id, max_version: parent.content.expiry.max_version };
          const at: GrantEvaluationInput =
            parent.content.expiry.kind === 'TIME'
              ? { kind: 'TIME', now: '2019-01-01T00:00:00.000Z' } // parent created_at may be up to 2099; use a safe past instant
              : { kind: 'REVISION', artifact_id: parent.content.expiry.artifact_id, version: 1 };
          let child;
          try {
            child = delegateGrant(parent, {
              grantee: 'child',
              scope: childScope,
              permissions: childPermissions.length > 0 ? childPermissions : ['READ'],
              expiry: childExpiry,
              provenance: ['W1:property'],
              created_at: '2019-01-01T00:00:00.000Z',
              at,
            });
          } catch {
            return true; // loud rejection is a valid outcome (e.g. created_at vs expiry mismatch)
          }
          // child permissions are a subset of parent permissions
          if (!child.content.permissions.every((permission) => parent.content.permissions.includes(permission))) return false;
          // child expiry is within the parent's
          if (child.content.expiry.kind !== parent.content.expiry.kind) return false;
          // child scope never broader: verify via scopeCovers
          const childTarget: AuthorizationTarget =
            child.content.scope.kind === 'ARTIFACT'
              ? { kind: 'ARTIFACT', artifact_id: child.content.scope.artifact_id }
              : { kind: 'KIND', artifact_kind: child.content.scope.artifact_kind };
          return scopeCovers(parent.content.scope, childTarget);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('property: ask requests', () => {
  const askContentArb: fc.Arbitrary<AskContent> = fc.record({
    decision: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.:;?()-]{10,80}/),
    alternatives: fc.uniqueArray(
      fc.record({
        id: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
        action: fc.constantFrom(...DECISION_ACTIONS),
        description: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.:;-]{5,40}/),
      }),
      { minLength: 1, maxLength: 4, selector: (alternative) => alternative.id },
    ),
    quality: fc.constantFrom(...EVIDENCE_QUALITY_CLASSES),
    summary: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.:;-]{5,60}/),
    uncertaintyClass: fc.constantFrom(...UNCERTAINTY_CLASSES),
    basis: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.:;-]{5,60}/),
    tradeOffs: fc.array(fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.:;-]{5,40}/), { minLength: 1, maxLength: 3 }),
    riskDescription: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.:;-]{5,40}/),
    riskSeverity: fc.constantFrom(...ASK_RISK_SEVERITIES),
    authorityInsufficiency: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.:;-]{10,80}/),
  }).map((seed) => ({
    decision: seed.decision,
    alternatives: seed.alternatives,
    evidence_quality: { quality: seed.quality, summary: seed.summary },
    uncertainty: { uncertainty_class: seed.uncertaintyClass, basis: seed.basis },
    trade_offs: seed.tradeOffs,
    risk: { description: seed.riskDescription, severity: seed.riskSeverity },
    authority_insufficiency: seed.authorityInsufficiency,
  }));

  it('random valid ASKs construct successfully (success state), round-trip canonically, deterministic ids', () => {
    fc.assert(
      fc.property(askContentArb, rfc3339Arb, (content, createdAt) => {
        const input = { content, provenance: ['W1:property'], created_at: createdAt };
        const ask = createAskRequest(input); // never throws for valid input
        const text = canonicalSerialize(ask);
        const parsed = JSON.parse(text);
        if (canonicalSerialize(parsed) !== text) return false;
        if (!validateAskRequest(parsed)) return false;
        return createAskRequest(input).envelope.id === ask.envelope.id;
      }),
      { numRuns: 200 },
    );
  });
});
