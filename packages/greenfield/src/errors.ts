/**
 * @sos-2/greenfield errors — the single error type of the greenfield
 * orchestrator (Work Order W14). Stage failures, trace-chain failures and
 * input-validation failures all surface as GreenfieldError with a precise
 * message; underlying package errors are wrapped (never swallowed) with
 * their cause attached.
 */

export class GreenfieldError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GreenfieldError';
  }
}
