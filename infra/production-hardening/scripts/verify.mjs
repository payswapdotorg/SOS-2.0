/**
 * Offline deployment-hardening contract verification (Work Order P14).
 *
 * The thin caller mirroring the P3 pattern: verifies every hardening
 * contract OFFLINE (no credentials, no network, no clocks — pure
 * declaration validation) by running the contract validators over the
 * repo-standard declarations plus a fail-closed probe set (malformed
 * declarations MUST be typed-rejected).
 *
 * Node 22.18+/24 native TypeScript type stripping imports the contract
 * modules directly (the infra/deployment script precedent). The CI
 * story is architect-assembled; this script is the repo-standard
 * offline entry:
 *
 *   node infra/production-hardening/scripts/verify.mjs
 *
 * Exit 0 on PASS; exit 1 with the typed failure otherwise.
 */

import {
  assertValidSandboxLimitDeclaration,
  assertValidSandboxLimitSet,
  DEFAULT_SANDBOX_LIMITS,
  SANDBOX_LIMIT_COUNTERS,
} from '../src/sandbox-limits.ts';
import {
  assertValidNetworkPolicyDeclaration,
  assertValidNetworkPolicySet,
  egressAllowed,
  DEFAULT_NETWORK_POLICIES,
} from '../src/network-policy.ts';
import {
  assertValidBackupSchedule,
  assertValidBackupScheduleSet,
  assertValidRestorationRecord,
  referenceRestorationRecord,
  RESTORE_PROCEDURE_STEPS,
  DEFAULT_BACKUP_SCHEDULES,
} from '../src/backup-restore.ts';
import {
  assertPreviewCannotMutateProduction,
  assertFootprintsShareNoIdentity,
  assertTierIsolationOrThrow,
} from '../src/tier-isolation.ts';
import { tierIdentity } from '../src/tiers.ts';
import {
  assertValidRollbackWiring,
  wiringToRollbackPayload,
  ROLLBACK_REASON_CODES,
} from '../src/rollback-wiring.ts';

let checks = 0;
function ok(label) {
  checks += 1;
  console.log(`  ok  ${label}`);
}

function expectRejection(label, fn) {
  try {
    fn();
  } catch {
    checks += 1;
    console.log(`  ok  ${label} (typed rejection, as required)`);
    return;
  }
  console.error(`FAIL  ${label} — expected a typed rejection`);
  process.exit(1);
}

console.log('deployment-hardening contract verification (offline, no credentials)');

// 1. Sandbox/resource limit declarations.
assertValidSandboxLimitSet(DEFAULT_SANDBOX_LIMITS);
ok(`sandbox limit declarations valid for all three tiers (counters: ${SANDBOX_LIMIT_COUNTERS.length})`);
expectRejection('unbounded production budget is unrepresentable', () =>
  assertValidSandboxLimitDeclaration({
    tier: 'production',
    budgets: { fileWrites: null, fileBytes: null, shellCommands: null, networkCalls: null, secretReveals: null },
    resourceEnvelope: { maxDurationMs: 900_000, maxMemoryMb: 1_024 },
  }),
);
expectRejection('unbounded production memory is unrepresentable', () =>
  assertValidSandboxLimitDeclaration({
    tier: 'production',
    budgets: { fileWrites: 1, fileBytes: 1, shellCommands: 1, networkCalls: 1, secretReveals: 1 },
    resourceEnvelope: { maxDurationMs: 900_000, maxMemoryMb: null },
  }),
);

// 2. Network policy declarations.
assertValidNetworkPolicySet(DEFAULT_NETWORK_POLICIES);
ok('network policy declarations valid for all three tiers');
const productionNetwork = DEFAULT_NETWORK_POLICIES.find((policy) => policy.tier === 'production');
if (!productionNetwork || !egressAllowed(productionNetwork, 'github.com')) {
  console.error('FAIL  production network policy must allowlist github.com');
  process.exit(1);
}
ok('production egress allowlist admits the repository host');
expectRejection('open production egress is unrepresentable', () =>
  assertValidNetworkPolicyDeclaration({ tier: 'production', egress: 'open', allowedHosts: null, rationale: 'x' }),
);
expectRejection('empty allowlist is not a policy (use none)', () =>
  assertValidNetworkPolicyDeclaration({ tier: 'preview', egress: 'allowlist', allowedHosts: [], rationale: 'x' }),
);

// 3. Backup/restore declarations.
assertValidBackupScheduleSet(DEFAULT_BACKUP_SCHEDULES);
ok('backup schedules valid for both durable stores (drills declared)');
expectRejection('redis is never a backup subject (never canonical)', () =>
  assertValidBackupSchedule({ subject: 'upstash-cache', frequencyHours: 1, retentionDays: 1, drillEveryHours: 1, rationale: 'x' }),
);
expectRejection('a schedule without drills is a liability', () =>
  assertValidBackupSchedule({ subject: 'neon-database', frequencyHours: 24, retentionDays: 14, drillEveryHours: 0, rationale: 'x' }),
);
assertValidRestorationRecord(referenceRestorationRecord('neon-database', '2026-01-05T09:00:00Z'));
ok(`restoration record valid (procedure: ${RESTORE_PROCEDURE_STEPS.length} steps, verified)`);
expectRejection('an unverified restore is a claim, not a recovery', () =>
  assertValidRestorationRecord({ subject: 'neon-database', steps: [...RESTORE_PROCEDURE_STEPS], verifiedAfterRestore: false, recordedAt: '2026-01-05T09:00:00Z' }),
);

// 4. Preview/production isolation (PINNED).
const productionIdentity = tierIdentity('neon', 'database', 'sos', 'production');
const previewIdentity = tierIdentity('neon', 'database', 'sos_preview', 'preview');
const denied = assertPreviewCannotMutateProduction({
  contextTier: 'preview',
  target: productionIdentity,
  operation: 'deploy',
});
if (denied.kind !== 'PREVIEW_ISOLATION_VIOLATION') {
  console.error('FAIL  preview deploy against a production identity must be a typed violation');
  process.exit(1);
}
ok('preview cannot mutate production (typed violation, fail-closed)');
const allowed = assertPreviewCannotMutateProduction({ contextTier: 'preview', target: previewIdentity, operation: 'deploy' });
if (allowed.kind !== 'REQUEST_ALLOWED') {
  console.error('FAIL  preview deploy against a preview identity must pass the gate');
  process.exit(1);
}
ok('preview deploy against a preview identity passes the gate');
assertFootprintsShareNoIdentity([previewIdentity], [productionIdentity]);
ok('tier footprints share no resource identity');
expectRejection('shared identities between tiers are rejected', () =>
  assertFootprintsShareNoIdentity([productionIdentity], [productionIdentity]),
);

// 5. Rollback wiring (through the P9 rollback action family vocabulary).
const wiring = {
  environment: 'production',
  deploymentId: 'dpl-1',
  fromSourceSha: 'c924e617650a243df9df7580e60d0e021fac1059',
  toSourceSha: 'aa19c0ffee000000000000000000000000000001',
  reason: { code: 'FAILED_VERIFICATION', detail: 'post-deploy verification failed' },
  actor: { kind: 'system', id: 'orchestrator' },
};
assertValidRollbackWiring(wiring);
const payload = wiringToRollbackPayload(wiring);
if (payload.family !== 'rollback' || payload.rollback.reason.code !== 'FAILED_VERIFICATION') {
  console.error('FAIL  rollback wiring must produce the P9-shaped rollback payload');
  process.exit(1);
}
ok(`rollback wiring produces the P9-shaped payload (reason codes: ${ROLLBACK_REASON_CODES.join(' | ')})`);
expectRejection('a no-op rollback is malformed', () =>
  assertValidRollbackWiring({ ...wiring, toSourceSha: wiring.fromSourceSha }),
);
expectRejection('non-40-hex source shas are rejected (exact-head rule)', () =>
  assertValidRollbackWiring({ ...wiring, toSourceSha: 'not-a-sha' }),
);

console.log(`deployment-hardening contract verification: PASS (${checks} checks)`);
