/**
 * Time windows — the shared temporal shape for provenance records, telemetry
 * observations and evidence records (W3 owns exactly ONE definition; the
 * evidence and telemetry packages import it from here).
 *
 * start and end are RFC3339 timestamps (caller-supplied; never a hidden
 * clock) with start <= end (compared on the absolute timeline, so mixed
 * timezone offsets are handled correctly via Date.parse).
 */

import { RFC3339_PATTERN } from '@sos-2/semantic-spine';
import { ProvenanceError } from './errors.js';

export interface TimeWindow {
  /** RFC3339 timestamp; window start (inclusive). */
  start: string;
  /** RFC3339 timestamp; window end (inclusive); must not precede start. */
  end: string;
}

export function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_PATTERN.test(value);
}

/** Parse an RFC3339 timestamp to epoch milliseconds. Throws on invalid input. */
export function rfc3339ToEpochMs(value: string): number {
  if (!isRfc3339(value)) {
    throw new ProvenanceError(`not an RFC3339 timestamp: ${JSON.stringify(value)}`);
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) {
    throw new ProvenanceError(`unparseable RFC3339 timestamp: ${JSON.stringify(value)}`);
  }
  return epochMs;
}

/** Structural check: { start, end } with RFC3339 values and start <= end. */
export function isTimeWindow(value: unknown): value is TimeWindow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    return false;
  }
  if (typeof record['start'] !== 'string' || typeof record['end'] !== 'string') {
    return false;
  }
  try {
    return rfc3339ToEpochMs(record['start']) <= rfc3339ToEpochMs(record['end']);
  } catch {
    return false;
  }
}

/** Full validation with a specific error message (throws ProvenanceError). */
export function assertValidTimeWindow(value: unknown): asserts value is TimeWindow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProvenanceError('time window must be an object with exact fields { start, end }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !('start' in record) || !('end' in record)) {
    throw new ProvenanceError('time window must be an object with exact fields { start, end }');
  }
  if (!isRfc3339(record['start'])) {
    throw new ProvenanceError(`time window start is not an RFC3339 timestamp: ${JSON.stringify(record['start'])}`);
  }
  if (!isRfc3339(record['end'])) {
    throw new ProvenanceError(`time window end is not an RFC3339 timestamp: ${JSON.stringify(record['end'])}`);
  }
  if (rfc3339ToEpochMs(record['start']) > rfc3339ToEpochMs(record['end'])) {
    throw new ProvenanceError(
      `time window start must not be after end: ${JSON.stringify(record['start'])} > ${JSON.stringify(record['end'])}`,
    );
  }
}

/** Whether `instant` (RFC3339) is strictly after the window's end. */
export function isAfterWindow(window: TimeWindow, instant: string): boolean {
  return rfc3339ToEpochMs(instant) > rfc3339ToEpochMs(window.end);
}

/** Whether two windows overlap (inclusive on both ends). */
export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return rfc3339ToEpochMs(a.start) <= rfc3339ToEpochMs(b.end) && rfc3339ToEpochMs(b.start) <= rfc3339ToEpochMs(a.end);
}
