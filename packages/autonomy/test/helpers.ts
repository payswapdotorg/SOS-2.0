/**
 * Shared test fixtures for @sos-2/autonomy tests.
 *
 * Grants are minted through @sos-2/authority's createGrant/revokeGrant
 * (never hand-invented shapes); raises are minted through this package's
 * authorizeAutonomyRaise.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGrant, revokeGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact, AuthorizationTarget, GrantScope } from '@sos-2/authority';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { authorizeAutonomyRaise } from '../src/index.js';
import type { AutonomyRaiseArtifact } from '../src/index.js';
import type { AutonomyEnforcementRequest } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Constitution anchor id from the W0.5 golden fixture artifact-envelope.json. */
export const CONSTITUTION_ANCHOR_ID: string = (
  JSON.parse(readFileSync(join(here, '../../semantic-spine/fixtures/artifact-envelope.json'), 'utf8')) as {
    authority_ref: string;
  }
).authority_ref;

export const PROVENANCE = ['W10:autonomy-test'];
export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z'; // the evaluation instant
export const T2 = '2025-01-05T00:00:00.000Z'; // grant validity window end (after T1)
export const T_PAST = '2024-12-01T00:00:00.000Z'; // already-expired grants
export const T_MIDDLE = '2025-01-03T00:00:00.000Z'; // raise-backing grant expiry (valid at T1, dead at T3)
export const T3 = '2025-01-04T00:00:00.000Z'; // after T_MIDDLE (backing dead, default grant still valid)

/** A well-formed spine id used as the explicit authority decision reference. */
export const EXPLICIT_DECISION_REF = deriveDeterministicArtifactId('Decision', {
  note: 'w10 autonomy test explicit decision',
  resolved_by: 'human:principal-engineer',
});

export interface GrantOptions {
  scope?: GrantScope;
  permissions?: string[];
  expiry?: { kind: 'TIME'; at: string } | { kind: 'REVISION'; artifact_id: string; max_version: number };
  grantee?: string;
}

/** A VALID grant covering the default target with the default permissions. */
export function validGrant(options: GrantOptions = {}): AuthorityGrantArtifact {
  return createGrant({
    grantee: options.grantee ?? 'w10-autonomy-test-actor',
    scope: options.scope ?? { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: options.permissions ?? ['READ', 'REVISE', 'PROMOTE'],
    expiry: options.expiry ?? { kind: 'TIME', at: T2 },
    provenance: PROVENANCE,
    created_at: T0,
    status: 'ACTIVE',
  });
}

/** An EXPIRED (time-bound, in the past) grant. */
export function expiredGrant(options: GrantOptions = {}): AuthorityGrantArtifact {
  return validGrant({ ...options, expiry: { kind: 'TIME', at: T_PAST } });
}

/** A grant valid at T1 that EXPIRES at T_MIDDLE (dead by T3) — for raise-backing tests. */
export function midLifeGrant(options: GrantOptions = {}): AuthorityGrantArtifact {
  return validGrant({ ...options, expiry: { kind: 'TIME', at: T_MIDDLE } });
}

/** A REVOKED grant (explicit revocation through @sos-2/authority). */
export function revokedGrant(options: GrantOptions = {}): AuthorityGrantArtifact {
  const head = validGrant(options);
  return revokeGrant(head, {
    at: { kind: 'TIME', now: T1 },
    provenance: ['W10:autonomy-test:revocation'],
    created_at: T1,
  });
}

export const DEFAULT_TARGET: AuthorizationTarget = { kind: 'KIND', artifact_kind: 'Mission' };

export interface EnforcementOptions {
  action_kind?: AutonomyEnforcementRequest['action_kind'];
  target?: AuthorizationTarget;
  blast_radius?: AutonomyEnforcementRequest['blast_radius'];
  risk?: AutonomyEnforcementRequest['risk'];
  reversibility?: AutonomyEnforcementRequest['reversibility'];
  grants?: AuthorityGrantArtifact[];
  raises?: AutonomyRaiseArtifact[];
  explicit_authority_decision_ref?: string | null;
  now?: string;
}

/** A default enforcement request: REVISE @ SERVICE, risk LOW, REVERSIBLE, valid grant. */
export function enforcementRequest(options: EnforcementOptions = {}): AutonomyEnforcementRequest {
  return {
    action_kind: options.action_kind ?? 'REVISE',
    target: options.target ?? DEFAULT_TARGET,
    blast_radius: options.blast_radius ?? 'SERVICE',
    risk: options.risk ?? 'LOW',
    reversibility: options.reversibility ?? 'REVERSIBLE',
    grants: options.grants ?? [validGrant()],
    raises: options.raises,
    evaluation_point: { kind: 'TIME', now: options.now ?? T1 },
    explicit_authority_decision_ref: options.explicit_authority_decision_ref ?? null,
  };
}

/** A governed raise minted through authorizeAutonomyRaise with a valid backing grant. */
export function sampleRaise(
  grant: AuthorityGrantArtifact,
  options: {
    action_kind?: AutonomyEnforcementRequest['action_kind'];
    blast_radius?: AutonomyEnforcementRequest['blast_radius'];
    to_level?: 'BOUNDED' | 'AUTONOMOUS_LOW_RISK';
  } = {},
): AutonomyRaiseArtifact {
  return authorizeAutonomyRaise({
    action_kind: options.action_kind ?? 'REVISE',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    blast_radius: options.blast_radius ?? 'ORGANIZATION',
    to_level: options.to_level ?? 'BOUNDED',
    rationale: 'Organization-wide revision authority demonstrated by six incident-free months under the same team.',
    grant,
    at: { kind: 'TIME', now: T1 },
    provenance: PROVENANCE,
    created_at: T1,
    status: 'ACTIVE',
  });
}
