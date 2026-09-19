/**
 * Telemetry-discipline errors.
 *
 * TelemetryError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * telemetry-specific failures by name. Invalid telemetry input ALWAYS fails
 * loudly at ingestion (telemetry is INPUT — but not garbage).
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class TelemetryError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetryError';
  }
}
