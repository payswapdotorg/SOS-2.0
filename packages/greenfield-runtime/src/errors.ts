/**
 * Typed errors of the greenfield runtime. Every violation names the rule
 * and the offending value — nothing fails silently.
 */

export class GreenfieldRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GreenfieldRuntimeError';
  }
}

/** The journey was invoked outside its typed stage order. */
export class JourneyStageError extends GreenfieldRuntimeError {
  constructor(message: string) {
    super(message);
    this.name = 'JourneyStageError';
  }
}

/** A journey dependency (port) is missing or malformed. */
export class InvalidJourneyDepsError extends GreenfieldRuntimeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJourneyDepsError';
  }
}

/** A completion-report shape failed validation. */
export class InvalidCompletionReportError extends GreenfieldRuntimeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCompletionReportError';
  }
}
