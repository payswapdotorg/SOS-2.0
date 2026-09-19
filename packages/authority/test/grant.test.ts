import { describe, expect, it } from 'vitest';
import { canonicalSerialize, isArtifactId } from '@sos-2/semantic-spine';
import {
  AUTHORITY_GRANT_KIND,
  DECISION_ACTIONS,
  GRANT_PERMISSIONS,
  GRANT_STATUSES,
  ALLOWED_GRANT_TRANSITIONS,
  createGrant,
  grantArtifactId,
  isGrantPermission,
  validateGrant,
} from '../src/index.js';
import type { GrantContent } from '../src/index.js';
import { AFTER, MISSION_ID, OTHER_MISSION_ID, PROVENANCE, T0, T1, T2, baseGrantInput } from './helpers.js';
import type { CreateGrantInput } from './helpers.js';

describe('grant creation (unit)', () => {
  it('creates a grant artifact of kind AuthorityGrant with a spine identity', () => {
    const grant = createGrant(baseGrantInput());
    expect(grant.envelope.kind).toBe(AUTHORITY_GRANT_KIND);
    expect(isArtifactId(grant.envelope.id)).toBe(true);
    expect(grant.envelope.id.startsWith('sos://AuthorityGrant/')).toBe(true);
    expect(grant.envelope.status).toBe('DRAFT');
    expect(grant.content.revoked_at).toBeNull();
    expect(grant.content.revocation_provenance).toEqual([]);
  });

  it('mints content-addressed ids deterministically', () => {
    const input = baseGrantInput();
    const content: GrantContent = {
      grantee: input.grantee,
      scope: structuredClone(input.scope),
      permissions: [...input.permissions!],
      expiry: structuredClone(input.expiry),
      revoked_at: null,
      revocation_provenance: [],
    };
    const a = createGrant(input);
    const b = createGrant(input);
    expect(a.envelope.id).toBe(b.envelope.id);
    expect(a.envelope.id).toBe(grantArtifactId(input, content));
  });

  it('different grantee/scope/permissions/expiry -> different ids', () => {
    const ids = [
      createGrant(baseGrantInput()).envelope.id,
      createGrant(baseGrantInput({ grantee: 'someone-else' })).envelope.id,
      createGrant(baseGrantInput({ scope: { kind: 'ARTIFACT', artifact_id: OTHER_MISSION_ID } })).envelope.id,
      createGrant(baseGrantInput({ permissions: ['READ'] })).envelope.id,
      createGrant(baseGrantInput({ expiry: { kind: 'TIME', at: T1 } })).envelope.id,
      createGrant(baseGrantInput({ expiry: { kind: 'REVISION', artifact_id: MISSION_ID, max_version: 3 } })).envelope.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('validates and round-trips through canonical serialization', () => {
    const grant = createGrant(baseGrantInput());
    expect(validateGrant(grant)).toBe(true);
    const text = canonicalSerialize(grant);
    const parsed = JSON.parse(text);
    expect(validateGrant(parsed)).toBe(true);
    expect(canonicalSerialize(parsed)).toBe(text);
  });

  it('supports KIND scopes over registered kinds', () => {
    const grant = createGrant(baseGrantInput({ scope: { kind: 'KIND', artifact_kind: 'Mission' } }));
    expect(grant.content.scope).toEqual({ kind: 'KIND', artifact_kind: 'Mission' });
  });

  it('supports revision-bound expiry', () => {
    const grant = createGrant(
      baseGrantInput({ expiry: { kind: 'REVISION', artifact_id: MISSION_ID, max_version: 2 } }),
    );
    expect(grant.content.expiry).toEqual({ kind: 'REVISION', artifact_id: MISSION_ID, max_version: 2 });
  });
});

describe('vocabularies', () => {
  it('grant permissions are the frozen five', () => {
    expect(GRANT_PERMISSIONS).toEqual(['READ', 'REVISE', 'RETIRE', 'PROMOTE', 'DELEGATE']);
    expect(isGrantPermission('REVISE')).toBe(true);
    expect(isGrantPermission('ADMIN')).toBe(false);
  });

  it('decision actions are the frozen six from spec/architecture.md §5', () => {
    expect(DECISION_ACTIONS).toEqual(['ACT', 'EXPERIMENT', 'GATHER_EVIDENCE', 'ASK', 'REJECT', 'ROLLBACK']);
    expect(DECISION_ACTIONS).toContain('ASK');
  });

  it('grant statuses and the transition table are VALID -> {EXPIRED, REVOKED}, terminal otherwise', () => {
    expect(GRANT_STATUSES).toEqual(['VALID', 'EXPIRED', 'REVOKED']);
    expect(ALLOWED_GRANT_TRANSITIONS.VALID).toEqual(['EXPIRED', 'REVOKED']);
    expect(ALLOWED_GRANT_TRANSITIONS.EXPIRED).toEqual([]);
    expect(ALLOWED_GRANT_TRANSITIONS.REVOKED).toEqual([]);
  });
});
