/**
 * PINNED: preview cannot mutate production — the isolation contract
 * plus the full deployment-hardening contract set (sandbox limits,
 * network policy, backup/restore, rollback wiring), including:
 *   - the tier vocabulary equality with the merged P3 environment
 *     schema (imported directly);
 *   - the rollback wiring composed through the REAL merged P9
 *     validateRequest (imported through the test-time alias);
 *   - the audit-event discipline aligned with the merged P2
 *     ObservationEventInput contract (source-pinned: the field set and
 *     the RFC3339 pattern are extracted from the merged live-store
 *     source and asserted equal).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRequest, ACTION_FAMILIES } from '@sos-2/action-gateway';
import { AUDIT_EVENT_INPUT_FIELDS, RFC3339_PATTERN } from '@sos-2/security';
import {
  assertPreviewCannotMutateProduction,
  assertFootprintsShareNoIdentity,
  assertTierIsolationOrThrow,
} from '../../infra/production-hardening/src/tier-isolation.ts';
import { HARDENING_TIERS, HardeningContractError, tierIdentity } from '../../infra/production-hardening/src/tiers.ts';
import {
  assertValidSandboxLimitDeclaration,
  assertValidSandboxLimitSet,
  DEFAULT_SANDBOX_LIMITS,
} from '../../infra/production-hardening/src/sandbox-limits.ts';
import {
  assertValidNetworkPolicyDeclaration,
  assertValidNetworkPolicySet,
  egressAllowed,
  DEFAULT_NETWORK_POLICIES,
} from '../../infra/production-hardening/src/network-policy.ts';
import {
  assertValidBackupScheduleSet,
  assertValidRestorationRecord,
  referenceRestorationRecord,
  DEFAULT_BACKUP_SCHEDULES,
} from '../../infra/production-hardening/src/backup-restore.ts';
import {
  assertValidRollbackWiring,
  wiringToRollbackPayload,
} from '../../infra/production-hardening/src/rollback-wiring.ts';
import { ENVIRONMENT_TIERS } from '../../infra/deployment/src/core/types.ts';

const PRODUCTION_DB = tierIdentity('neon', 'database', 'sos', 'production');
const PREVIEW_DB = tierIdentity('neon', 'database', 'sos_preview', 'preview');

describe('acceptance: preview cannot mutate production (pinned isolation)', () => {
  it('PINNED: a preview-context mutation targeting a production identity is a typed violation (fail-closed)', () => {
    for (const operation of ['write', 'delete', 'deploy', 'rollback', 'migrate', 'configure'] as const) {
      const decision = assertPreviewCannotMutateProduction({ contextTier: 'preview', target: PRODUCTION_DB, operation });
      expect(decision.kind, operation).toBe('PREVIEW_ISOLATION_VIOLATION');
    }
  });

  it('the throwing seam rejects with the typed HardeningContractError', () => {
    expect(() => assertTierIsolationOrThrow({ contextTier: 'preview', target: PRODUCTION_DB, operation: 'deploy' })).toThrow(
      HardeningContractError,
    );
  });

  it('preview mutations against PREVIEW identities pass; production contexts are not this gate\'s subject', () => {
    expect(assertPreviewCannotMutateProduction({ contextTier: 'preview', target: PREVIEW_DB, operation: 'deploy' }).kind).toBe(
      'REQUEST_ALLOWED',
    );
    expect(
      assertPreviewCannotMutateProduction({ contextTier: 'production', target: PRODUCTION_DB, operation: 'deploy' }).kind,
    ).toBe('REQUEST_ALLOWED');
  });

  it('tier footprints share NO resource identity (the P3 footprint rule restated and enforced)', () => {
    expect(() => assertFootprintsShareNoIdentity([PREVIEW_DB], [PRODUCTION_DB])).not.toThrow();
    expect(() => assertFootprintsShareNoIdentity([PRODUCTION_DB], [PRODUCTION_DB])).toThrow(HardeningContractError);
  });

  it('the tier vocabulary is EXACTLY the merged P3 environment tier vocabulary', () => {
    expect([...HARDENING_TIERS]).toEqual([...ENVIRONMENT_TIERS]);
    expect(tierIdentity('neon', 'database', 'sos', 'production').identity).not.toBe(
      tierIdentity('neon', 'database', 'sos_preview', 'preview').identity,
    );
  });
});

describe('acceptance: deployment hardening contracts (sandbox limits, network policy, backups)', () => {
  it('the repo-standard sandbox limit set validates offline; production budgets are fully bounded', () => {
    assertValidSandboxLimitSet(DEFAULT_SANDBOX_LIMITS);
    const production = DEFAULT_SANDBOX_LIMITS.find((limits) => limits.tier === 'production');
    expect(production).toBeDefined();
    if (production === undefined) return;
    for (const counter of Object.keys(production.budgets) as Array<keyof typeof production.budgets>) {
      expect(production.budgets[counter], `production ${counter}`).not.toBeNull();
    }
  });

  it('unbounded production budgets are unrepresentable (typed rejection)', () => {
    expect(() =>
      assertValidSandboxLimitDeclaration({
        tier: 'production',
        budgets: { fileWrites: null, fileBytes: null, shellCommands: null, networkCalls: null, secretReveals: null },
        resourceEnvelope: { maxDurationMs: 900_000, maxMemoryMb: 1_024 },
      }),
    ).toThrow(HardeningContractError);
  });

  it('the repo-standard network policies validate; production egress is allowlist-only', () => {
    assertValidNetworkPolicySet(DEFAULT_NETWORK_POLICIES);
    const production = DEFAULT_NETWORK_POLICIES.find((policy) => policy.tier === 'production');
    expect(production?.egress).toBe('allowlist');
    expect(production && egressAllowed(production, 'github.com')).toBe(true);
    expect(production && egressAllowed(production, 'evil.example.com')).toBe(false);
  });

  it('open production egress is unrepresentable (typed rejection)', () => {
    expect(() =>
      assertValidNetworkPolicyDeclaration({ tier: 'production', egress: 'open', allowedHosts: null, rationale: 'x' }),
    ).toThrow(HardeningContractError);
  });

  it('backup schedules cover both durable stores with drills; unverified restores are unrepresentable', () => {
    assertValidBackupScheduleSet(DEFAULT_BACKUP_SCHEDULES);
    expect(() =>
      assertValidRestorationRecord({ subject: 'neon-database', steps: ['declare-incident'], verifiedAfterRestore: true, recordedAt: '2026-01-05T09:00:00Z' }),
    ).toThrow(HardeningContractError);
    expect(() =>
      assertValidRestorationRecord({ ...referenceRestorationRecord('neon-database', '2026-01-05T09:00:00Z'), verifiedAfterRestore: false }),
    ).toThrow(HardeningContractError);
    assertValidRestorationRecord(referenceRestorationRecord('r2-artifacts', '2026-01-05T09:00:00Z'));
  });
});

describe('acceptance: rollback wiring composes with the REAL merged P9 action surface', () => {
  const wiring = {
    environment: 'production' as const,
    deploymentId: 'dpl-1',
    fromSourceSha: 'c924e617650a243df9df7580e60d0e021fac1059',
    toSourceSha: 'aa19c0ffee000000000000000000000000000001',
    reason: { code: 'FAILED_VERIFICATION' as const, detail: 'post-deploy verification failed' },
    actor: { kind: 'system' as const, id: 'orchestrator' },
  };

  it('PINNED: a wiring-built rollback payload validates through the REAL P9 validateRequest', () => {
    const payload = wiringToRollbackPayload(wiring);
    const request = {
      actionId: 'act-rollback-1',
      idempotencyKey: 'idem-rollback-1',
      family: 'rollback',
      actor: wiring.actor,
      requestedAt: 1_000_000,
      targetRevision: { kind: 'source', sha: wiring.fromSourceSha },
      payload,
    };
    const outcome = validateRequest(request);
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.request.payload.family === 'rollback') {
      expect(outcome.request.family).toBe('rollback');
      expect(outcome.request.payload.rollback.reason.code).toBe('FAILED_VERIFICATION');
    }
  });

  it('a no-op or bad-sha wiring is rejected before ever reaching the gateway', () => {
    expect(() => assertValidRollbackWiring({ ...wiring, toSourceSha: wiring.fromSourceSha })).toThrow(HardeningContractError);
    expect(() => assertValidRollbackWiring({ ...wiring, toSourceSha: 'short' })).toThrow(HardeningContractError);
  });

  it('the P9 vocabulary includes the rollback family (the wiring targets a real surface)', () => {
    expect(ACTION_FAMILIES.includes('rollback')).toBe(true);
  });
});

describe('acceptance: the audit-event discipline is the merged P2 observation-event contract (source-pinned)', () => {
  const liveStoreSource = readFileSync(
    fileURLToPath(new URL('../../packages/live-store/src/records/observation-event.ts', import.meta.url)),
    'utf8',
  );

  it('PINNED: the P14 audit event field set IS the merged P2 ObservationEventInput field set', () => {
    const match = liveStoreSource.match(/const expected = \[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const p2FieldSet = (match?.[1] ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/^'|'$/g, ''))
      .filter((entry) => entry.length > 0);
    expect(p2FieldSet).toEqual(['id', 'source', 'kind', 'occurred_at', 'payload', 'provenance']);
    expect([...AUDIT_EVENT_INPUT_FIELDS]).toEqual(p2FieldSet);
  });

  it('PINNED: the P14 RFC3339 pattern IS the merged P2 RFC3339 pattern', () => {
    const match = liveStoreSource.match(/RFC3339_PATTERN = \/(.+)\/;/);
    expect(match).not.toBeNull();
    expect(RFC3339_PATTERN.source).toBe(match?.[1]);
  });
});
