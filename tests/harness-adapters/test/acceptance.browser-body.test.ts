/**
 * ACCEPTANCE (Work Order P8): the BROWSER/EVALUATOR BODY — a
 * capability-advertised browser-journey body through an injectable
 * browser port (typed records; the real browser bridge is a later-wave
 * adapter; THIS BODY PROVES THE CONTRACT).
 */

import { describe, expect, it } from 'vitest';
import { acceptanceWorld } from './acceptance-world.js';

describe('acceptance: the browser/evaluator body', () => {
  it('executes a complete browser journey through the PUBLIC contract behind the broker', async () => {
    const world = acceptanceWorld();
    world.registerBrowserBody();
    const task = await world.createTask({
      task_id: 'task-browser-journey-0001',
      requirements: { requiredCapabilities: ['browser-ui'], placement: 'cloud' },
    });
    expect(task.status).toBe('RUNNING');

    const opened = await world.fabric.execute('task-browser-journey-0001', { kind: 'browser.open', url: 'https://example.com/status' });
    expect(opened.status).toBe('EXECUTED');
    if (opened.status !== 'EXECUTED') {
      return;
    }
    expect(opened.availability).toBe('SUCCESS');
    expect(opened.output).toMatchObject({ page_id: 'page-001', url: 'https://example.com/status', title: 'Example Status' });

    const read = await world.fabric.execute('task-browser-journey-0001', {
      kind: 'browser.interact',
      page_id: 'page-001',
      action: 'read',
      target: '#status',
      value: null,
    });
    expect(read.status === 'EXECUTED' && read.availability).toBe('SUCCESS');
    expect(read.status === 'EXECUTED' && read.output).toMatchObject({ result: 'all systems operational' });

    const clicked = await world.fabric.execute('task-browser-journey-0001', {
      kind: 'browser.interact',
      page_id: 'page-001',
      action: 'click',
      target: '#refresh',
      value: null,
    });
    expect(clicked.status === 'EXECUTED' && clicked.availability).toBe('SUCCESS');

    // Evidence capture + observation emission ride the same typed boundaries.
    expect(
      (await world.fabric.execute('task-browser-journey-0001', { kind: 'artifacts.capture', name: 'status-snapshot', content: 'operational' })).status,
    ).toBe('EXECUTED');
    expect(
      (await world.fabric.execute('task-browser-journey-0001', { kind: 'observations.emit', observation_kind: 'body.progress', payload: { page: 1 } })).status,
    ).toBe('EXECUTED');

    const completion = await world.fabric.completeTask('task-browser-journey-0001', {
      verified: true,
      recorded_at: '2026-01-15T10:00:00Z',
      evidence_refs: [],
      summary: 'browser journey completed through the typed-record port',
    });
    expect(completion.status).toBe('TRANSITIONED');
    const taskAfter = await world.store.tasks.get('task-browser-journey-0001');
    expect(taskAfter?.status).toBe('COMPLETED');
    expect(taskAfter?.artifacts.length).toBe(1);

    // Lease released.
    const lease = await world.store.bodyLeases.get('lease:task-browser-journey-0001:0001');
    expect(lease?.state).toBe('RELEASED');
  });

  it('refuses navigation outside its declared host policy (truthful FAILED, bounded by declaration)', async () => {
    const world = acceptanceWorld();
    world.registerBrowserBody();
    await world.createTask({
      task_id: 'task-browser-refused-0001',
      requirements: { requiredCapabilities: ['browser-ui'], placement: 'cloud' },
    });
    const refused = await world.fabric.execute('task-browser-refused-0001', { kind: 'browser.open', url: 'https://evil.example.net/status' });
    expect(refused.status).toBe('EXECUTED');
    if (refused.status === 'EXECUTED') {
      expect(refused.availability).toBe('FAILURE');
      expect(refused.error).toContain('not admitted');
    }
  });

  it('answers typed UNSUPPORTED for unadvertised surfaces (shell/git/workspace — explicit, never silent)', async () => {
    const world = acceptanceWorld();
    world.registerBrowserBody();
    await world.createTask({
      task_id: 'task-browser-unsup-0001',
      requirements: { requiredCapabilities: ['browser-ui'], placement: 'cloud' },
    });
    for (const step of [
      { kind: 'shell.exec', command: 'ls', args: [], cwd: null },
      { kind: 'git.status' },
      { kind: 'workspace.read', path: 'x' },
    ] as const) {
      const refused = await world.fabric.execute('task-browser-unsup-0001', step);
      expect(refused.status).toBe('UNSUPPORTED');
      if (refused.status === 'UNSUPPORTED') {
        expect(refused.reason).toContain('advertisement');
      }
    }
  });
});
