/**
 * Error hierarchy for @sos-2/runtimes.
 * All errors extend SemanticSpineError (same pattern as the spine and the
 * sibling Work Order packages). Undeclared runtimes, undeclared operations,
 * malformed descriptors and malformed requests always fail loudly; the
 * AUTHORITY denials (expired/revoked/missing grants) are structured results,
 * not throws — an operational denial is an expected outcome, recorded and
 * reportable.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class RuntimeError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export class RuntimeDescriptorError extends RuntimeError {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeDescriptorError';
  }
}

export class RuntimeRequestError extends RuntimeError {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeRequestError';
  }
}

export class RuntimeObservationError extends RuntimeError {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeObservationError';
  }
}
