// No vitest import: the borrowed toolchain runs with `globals: true`
// (the P3 infra-deployment precedent for zero-dependency packages).
import {
  evaluateWorkspaceIsolation,
  assertWorkspaceIsolation,
  WORKSPACE_ISOLATION_POLICY,
  WorkspaceIsolationError,
} from '../src/index.js';
import { taskContext } from './helpers.js';

describe('workspace isolation (pinned: no cross-project workspace access)', () => {
  it('grants same-project workspace access', () => {
    const decision = evaluateWorkspaceIsolation({
      context: taskContext(),
      target: { projectId: 'project-A', workspaceId: 'ws-project-A-1' },
      operation: 'write',
    });
    expect(decision.kind).toBe('WORKSPACE_ACCESS_ALLOWED');
  });

  it('PINNED: an access request for project A workspace under project B task context is a typed ISOLATION denial (fail-closed)', () => {
    const decision = evaluateWorkspaceIsolation({
      context: taskContext({ projectId: 'project-B' }),
      target: { projectId: 'project-A', workspaceId: 'ws-project-A-1' },
      operation: 'read',
    });
    expect(decision.kind).toBe('ISOLATION_DENIED');
    if (decision.kind === 'ISOLATION_DENIED') {
      expect(decision.reason).toBe('CROSS_PROJECT_WORKSPACE_ACCESS');
      expect(decision.detail).toContain('project-B');
      expect(decision.detail).toContain('project-A');
      expect(decision.detail).toContain('fail-closed');
    }
  });

  it('denies for every operation kind (read/write/list/execute) — no operation carve-out', () => {
    for (const operation of ['read', 'write', 'list', 'execute'] as const) {
      const decision = evaluateWorkspaceIsolation({
        context: taskContext({ projectId: 'project-B' }),
        target: { projectId: 'project-A', workspaceId: 'ws-project-A-1' },
        operation,
      });
      expect(decision.kind).toBe('ISOLATION_DENIED');
    }
  });

  it('the throwing seam raises the typed WorkspaceIsolationError and nothing leaks workspace contents', () => {
    expect(() =>
      assertWorkspaceIsolation({
        context: taskContext({ projectId: 'project-B' }),
        target: { projectId: 'project-A', workspaceId: 'ws-project-A-1' },
        operation: 'execute',
      }),
    ).toThrow(WorkspaceIsolationError);
  });

  it('a malformed request is rejected (never granted)', () => {
    expect(() =>
      evaluateWorkspaceIsolation({
        context: { taskId: '', missionId: null, projectId: 'project-A', bodyId: null },
        target: { projectId: 'project-A', workspaceId: 'ws-1' },
        operation: 'read',
      }),
    ).toThrow(WorkspaceIsolationError);
  });

  it('the policy record is enforced data, not an authority surface', () => {
    expect(WORKSPACE_ISOLATION_POLICY.rule).toBe('NO_CROSS_PROJECT_WORKSPACE_ACCESS');
    expect(WORKSPACE_ISOLATION_POLICY.enforced).toBe(true);
  });
});
