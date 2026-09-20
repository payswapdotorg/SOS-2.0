/**
 * Provenance-discipline errors.
 *
 * ProvenanceError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * provenance-specific failures by name. Invalid provenance ALWAYS fails
 * loudly; broken chains are REPORTED (as UNKNOWN), never silently truncated.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class ProvenanceError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'ProvenanceError';
  }
}
