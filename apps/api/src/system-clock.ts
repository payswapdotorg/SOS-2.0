/**
 * The system clock — the ONLY impure spot of apps/api, living at the
 * composition boundary (mirroring the apps/console precedent: the app's
 * composition root injects real time; everything inside the service and
 * the live-store consumes the injected Clock port).
 */

import type { Clock } from '@sos-2/live-store';

/** A clock reading the real system time (boundary only — never in package src). */
export class SystemClock implements Clock {
  nowEpochMs(): number {
    return Date.now();
  }
}
