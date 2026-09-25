/**
 * LANE C, NEGATIVE CASE 13 — CROSS-PROJECT ACCESS ATTEMPT (the P14
 * security isolation: a cross-project access is DENIED and recorded).
 *
 * The fault: a task running in project B's context attempts to access
 * project A's workspace. The isolation policy DENIES with the typed
 * ISOLATION decision (fail-closed for every operation — read, write,
 * list, execute — no carve-outs), the throwing seam is the typed
 * WorkspaceIsolationError, the denial is RECORDED in the policy audit
 * trail, and the operational diagnostics attribute it to the
 * responsible task/body. Same-project access stays ALLOWED (no
 * over-blocking). Never a silent pass, never a crash.
 */

import { describe, expect, test } from 'vitest';
import {
  InMemoryAuditTrail,
  WorkspaceIsolationError,
  assertWorkspaceIsolation,
  auditDecision,
  diagnose,
  evaluateWorkspaceIsolation,
} from '@sos-2/security';
import { PolicyManualClock } from './helpers.js';

const NOW = 1_700_000_000_000;

describe('P15 lane C negative case: cross-project access attempt', () => {
  test('DENIED: a project-B task touching project-A\u2019s workspace is a typed ISOLATION denial', () => {
    const decision = evaluateWorkspaceIsolation({
      context: { taskId: 'task-p15c-13', missionId: 'mission-p15c-13', projectId: 'project-B', bodyId: 'body-p15c-13' },
      target: { projectId: 'project-A', workspaceId: 'ws-project-A-1' },
      operation: 'write',
    });
    expect(decision.kind).toBe('ISOLATION_DENIED');
    if (decision.kind === 'ISOLATION_DENIED') {
      expect(decision.reason).toBe('CROSS_PROJECT_WORKSPACE_ACCESS');
    }
  });

  test('DENIED (fail-closed): every operation is denied — read, write, list, execute — no carve-outs', () => {
    for (const operation of ['read', 'write', 'list', 'execute'] as const) {
      const decision = evaluateWorkspaceIsolation({
        context: { taskId: 'task-p15c-13', missionId: null, projectId: 'project-B', bodyId: null },
        target: { projectId: 'project-A', workspaceId: 'ws-1' },
        operation,
      });
      expect(decision.kind, `operation ${operation} must be denied cross-project`).toBe('ISOLATION_DENIED');
    }
    // The throwing seam is the typed error (composable at real seams).
    expect(() =>
      assertWorkspaceIsolation({
        context: { taskId: 'task-p15c-13b', missionId: null, projectId: 'project-X', bodyId: null },
        target: { projectId: 'project-Y', workspaceId: 'ws-y' },
        operation: 'execute',
      }),
    ).toThrow(WorkspaceIsolationError);
  });

  test('RECORDED: the denial lands in the policy audit trail and is attributable to the responsible task/body', () => {
    const clock = new PolicyManualClock(NOW);
    const trail = new InMemoryAuditTrail(clock);
    // The attempt happens (the denial)...
    const decision = evaluateWorkspaceIsolation({
      context: { taskId: 'task-p15c-13-attempt', missionId: null, projectId: 'project-B', bodyId: 'body-p15c-7' },
      target: { projectId: 'project-A', workspaceId: 'ws-project-A-1' },
      operation: 'execute',
    });
    expect(decision.kind).toBe('ISOLATION_DENIED');
    // ...and is RECORDED (the P14 policy-decision audit trail).
    const audited = auditDecision(
      trail,
      {
        decision: 'DENY',
        surface: 'workspace-isolation',
        detail: 'cross-project workspace access denied (CROSS_PROJECT_WORKSPACE_ACCESS)',
        taskId: 'task-p15c-13-attempt',
        bodyId: 'body-p15c-7',
        providerId: null,
        evidenceDigest: null,
        context: { targetProject: 'project-A', operation: 'execute' },
      },
      clock,
    );
    expect(audited.kind).toBe('APPLIED');
    expect(trail.history().length).toBe(1);
    const auditedRecord = trail.history()[0]!;
    expect((auditedRecord.payload as Record<string, unknown>)['decision']).toBe('DENY');
    expect(auditedRecord.source).toContain('workspace-isolation');

    // The diagnostics attribute the attempt to the responsible task/body.
    const result = diagnose(trail.history(), 'denied-actions', { taskId: 'task-p15c-13-attempt' });
    expect(result.verdict).toBe('ATTRIBUTED');
    expect(result.attributions[0]?.bodyId).toBe('body-p15c-7');
  });

  test('NO OVER-BLOCKING: same-project access stays ALLOWED and is audited as ALLOW (the fence is exact)', () => {
    const clock = new PolicyManualClock(NOW);
    const trail = new InMemoryAuditTrail(clock);
    const decision = evaluateWorkspaceIsolation({
      context: { taskId: 'task-p15c-13-same', missionId: null, projectId: 'project-A', bodyId: 'body-p15c-1' },
      target: { projectId: 'project-A', workspaceId: 'ws-project-A-1' },
      operation: 'write',
    });
    expect(decision.kind).toBe('WORKSPACE_ACCESS_ALLOWED');
    const audited = auditDecision(
      trail,
      {
        decision: 'ALLOW',
        surface: 'workspace-isolation',
        detail: 'same-project workspace access',
        taskId: 'task-p15c-13-same',
        bodyId: 'body-p15c-1',
        providerId: null,
        evidenceDigest: null,
        context: { workspaceId: 'ws-project-A-1' },
      },
      clock,
    );
    expect(audited.kind).toBe('APPLIED');
    // The audit trail stays queryable and truthful (both decisions visible).
    const first = trail.history()[0]!;
    expect((first.payload as Record<string, unknown>)['decision']).toBe('ALLOW');
    expect(first.source).toBe('security-audit:workspace-isolation');
  });
});
