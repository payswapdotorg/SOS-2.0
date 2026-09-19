/**
 * Value-model-discipline errors.
 *
 * ValueModelError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * value-specific failures by name.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class ValueModelError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'ValueModelError';
  }
}
