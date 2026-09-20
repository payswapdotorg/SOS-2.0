/**
 * Package-discipline errors.
 *
 * PackageError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * package-specific failures by name. Invalid packages ALWAYS fail loudly:
 * packages require evidence (spec/architecture.md §18), so nothing
 * questionable is ever silently minted into the package ecology.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class PackageError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'PackageError';
  }
}
