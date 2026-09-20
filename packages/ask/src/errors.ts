/**
 * @sos-2/ask error type. ASK is a SUCCESS state — valid ask workflows never
 * throw. This error type exists only for invalid ask OPERATIONS (an origin
 * that is not an ASK record, a resolution referencing a foreign
 * alternative, a malformed queue input) — the same loud-failure discipline
 * as AuthorityError / AutonomyError / DecisionError.
 */

export class AskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AskError';
  }
}
