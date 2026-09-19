/**
 * Error hierarchy for @sos-2/conformance.
 * All errors extend SemanticSpineError (same pattern as the spine, W1 and
 * W2 sibling packages). Note: the spine's own ConformanceError is NOT
 * re-exported here — these are the W2 conformance-package errors.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class InvariantError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

export class ReconciliationError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'ReconciliationError';
  }
}
