// ---------------------------------------------------------------------------
// COMPOSITION BOUNDARY (apps/actions only — the documented ambient-time
// boundary, following the apps/worker-runtimes system-clock precedent).
// Every other owned source receives time through the injected Clock port.
// ---------------------------------------------------------------------------

export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Deterministic clock for tests and offline runs. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: number = 1_000_000) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}
