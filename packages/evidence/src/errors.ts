/**
 * Evidence-discipline errors.
 *
 * EvidenceError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * evidence-specific failures by name. Invalid evidence ALWAYS fails loudly:
 * evidence outranks assertion about system reality (spec/architecture.md §18),
 * so nothing questionable is ever silently minted into the Evidence Graph.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class EvidenceError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceError';
  }
}
