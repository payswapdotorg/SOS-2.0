/**
 * Promotion discipline errors.
 *
 * PromotionError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * promotion-specific failures by name. Invalid promotion requests ALWAYS
 * fail loudly: an expired or revoked grant, an invalid assurance case,
 * simulated evidence presented as intervention evidence, a high-confidence
 * candidate without authority, an unknown guardrail silently treated as
 * success, or a live change without bounded recovery are never silently
 * waved through (spec/architecture.md §13, §14, §18;
 * spec/architecture-lock.md forbidden shortcuts: "confidence alone
 * authorizing risky changes", "package promoted after one lucky success").
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class PromotionError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'PromotionError';
  }
}
