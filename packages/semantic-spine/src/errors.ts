/**
 * Error hierarchy for the Semantic Spine.
 * All spine errors extend SemanticSpineError so callers can distinguish
 * spine discipline violations from unrelated failures.
 */

export class SemanticSpineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SemanticSpineError';
  }
}

export class IdentityError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityError';
  }
}

export class LifecycleError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'LifecycleError';
  }
}

export class TraceLinkError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'TraceLinkError';
  }
}

export class CanonicalizationError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

export class ArchitectureDeltaError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'ArchitectureDeltaError';
  }
}

export class ConformanceError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'ConformanceError';
  }
}
