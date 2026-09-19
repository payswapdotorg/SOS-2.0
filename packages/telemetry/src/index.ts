/**
 * @sos-2/telemetry — SOS 2.0 Telemetry (Work Order W3).
 *
 * The TelemetrySource ingestion CONTRACT (pull- and push-based) producing
 * validated, normalized raw observations with capture-level availability
 * marking; an in-memory adapter with explicit gap recording; and an
 * OpenTelemetry-compatible adapter (spans/metrics/logs modeled as types and
 * converted without any OTel SDK at runtime).
 *
 * TELEMETRY IS INPUT, NOT SEMANTIC TRUTH: truth-state assignment happens in
 * the evidence layer (@sos-2/evidence) with explicit method provenance.
 */

export * from './errors.js';
export * from './observation.js';
export * from './otel.js';
export * from './source.js';
