/**
 * Error hierarchy for @sos-2/runtime-conformance (Work Order W4).
 * All errors extend SemanticSpineError (same pattern as the spine and the
 * W1/W2/W3 sibling packages). Malformed input fails loudly; MISSING DATA
 * never fails — it becomes truthful UNKNOWN/UNAVAILABLE evidence instead.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class RuntimeConformanceError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeConformanceError';
  }
}
