/**
 * Composition-discipline errors.
 *
 * CompositionError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * composition-specific failures by name. Invalid compositions ALWAYS fail
 * loudly: compositions require their own evidence (spec/architecture.md
 * §18), so nothing questionable is ever silently minted.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class CompositionError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'CompositionError';
  }
}
