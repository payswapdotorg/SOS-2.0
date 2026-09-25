/**
 * The system clock — the single impure time boundary (the documented
 * apps/observation + apps/api precedent). Everything deeper receives a
 * Clock; only process-boundary hosts construct this.
 */

import type { Clock } from '@sos-2/live-store';

export class SystemClock implements Clock {
  nowEpochMs(): number {
    return Date.now();
  }
}
