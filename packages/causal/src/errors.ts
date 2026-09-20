/**
 * Causal-knowledge discipline errors.
 *
 * CausalError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * causal-specific failures by name. Invalid causal knowledge ALWAYS fails
 * loudly: intervention evidence outranks observational correlation for
 * strong causal claims (spec/architecture.md §18), so nothing that conflates
 * correlation with causation, or that hides its evidence basis or LLM
 * involvement, is ever silently minted.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class CausalError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'CausalError';
  }
}
