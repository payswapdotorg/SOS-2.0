/**
 * Error hierarchy for @sos-2/recovery-control.
 * All errors extend SemanticSpineError (same pattern as the spine and the
 * sibling WO packages). Unbounded recovery, ungoverned weakening and
 * candidate-originated attempts to disable assurance controls always fail
 * loudly.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class RecoveryControlError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryControlError';
  }
}

export class RecoveryDeclarationError extends RecoveryControlError {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryDeclarationError';
  }
}

export class RecoveryPolicyError extends RecoveryControlError {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryPolicyError';
  }
}

export class TrustedBoundaryError extends RecoveryControlError {
  constructor(message: string) {
    super(message);
    this.name = 'TrustedBoundaryError';
  }
}

export class RecoveryGateError extends RecoveryControlError {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryGateError';
  }
}
