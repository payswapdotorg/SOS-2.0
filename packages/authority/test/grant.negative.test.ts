import { describe, expect, it } from 'vitest';
import { createEnvelope } from '@sos-2/semantic-spine';
import {
  assertValidGrant,
  createGrant,
  transitionGrantStatus,
  validateGrant,
  validateGrantContent,
} from '../src/index.js';
import { MISSION_ID, PROVENANCE, T0, baseGrantInput } from './helpers.js';

describe('grant content validation (negative)', () => {
  it('rejects non-object content and wrong field sets', () => {
    expect(() => validateGrantContent(null)).toThrow(/grant content must be an object/);
    expect(() => validateGrantContent({})).toThrow(/exact field set/);
  });

  it('rejects an empty grantee', () => {
    const input = baseGrantInput({ grantee: '' });
    expect(() => createGrant(input)).toThrow(/grantee must be a non-empty string/);
  });

  it('rejects malformed scopes', () => {
    expect(() => createGrant(baseGrantInput({ scope: 'nope' as never }))).toThrow(/scope must be an object/);
    expect(() =>
      createGrant(baseGrantInput({ scope: { kind: 'WORLD' } as never })),
    ).toThrow(/scope kind must be ARTIFACT or KIND/);
    expect(() =>
      createGrant(baseGrantInput({ scope: { kind: 'ARTIFACT', artifact_id: 'not-an-id' } })),
    ).toThrow(/ARTIFACT scope requires/);
    expect(() =>
      createGrant(baseGrantInput({ scope: { kind: 'KIND', artifact_kind: 'NotRegisteredKind' } })),
    ).toThrow(/REGISTERED artifact kind/);
    expect(() =>
      createGrant(baseGrantInput({ scope: { kind: 'KIND', artifact_kind: 'Mission', extra: 1 } as never })),
    ).toThrow(/KIND scope requires/);
  });

  it('rejects malformed expiries', () => {
    expect(() => createGrant(baseGrantInput({ expiry: 'nope' as never }))).toThrow(/expiry must be an object/);
    expect(() =>
      createGrant(baseGrantInput({ expiry: { kind: 'EPOCH' } as never })),
    ).toThrow(/expiry kind must be TIME or REVISION/);
    expect(() =>
      createGrant(baseGrantInput({ expiry: { kind: 'TIME', at: 'soon' } })),
    ).toThrow(/TIME expiry requires/);
    expect(() =>
      createGrant(baseGrantInput({ expiry: { kind: 'REVISION', artifact_id: MISSION_ID, max_version: 0 } })),
    ).toThrow(/REVISION expiry requires/);
    expect(() =>
      createGrant(baseGrantInput({ expiry: { kind: 'REVISION', artifact_id: 'nope', max_version: 2 } })),
    ).toThrow(/REVISION expiry requires/);
  });

  it('rejects empty, unknown or duplicate permissions', () => {
    expect(() => createGrant(baseGrantInput({ permissions: [] }))).toThrow(/permissions must be a non-empty/);
    expect(() => createGrant(baseGrantInput({ permissions: ['ADMIN'] }))).toThrow(/permissions must be a non-empty/);
    expect(() => createGrant(baseGrantInput({ permissions: ['READ', 'READ'] }))).toThrow(/duplicate-free/);
  });

  it('rejects inconsistent revocation fields', () => {
    const grant = createGrant(baseGrantInput());
    const content = { ...grant.content, revoked_at: T0, revocation_provenance: [] };
    expect(() => validateGrantContent(content)).toThrow(/revocation_provenance must be non-empty when revoked_at is set/);
    const content2 = { ...grant.content, revoked_at: null, revocation_provenance: ['x'] };
    expect(() => validateGrantContent(content2)).toThrow(/revocation_provenance must be empty when revoked_at is null/);
    const content3 = { ...grant.content, revoked_at: 'yesterday' };
    expect(() => validateGrantContent(content3)).toThrow(/revoked_at must be an RFC3339 timestamp or null/);
  });

  it('rejects structurally invalid grant artifacts', () => {
    const good = createGrant(baseGrantInput());
    expect(validateGrant({ ...good, extra: 1 })).toBe(false);
    expect(validateGrant({ envelope: good.envelope })).toBe(false);
    const wrongKind = createEnvelope({ kind: 'Mission', provenance: PROVENANCE, created_at: T0 });
    expect(validateGrant({ envelope: wrongKind, content: good.content })).toBe(false);
    expect(() => assertValidGrant('nope')).toThrow(/grant artifact must be an object/);
  });

  it('delegates envelope discipline to the spine', () => {
    expect(() => createGrant(baseGrantInput({ provenance: [] }))).toThrow(/provenance/);
    expect(() => createGrant(baseGrantInput({ created_at: 'someday' }))).toThrow(/RFC3339/);
    expect(() => createGrant(null as never)).toThrow(/input must be an object/);
  });
});

describe('grant status transitions (negative)', () => {
  it('invalid transitions fail loudly', () => {
    expect(() => transitionGrantStatus('REVOKED', 'VALID')).toThrow(/invalid grant status transition: REVOKED -> VALID/);
    expect(() => transitionGrantStatus('EXPIRED', 'VALID')).toThrow(/invalid grant status transition/);
    expect(() => transitionGrantStatus('EXPIRED', 'REVOKED')).toThrow(/invalid grant status transition/);
    expect(() => transitionGrantStatus('REVOKED', 'REVOKED')).toThrow(/invalid grant status transition/);
    expect(() => transitionGrantStatus('VALID', 'VALID')).toThrow(/invalid grant status transition/);
    expect(() => transitionGrantStatus('VALID', 'MYSTERY' as never)).toThrow(/unknown grant status/);
    expect(() => transitionGrantStatus('MYSTERY' as never, 'VALID')).toThrow(/unknown grant status/);
  });

  it('valid transitions are exactly VALID -> EXPIRED and VALID -> REVOKED', () => {
    expect(transitionGrantStatus('VALID', 'EXPIRED')).toBe('EXPIRED');
    expect(transitionGrantStatus('VALID', 'REVOKED')).toBe('REVOKED');
  });
});
