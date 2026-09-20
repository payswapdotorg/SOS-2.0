/**
 * Error hierarchy for @sos-2/deployment.
 * All errors extend SemanticSpineError (same pattern as the spine and the
 * sibling Work Order packages). Invalid lifecycle transitions, unbounded
 * rollback declarations, truth-state conflation and simulated outcomes
 * posing as intervention evidence all fail loudly.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class DeploymentError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentError';
  }
}

export class DeploymentRecordError extends DeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentRecordError';
  }
}

export class DeploymentLifecycleError extends DeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentLifecycleError';
  }
}

export class DeploymentOutcomeError extends DeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentOutcomeError';
  }
}

export class DeploymentSimulationError extends DeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentSimulationError';
  }
}
