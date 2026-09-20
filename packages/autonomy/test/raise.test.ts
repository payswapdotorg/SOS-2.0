/**
 * Unit tests: GOVERNED autonomy raises — minting discipline, applicability,
 * structural validation, end-to-end enforcement consumption.
 */

import { describe, expect, it } from 'vitest';
import {
  assertValidAutonomyRaise,
  authorizeAutonomyRaise,
  autonomyRaiseId,
  AUTONOMY_RAISE_KIND,
  evaluateAuthorityCoverage,
  raiseApplies,
  validateAutonomyRaise,
} from '../src/index.js';
import type { AutonomyRaiseArtifact } from '../src/index.js';
import { PROVENANCE, T1, enforcementRequest, expiredGrant, sampleRaise, validGrant } from './helpers.js';
import { isRegisteredArtifactKind, parseArtifactId } from '@sos-2/semantic-spine';

function mintOptions() {
  return {
    action_kind: 'REVISE' as const,
    scope: { kind: 'KIND', artifact_kind: 'Mission' } as const,
    blast_radius: 'ORGANIZATION' as const,
    to_level: 'BOUNDED' as const,
    rationale: 'Organization-wide revision authority demonstrated by six incident-free months.',
    grant: validGrant(),
    at: { kind: 'TIME', now: T1 },
    provenance: PROVENANCE,
    created_at: T1,
    status: 'ACTIVE' as const,
  };
}

describe('raise minting', () => {
  it('mints a valid raise artifact with a deterministic content-addressed id', () => {
    const raise = authorizeAutonomyRaise(mintOptions());
    expect(parseArtifactId(raise.envelope.id).kind).toBe(AUTONOMY_RAISE_KIND);
    expect(isRegisteredArtifactKind(AUTONOMY_RAISE_KIND)).toBe(true);
    expect(() => assertValidAutonomyRaise(raise)).not.toThrow();
    expect(validateAutonomyRaise(raise)).toBe(true);
    expect(raise.content.from_level).toBe('SUPERVISED');
    expect(raise.content.to_level).toBe('BOUNDED');
    expect(raise.content.authorizing_grant_ref).toBe(mintOptions().grant.envelope.id);
    // Determinism: minting the same input again mints the same artifact.
    expect(authorizeAutonomyRaise(mintOptions())).toEqual(raise);
    expect(autonomyRaiseId(mintOptions(), raise.content)).toBe(raise.envelope.id);
  });

  it('the raise never outlives its authorizing grant (expiry within the grant bound)', () => {
    const grant = validGrant(); // TIME expiry at T2
    const raise = authorizeAutonomyRaise(mintOptions());
    expect(raise.content.expiry).toEqual(grant.content.expiry); // inherited default
    const tighter = authorizeAutonomyRaise({
      ...mintOptions(),
      expiry: { kind: 'TIME', at: '2025-01-03T00:00:00.000Z' },
    });
    expect(tighter.content.expiry).toEqual({ kind: 'TIME', at: '2025-01-03T00:00:00.000Z' });
  });

  it('the raise id changes when any content field changes (content addressing)', () => {
    const base = authorizeAutonomyRaise(mintOptions());
    const variant = authorizeAutonomyRaise({ ...mintOptions(), rationale: 'Different rationale entirely.' });
    expect(variant.envelope.id).not.toBe(base.envelope.id);
  });
});

describe('raise applicability', () => {
  it('applies when action kind, blast radius and backing grant all match', () => {
    const grant = validGrant();
    const raise = sampleRaise(grant);
    expect(
      raiseApplies(raise, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', grants: [grant] }, { kind: 'TIME', now: T1 }),
    ).toBe(true);
  });

  it('does not apply for a different action kind or blast radius', () => {
    const grant = validGrant();
    const raise = sampleRaise(grant);
    expect(
      raiseApplies(raise, { action_kind: 'PROMOTE', blast_radius: 'ORGANIZATION', grants: [grant] }, { kind: 'TIME', now: T1 }),
    ).toBe(false);
    expect(
      raiseApplies(raise, { action_kind: 'REVISE', blast_radius: 'SERVICE', grants: [grant] }, { kind: 'TIME', now: T1 }),
    ).toBe(false);
  });

  it('does not apply when the backing grant is absent or dead', () => {
    const backing = validGrant({ grantee: 'raise-backer' });
    const raise = sampleRaise(backing);
    expect(
      raiseApplies(raise, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', grants: [validGrant()] }, { kind: 'TIME', now: T1 }),
    ).toBe(false);
    expect(
      raiseApplies(raise, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', grants: [expiredGrant()] }, { kind: 'TIME', now: T1 }),
    ).toBe(false);
    expect(
      raiseApplies(raise, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', grants: [] }, { kind: 'TIME', now: T1 }),
    ).toBe(false);
  });
});

describe('raise structural validation', () => {
  it('rejects malformed raise artifacts (shape, kind, vocabulary, anchoring)', () => {
    const raise = sampleRaise(validGrant());
    expect(validateAutonomyRaise({})).toBe(false);
    expect(validateAutonomyRaise({ envelope: raise.envelope })).toBe(false);
    expect(
      validateAutonomyRaise({
        envelope: { ...raise.envelope, kind: 'Mission' },
        content: raise.content,
      }),
    ).toBe(false);
    expect(
      validateAutonomyRaise({
        envelope: raise.envelope,
        content: { ...raise.content, to_level: 'SUPERVISED' as never },
      }),
    ).toBe(false);
    expect(
      validateAutonomyRaise({
        envelope: raise.envelope,
        content: { ...raise.content, rationale: '' },
      }),
    ).toBe(false);
    expect(() => assertValidAutonomyRaise(null)).toThrow();
  });

  it('rejects a forged from_level that is not the anchored policy default', () => {
    const raise = sampleRaise(validGrant());
    const forged: AutonomyRaiseArtifact = {
      envelope: raise.envelope,
      content: { ...raise.content, from_level: 'BOUNDED', to_level: 'AUTONOMOUS_LOW_RISK' },
    };
    expect(validateAutonomyRaise(forged)).toBe(false);
  });
});

describe('enforcement consumes raises end-to-end', () => {
  it('a governed raise changes the enforcement outcome for the covered scope', () => {
    const grant = validGrant();
    const raise = sampleRaise(grant, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', to_level: 'BOUNDED' });
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({
        action_kind: 'REVISE',
        blast_radius: 'ORGANIZATION',
        grants: [grant],
        raises: [raise],
      }),
    );
    expect(verdict.verdict).toBe('PERMITTED');
    expect(verdict.required_level).toBe('SUPERVISED');
    expect(verdict.effective_level).toBe('BOUNDED');
    expect(verdict.applied_raise_refs).toEqual([raise.envelope.id]);
  });

  it('the same raise does NOT leak into other (action, blast) cells', () => {
    const grant = validGrant();
    const raise = sampleRaise(grant, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', to_level: 'BOUNDED' });
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({
        action_kind: 'REVISE',
        blast_radius: 'SYSTEM',
        grants: [grant],
        raises: [raise],
      }),
    );
    // REVISE @ SYSTEM defaults to BOUNDED; the raise is not applicable here.
    expect(verdict.verdict).toBe('PERMITTED');
    expect(verdict.applied_raise_refs).toEqual([]);
    expect(verdict.effective_level).toBe('BOUNDED');
  });
});
