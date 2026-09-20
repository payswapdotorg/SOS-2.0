/**
 * Experiment discipline errors.
 *
 * ExperimentError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * experiment-specific failures by name. Invalid experiment knowledge ALWAYS
 * fails loudly: a lifecycle skip, an out-of-ladder canary exposure, an
 * undeclared guardrail or a silently-successful unknown guardrail are never
 * minted (spec/architecture.md §5 Experiment, §18; spec/architecture-lock.md
 * "Experiment semantics" may not be redefined by ordinary implementation).
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class ExperimentError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'ExperimentError';
  }
}
