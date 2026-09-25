/**
 * PINNED: the complete runbook exists (structural) — docs/operations
 * contains the required sections; demo fixtures are never referenced
 * as production state.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const opsDir = fileURLToPath(new URL('../../docs/operations/', import.meta.url));

function read(page: string): string {
  const path = `${opsDir}${page}`;
  expect(existsSync(path), `docs/operations/${page} must exist`).toBe(true);
  return readFileSync(path, 'utf8');
}

describe('acceptance: complete runbook exists (docs/operations)', () => {
  it('the orientation README exists with the required structure', () => {
    const readme = read('README.md');
    for (const required of [
      'diagnosis',
      'outage',
      'backup',
      'rollback',
      'abuse',
      'budget',
      'NOT_YET_CONNECTED',
      'reference-implementation',
      'Demo fixtures are never production state',
    ]) {
      expect(readme).toContain(required);
    }
  });

  it('PINNED: the diagnosis procedures map symptom -> responsible task/body/provider', () => {
    const diagnosis = read('diagnosis.md');
    for (const required of ['taskId', 'bodyId', 'providerId', 'INSUFFICIENT_EVIDENCE', 'audit trail', 'Denied actions', 'Secret redactions', 'Rate limiting']) {
      expect(diagnosis).toContain(required);
    }
  });

  it('PINNED: the outage playbooks cover provider/network/task/user failure with honest UNKNOWN', () => {
    const playbooks = read('outage-playbooks.md');
    for (const required of ['Provider failure', 'Network failure', 'Task failure', 'User failure', 'UNKNOWN', 'UNAVAILABLE', 'bounded', 'ASK']) {
      expect(playbooks).toContain(required);
    }
  });

  it('PINNED: the backup/restore procedures exist with verification and drills', () => {
    const backup = read('backup-restore.md');
    for (const required of ['neon-database', 'r2-artifacts', 'restore drill', 'verify-restored-state', 'An unverified restore is a claim, not a recovery', 'freeze-writes']) {
      expect(backup).toContain(required);
    }
  });

  it('PINNED: the rollback procedures go through the P9 rollback action family', () => {
    const rollback = read('rollback.md');
    for (const required of ['P9 rollback action family', 'FAILED_VERIFICATION', 'INCIDENT', 'MANUAL_DIRECTIVE', 'authority', 'evidence']) {
      expect(rollback).toContain(required);
    }
  });

  it('PINNED: the abuse-response procedures suspend pending ASK (never silent termination)', () => {
    const abuse = read('abuse-response.md');
    for (const required of ['suspended pending ASK', 'suspension is observed evidence', 'TaskSuspensionRecord', 'human decision', 'resume / restrict / terminate']) {
      expect(abuse).toContain(required);
    }
  });

  it('PINNED: the budget-exhaustion procedures cover typed denial, checkpoint and ASK', () => {
    const budget = read('budget-exhaustion.md');
    for (const required of ['BUDGET_EXCEEDED', 'checkpoint', 'ACCOUNTING_UNKNOWN', 'ASK', 'concurrentTasks', 'costUnits', 'elapsedMs']) {
      expect(budget).toContain(required);
    }
  });

  it('the runbook is honest: what is reference-implementation only vs what a real deployment must wire', () => {
    const readme = read('README.md');
    expect(readme).toContain('What is reference-implementation only');
    expect(readme).toContain('Real deployment must wire');
    for (const page of ['diagnosis.md', 'outage-playbooks.md', 'backup-restore.md', 'rollback.md', 'abuse-response.md', 'budget-exhaustion.md']) {
      const text = read(page);
      expect(
        text.includes('NOT_YET_CONNECTED') || text.includes('reference') || text.includes('adapters'),
        `${page} must state its honest status`,
      ).toBe(true);
    }
  });

  it('PINNED: demo fixtures are never referenced as production state', () => {
    for (const page of ['README.md', 'diagnosis.md', 'outage-playbooks.md', 'backup-restore.md', 'rollback.md', 'abuse-response.md', 'budget-exhaustion.md']) {
      const text = read(page);
      expect(text).not.toMatch(/demo fixture (is|as) (live|production) state/i);
      expect(text, `${page} must never treat demo fixtures as production state`).not.toMatch(/fixtures? are (the )?production state/i);
    }
  });
});
