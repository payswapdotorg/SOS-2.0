// ---------------------------------------------------------------------------
// COMPOSITION BOUNDARY (apps/task-runner only — the documented
// ambient-time boundary, following the apps/actions and
// apps/worker-runtimes system-clock precedents). Every other owned
// source receives time through the injected Clock port.
// ---------------------------------------------------------------------------

export interface Clock {
  nowEpochMs(): number;
}

export class SystemClock implements Clock {
  nowEpochMs(): number {
    return Date.now();
  }
}

/** Deterministic clock for tests and offline runs. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: number = 1_000_000) {
    this.current = start;
  }

  nowEpochMs(): number {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}
