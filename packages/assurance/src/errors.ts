/**
 * Error hierarchy for @sos-2/assurance.
 * All errors extend SemanticSpineError (same pattern as the spine and the
 * W1/W2/W3/W4/W5 sibling packages). Invalid assurance transitions and
 * indeterminate evaluations always fail loudly.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class AssuranceError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'AssuranceError';
  }
}

export class AssuranceEvaluationError extends AssuranceError {
  constructor(message: string) {
    super(message);
    this.name = 'AssuranceEvaluationError';
  }
}

export class ObjectionError extends AssuranceError {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectionError';
  }
}

export class ConformanceAdoptionError extends AssuranceError {
  constructor(message: string) {
    super(message);
    this.name = 'ConformanceAdoptionError';
  }
}
