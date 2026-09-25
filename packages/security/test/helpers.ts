// No vitest import: helpers carry only deterministic fixtures
// (the P3 zero-dependency test precedent).
import type { Clock, Timestamp } from '../src/index.js';

export class ManualClock implements Clock {
  private current: Timestamp;
  constructor(start: number = 1_000_000) {
    this.current = start;
  }
  now(): Timestamp {
    return this.current;
  }
  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}

export function taskContext(overrides: Partial<{ taskId: string; missionId: string | null; projectId: string; bodyId: string | null }> = {}) {
  return {
    taskId: 'task-1',
    missionId: 'mission-1',
    projectId: 'project-A',
    bodyId: 'body-1',
    ...overrides,
  };
}
