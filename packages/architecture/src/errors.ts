/**
 * Error hierarchy for @sos-2/architecture.
 * All errors extend SemanticSpineError (same pattern as the spine and W1's
 * packages) so callers can distinguish SOS discipline violations from
 * unrelated failures.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class ArchitectureError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'ArchitectureError';
  }
}

/** Graph structure violations (unknown kinds, duplicates, dangling edges). */
export class GraphError extends ArchitectureError {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

/** Graph diff / apply violations (malformed diffs, base mismatches). */
export class GraphDiffError extends ArchitectureError {
  constructor(message: string) {
    super(message);
    this.name = 'GraphDiffError';
  }
}

/** LocalCandidate / evolution operator violations (out-of-bounds ops). */
export class CandidateError extends ArchitectureError {
  constructor(message: string) {
    super(message);
    this.name = 'CandidateError';
  }
}
