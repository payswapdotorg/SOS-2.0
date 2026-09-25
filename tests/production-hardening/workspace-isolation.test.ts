/**
 * PINNED: no cross-project workspace access (typed denial, fail-closed)
 * — the acceptance composition: the isolation decision feeds the audit
 * trail (every decision auditable) and composes with the diagnostics
 * attribution.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateWorkspaceIsolation,
  assertWorkspaceIsolation,
  WorkspaceIsolationError,
  InMemoryAuditTrail,
  auditDecision,
  diagnose,
} from '@sos-2/security';
import { ManualClock } from './helpers.js';

describe('acceptance: no cross-project workspace access (typed denial, fail-closed)', () => {
  it('PINNED: project A workspace access under project B task context is a typed ISOLATION denial', () => {
    const decision = evaluateWorkspaceIsolation({
      context: { taskId: 'task-1', missionId: 'mission-1', projectId: 'project-B', bodyId: 'body-1' },
      target: { projectId: 'project-A', workspaceId: 'ws-project-A-1' },
      operation: 'write',
    });
    expect(decision.kind).toBe('ISOLATION_DENIED');
    if (decision.kind === 'ISOLATION_DENIED') {
      expect(decision.reason).toBe('CROSS_PROJECT_WORKSPACE_ACCESS');
    }
  });

  it('the denial is fail-closed for read AND write operations (no carve-outs)', () => {
    for (const operation of ['read', 'write', 'list', 'execute'] as const) {
      const decision = evaluateWorkspaceIsolation({
        context: { taskId: 'task-1', missionId: null, projectId: 'project-B', bodyId: null },
        target: { projectId: 'project-A', workspaceId: 'ws-1' },
        operation,
      });
      expect(decision.kind).toBe('ISOLATION_DENIED');
    }
  });

  it('same-project access is allowed and audited as ALLOW', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    const decision = evaluateWorkspaceIsolation({
      context: { taskId: 'task-1', missionId: null, projectId: 'project-A', bodyId: 'body-1' },
      target: { projectId: 'project-A', workspaceId: 'ws-project-A-1' },
      operation: 'write',
    });
    expect(decision.kind).toBe('WORKSPACE_ACCESS_ALLOWED');
    const outcome = auditDecision(
      trail,
      {
        decision: 'ALLOW',
        surface: 'workspace-isolation',
        detail: 'same-project workspace access',
        taskId: 'task-1',
        bodyId: 'body-1',
        providerId: null,
        evidenceDigest: null,
        context: { workspaceId: 'ws-project-A-1' },
      },
      clock,
    );
    expect(outcome.kind).toBe('APPLIED');
  });

  it('the throwing seam is the typed WorkspaceIsolationError (composable at real seams)', () => {
    expect(() =>
      assertWorkspaceIsolation({
        context: { taskId: 'task-2', missionId: null, projectId: 'project-X', bodyId: null },
        target: { projectId: 'project-Y', workspaceId: 'ws-y' },
        operation: 'execute',
      }),
    ).toThrow(WorkspaceIsolationError);
  });

  it('isolation denials are diagnosable to the responsible task/body', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    auditDecision(
      trail,
      {
        decision: 'DENY',
        surface: 'workspace-isolation',
        detail: 'cross-project denied',
        taskId: 'task-42',
        bodyId: 'body-7',
        providerId: null,
        evidenceDigest: null,
        context: null,
      },
      clock,
    );
    const result = diagnose(trail.history(), 'denied-actions', { taskId: 'task-42' });
    expect(result.verdict).toBe('ATTRIBUTED');
    expect(result.attributions[0]?.bodyId).toBe('body-7');
  });
});
