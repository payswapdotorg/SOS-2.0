/**
 * Error hierarchy for @sos-2/verification.
 * All errors extend SemanticSpineError (same pattern as the spine and the
 * sibling WO packages). Malformed monitors/events/contexts and dishonest
 * engine outputs always fail loudly.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class MonitorError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'MonitorError';
  }
}

export class MonitorEngineError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'MonitorEngineError';
  }
}
