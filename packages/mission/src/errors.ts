/**
 * Mission-discipline errors.
 *
 * MissionError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * mission-specific failures by name.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class MissionError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'MissionError';
  }
}
