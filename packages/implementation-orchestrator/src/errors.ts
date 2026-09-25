/**
 * Typed errors of the implementation orchestrator. Every violation names
 * the rule and the offending value — nothing fails silently.
 */

export class ImplementationOrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImplementationOrchestratorError';
  }
}

/** An implementation plan (or plan fragment) failed structural validation. */
export class InvalidImplementationPlanError extends ImplementationOrchestratorError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImplementationPlanError';
  }
}

/** A decomposition failed structural validation (cycles, scope overlap, orphans). */
export class InvalidDecompositionError extends ImplementationOrchestratorError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDecompositionError';
  }
}

/** A mission intake input failed validation. */
export class InvalidMissionIntakeError extends ImplementationOrchestratorError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMissionIntakeError';
  }
}
