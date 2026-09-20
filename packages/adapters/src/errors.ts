/**
 * Error hierarchy for @sos-2/adapters.
 * All errors extend SemanticSpineError (same pattern as the spine and the
 * sibling Work Order packages). Adapters fail loudly: a novel semantic
 * concept, an output that does not bridge onto a domain type, an
 * authority-refused execution and an unauthoritative-typed LLM output are
 * never silently accepted.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class AdapterError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}

/** Raised when an adapter attempts to introduce or emit a novel semantic concept. */
export class SemanticBridgeError extends AdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'SemanticBridgeError';
  }
}

export class RepositoryAdapterError extends AdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryAdapterError';
  }
}

export class TelemetryAdapterError extends AdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetryAdapterError';
  }
}

export class ReasoningProviderError extends AdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'ReasoningProviderError';
  }
}

export class ExecutionAdapterError extends AdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionAdapterError';
  }
}
