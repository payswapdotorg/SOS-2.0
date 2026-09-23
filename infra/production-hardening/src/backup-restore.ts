/**
 * Backup/restore declarations (Work Order P14).
 *
 * Declarative backup/restore schedules for the durable stores (the P3
 * provider roles: Neon is the durable semantic store, R2 the immutable
 * artifact store — Redis is NEVER canonical and therefore NEVER a
 * backup subject) plus the typed restore procedure contract.
 *
 * PINNED RULES:
 *   - every DURABLE store declares a backup schedule (frequency +
 *     retention, both bounded positive);
 *   - the restore procedure VERIFIES after restore (a restore without
 *     verification is unrepresentable — an unverified restore is a
 *     claim, not a recovery);
 *   - restore drills are DECLARED as part of the schedule (how often
 *     the restore path is exercised); a schedule without drills is a
 *     typed violation (an untested restore path is a liability);
 *   - Redis is rejected as a backup subject (never canonical — §13).
 *
 * Contracts, not executions: real provider backup endpoints attach
 * later as adapters. Status: NOT_YET_CONNECTED; the schedules are
 * verified OFFLINE.
 *
 * Determinism: pure functions over injected declarations.
 */

import { HardeningContractError, isNonEmptyString, isPlainObject, isPositiveInteger } from './tiers.ts';

/** The backup subjects (durable stores only — Redis is never canonical). */
export const BACKUP_SUBJECTS = ['neon-database', 'r2-artifacts'] as const;
export type BackupSubject = (typeof BACKUP_SUBJECTS)[number];

/** One store's backup schedule declaration. */
export interface BackupScheduleDeclaration {
  readonly subject: BackupSubject;
  /** Hours between backups (positive integer). */
  readonly frequencyHours: number;
  /** Days of retention (positive integer). */
  readonly retentionDays: number;
  /** Hours between restore drills (positive integer — an untested restore path is a liability). */
  readonly drillEveryHours: number;
  readonly rationale: string;
}

/** The typed restore procedure contract (the steps a restore MUST take). */
export const RESTORE_PROCEDURE_STEPS = [
  'declare-incident',
  'freeze-writes',
  'select-recovery-point',
  'restore-snapshot',
  'verify-restored-state',
  'resume-writes',
  'record-restoration',
] as const;
export type RestoreProcedureStep = (typeof RESTORE_PROCEDURE_STEPS)[number];

/** One executed (or planned) restore — the typed record. */
export interface RestorationRecord {
  readonly subject: BackupSubject;
  readonly steps: readonly RestoreProcedureStep[];
  readonly verifiedAfterRestore: boolean;
  readonly recordedAt: string; // RFC3339, caller-supplied (injected clock upstream)
}

/** The repo-standard schedules. */
export const DEFAULT_BACKUP_SCHEDULES: readonly BackupScheduleDeclaration[] = [
  {
    subject: 'neon-database',
    frequencyHours: 24,
    retentionDays: 14,
    drillEveryHours: 24 * 7,
    rationale: 'the durable semantic store: daily backups, two weeks retention, weekly restore drills',
  },
  {
    subject: 'r2-artifacts',
    frequencyHours: 24,
    retentionDays: 30,
    drillEveryHours: 24 * 14,
    rationale: 'immutable artifact store: object-lock retention with periodic restore drills',
  },
] as const;

/** Validate one backup schedule declaration (fail-closed). */
export function assertValidBackupSchedule(declaration: BackupScheduleDeclaration): void {
  if (!isPlainObject(declaration)) {
    throw new HardeningContractError('backup schedule declaration must be an object');
  }
  if (!(BACKUP_SUBJECTS as readonly string[]).includes(declaration.subject)) {
    throw new HardeningContractError(
      `backup subject must be one of ${BACKUP_SUBJECTS.join(', ')} (Redis is never canonical and never a backup subject), received: ${JSON.stringify(declaration.subject)}`,
    );
  }
  if (!isPositiveInteger(declaration.frequencyHours)) {
    throw new HardeningContractError(`backup frequencyHours must be a positive integer, received: ${JSON.stringify(declaration.frequencyHours)}`);
  }
  if (!isPositiveInteger(declaration.retentionDays)) {
    throw new HardeningContractError(`backup retentionDays must be a positive integer, received: ${JSON.stringify(declaration.retentionDays)}`);
  }
  if (!isPositiveInteger(declaration.drillEveryHours)) {
    throw new HardeningContractError(
      `backup drillEveryHours must be a positive integer (an untested restore path is a liability), received: ${JSON.stringify(declaration.drillEveryHours)}`,
    );
  }
  if (!isNonEmptyString(declaration.rationale)) {
    throw new HardeningContractError('backup schedule declaration requires a non-empty rationale');
  }
}

/** Validate a complete schedule set (every durable store covered). */
export function assertValidBackupScheduleSet(declarations: readonly BackupScheduleDeclaration[]): void {
  const subjects = new Set(declarations.map((declaration) => declaration.subject));
  if (subjects.size !== declarations.length) {
    throw new HardeningContractError('duplicate backup schedules for the same subject');
  }
  for (const expected of BACKUP_SUBJECTS) {
    if (!subjects.has(expected)) {
      throw new HardeningContractError(`missing backup schedule for subject "${expected}"`);
    }
  }
  for (const declaration of declarations) {
    assertValidBackupSchedule(declaration);
  }
}

/**
 * Validate a restoration record:
 *   - the steps must be exactly the restore procedure (in order);
 *   - verifiedAfterRestore must be TRUE — an unverified restore is a
 *     claim, not a recovery (unrepresentable as a valid record).
 */
export function assertValidRestorationRecord(record: RestorationRecord): void {
  if (!isPlainObject(record)) {
    throw new HardeningContractError('restoration record must be an object');
  }
  if (!(BACKUP_SUBJECTS as readonly string[]).includes(record.subject)) {
    throw new HardeningContractError(`restoration subject must be one of ${BACKUP_SUBJECTS.join(', ')}, received: ${JSON.stringify(record.subject)}`);
  }
  const steps = [...record.steps];
  if (steps.length !== RESTORE_PROCEDURE_STEPS.length || !RESTORE_PROCEDURE_STEPS.every((step, index) => steps[index] === step)) {
    throw new HardeningContractError(
      `restoration steps must be exactly the ordered procedure [${RESTORE_PROCEDURE_STEPS.join(' -> ')}], received: ${JSON.stringify(steps)}`,
    );
  }
  if (record.verifiedAfterRestore !== true) {
    throw new HardeningContractError('an unverified restore is a claim, not a recovery — verifiedAfterRestore must be true');
  }
  if (typeof record.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(record.recordedAt)) {
    throw new HardeningContractError('restoration recordedAt must be an RFC3339 timestamp');
  }
}

/** A well-formed reference restoration record (the documented shape). */
export function referenceRestorationRecord(subject: BackupSubject, recordedAt: string): RestorationRecord {
  return {
    subject,
    steps: [...RESTORE_PROCEDURE_STEPS],
    verifiedAfterRestore: true,
    recordedAt,
  };
}
