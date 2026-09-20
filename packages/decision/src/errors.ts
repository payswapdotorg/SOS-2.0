/**
 * @sos-2/decision error type. Structurally invalid decision inputs fail
 * loudly (the same discipline as AuthorityError / AutonomyError /
 * PromotionError); semantically refusable inputs are REJECTED as decisions,
 * never thrown.
 */

export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionError';
  }
}
