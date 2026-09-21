/**
 * Typed errors for @sos-2/telemetry-runtime.
 *
 * Only contract violations throw (malformed wiring). Poll failures and
 * gaps are typed outcomes — the runtime keeps polling and reports.
 */

export class TelemetryRuntimeError extends Error {
  readonly code: 'TELEMETRY_RUNTIME';

  constructor(message: string) {
    super(message);
    this.name = 'TelemetryRuntimeError';
    this.code = 'TELEMETRY_RUNTIME';
  }
}
