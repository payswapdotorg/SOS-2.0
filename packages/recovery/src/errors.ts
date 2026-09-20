/**
 * Error hierarchy for @sos-2/recovery (Work Order W4).
 * All errors extend SemanticSpineError (same pattern as the spine and the
 * W1/W2/W3 sibling packages). Invalid recovery input always fails loudly —
 * ambiguous evidence produces MULTIPLE hypotheses, never an error, but
 * malformed input (missing provenance, invalid ids, invalid configuration)
 * is rejected.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class RecoveryError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryError';
  }
}

export class ReconciliationReportError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'ReconciliationReportError';
  }
}
