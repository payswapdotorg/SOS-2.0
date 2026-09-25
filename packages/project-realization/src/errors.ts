/**
 * Typed errors of project realization. Every violation names the rule and
 * the offending value — nothing fails silently.
 */

export class ProjectRealizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectRealizationError';
  }
}

/** A realization plan (or fragment) failed structural validation. */
export class InvalidRealizationPlanError extends ProjectRealizationError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRealizationPlanError';
  }
}

/** The realizer was invoked outside its contract (wrong stage, missing base). */
export class InvalidRealizationCallError extends ProjectRealizationError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRealizationCallError';
  }
}
