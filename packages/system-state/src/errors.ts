/**
 * Error hierarchy for @sos-2/system-state.
 * All errors extend SemanticSpineError so callers can distinguish SOS
 * discipline violations from unrelated failures (same pattern as the spine).
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class SystemStateError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'SystemStateError';
  }
}
