/**
 * The system clock — the ONLY impure spot of apps/worker-runtimes,
 * living at the composition boundary (the apps/api precedent: the
 * composition root injects real time; everything deeper consumes the
 * injected Clock port).
 */

import type { Clock } from '@sos-2/live-store';

/** A clock reading the real system time (boundary only — never in host/composition src). */
export class SystemClock implements Clock {
  nowEpochMs(): number {
    return Date.now();
  }
}
