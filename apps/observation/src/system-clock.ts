/**
 * The system clock — the single impure boundary of the observation host
 * (the apps/api + apps/worker-runtimes composition-root precedent).
 *
 * Everything deeper in the P7 packages is deterministic (injected
 * ManualClock in tests). ONLY this file (and the demo main in index.ts
 * that instantiates it) touches real time. No other ambient source of
 * time, randomness, network or process exists in the P7-owned sources.
 */

import type { Clock } from '@sos-2/live-store';

export class SystemClock implements Clock {
  nowEpochMs(): number {
    return Date.now();
  }
}
