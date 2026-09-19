/**
 * Shared (non-test) fixtures for @sos-2/authority tests.
 * Lives outside the vitest test glob (only *.test.ts files are collected),
 * so importing it never re-registers another file's tests.
 */

import type { AskContent, CreateGrantInput } from '../src/index.js';

export type { AskContent, CreateGrantInput };

export const PROVENANCE = ['W1:test'];
export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-03-01T00:00:00.000Z';
export const T2 = '2025-06-01T00:00:00.000Z';
export const AFTER = '2025-12-01T00:00:00.000Z';

export const MISSION_ID = `sos://Mission/${'a'.repeat(32)}`;
export const OTHER_MISSION_ID = `sos://Mission/${'b'.repeat(32)}`;

export function baseGrantInput(overrides: Partial<CreateGrantInput> = {}): CreateGrantInput {
  return {
    grantee: 'platform-architect',
    scope: { kind: 'ARTIFACT', artifact_id: MISSION_ID },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: T2 },
    provenance: PROVENANCE,
    created_at: T0,
    authority_ref: `sos://Constitution/${'c'.repeat(32)}`,
    ...overrides,
  };
}

export function sampleAskContent(): AskContent {
  return {
    decision: 'Promote candidate C-42 (new rate limiter) to production for tenant cohort "beta"?',
    alternatives: [
      {
        id: 'promote-now',
        action: 'ACT',
        description: 'Promote C-42 to 100% of the beta cohort now.',
      },
      {
        id: 'canary-first',
        action: 'EXPERIMENT',
        description: 'Promote to 5% canary for 48h with automatic rollback on guardrail breach.',
      },
      {
        id: 'hold',
        action: 'REJECT',
        description: 'Do not promote; keep the current implementation.',
      },
    ],
    evidence_quality: {
      quality: 'MODERATE',
      summary: 'Two passing canaries and a replay; no long-horizon evidence and no disaster-recovery drill.',
    },
    uncertainty: {
      uncertainty_class: 'HIGH',
      basis: 'Traffic shape for the beta cohort differs from the test population; effect on p99 is unmeasured.',
    },
    trade_offs: [
      'Promoting now captures the latency win immediately but risks a regression at full scale.',
      'Canary-first delays the win by two days but bounds the blast radius.',
    ],
    risk: {
      description: 'A mis-sized limiter could throttle paying tenants during the morning peak.',
      severity: 'HIGH',
    },
    authority_insufficiency:
      'Current grants authorize REVISE on the Mission but no grant carries PROMOTE for production rollout; promotion is outside the autonomous envelope (R15).',
  };
}
