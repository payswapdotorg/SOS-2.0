/**
 * Shared test fixtures for @sos-2/telemetry tests.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { OtelLogRecord, OtelMetricDataPoint, OtelSpan, RawObservation } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(here, '../fixtures', name), 'utf8')) as T;
}

export const GOLDEN_SPAN: OtelSpan = readFixture<OtelSpan>('otel-span.json');
export const GOLDEN_METRIC: OtelMetricDataPoint = readFixture<OtelMetricDataPoint>('otel-metric.json');
export const GOLDEN_LOG: OtelLogRecord = readFixture<OtelLogRecord>('otel-log.json');
export const GOLDEN_SPAN_OBSERVATION: RawObservation = readFixture<RawObservation>('raw-observation-span.json');
export const GOLDEN_METRIC_OBSERVATION: RawObservation = readFixture<RawObservation>('raw-observation-metric.json');
export const GOLDEN_LOG_OBSERVATION: RawObservation = readFixture<RawObservation>('raw-observation-log.json');

export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-03T12:30:00.000Z';
export const W0 = { start: T0, end: T1 };
export const W1 = { start: T1, end: T2 };

export function sampleProducer(): {
  tool: string;
  tool_version: string | null;
  model: string | null;
  model_version: string | null;
  command: string | null;
  environment: string | null;
} {
  return {
    tool: 'otel-collector',
    tool_version: '0.90.0',
    model: null,
    model_version: null,
    command: null,
    environment: 'production',
  };
}

/** A minimal valid raw observation (unique subject per call to avoid interference). */
export function sampleObservation(subject: string): RawObservation {
  return {
    subject_ref: subject,
    availability: 'SUCCESS',
    window: { start: T0, end: T1 },
    observed: { note: 'sample' },
    attributes: { 'source.kind': 'synthetic' },
    producer: sampleProducer(),
  };
}
