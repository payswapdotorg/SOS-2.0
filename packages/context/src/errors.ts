/**
 * Context-discipline errors.
 *
 * ContextError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * context-specific failures by name.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class ContextError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'ContextError';
  }
}
