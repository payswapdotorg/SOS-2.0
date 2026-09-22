/**
 * THE SYSTEM CLOCK — the app's single impure boundary (Work Order P6,
 * the apps/worker-runtimes precedent).
 *
 * This module is the ONLY place in the P6-owned sources that reads the
 * ambient clock. The DETERMINISTIC demo main does NOT use it — it runs
 * on a ManualClock at a fixed instant so the printed journey report is
 * byte-reproducible; a real deployment injects this clock at composition
 * time instead, WITHOUT contract change.
 */

import type { Clock } from '@sos-2/live-store';

/** The real-time clock adapter (the documented impure boundary). */
export class SystemClock implements Clock {
  nowEpochMs(): number {
    return Date.now();
  }
}
