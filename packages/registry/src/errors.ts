/**
 * Registry-discipline errors.
 *
 * RegistryError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * registry-specific failures by name.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class RegistryError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}
