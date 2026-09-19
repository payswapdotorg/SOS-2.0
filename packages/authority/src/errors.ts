/**
 * Authority-discipline errors.
 *
 * AuthorityError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * authority-specific failures by name. Invalid authority transitions and
 * unauthorized operations ALWAYS fail loudly with AuthorityError.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class AuthorityError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorityError';
  }
}
