/**
 * TelemetryIngestionAdapter tests — OTel batches in, raw observations out;
 * gaps are recorded truthfully as UNAVAILABLE.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryTelemetryIngestionAdapter } from '../src/index.js';
import type { OtelBatch } from '@sos-2/telemetry';
import { otelResource, otelSpanFixture, toolProducer, T0, T1 } from './helpers.js';

function metricFixture() {
  return {
    metricName: 'checkout.duration',
    metricKind: 'SUM' as const,
    timeUnixNano: '1735689600123000000',
    value: 42.5,
    attributes: {},
    resource: otelResource(),
  };
}

function logFixture(severityNumber = 9) {
  return {
    timeUnixNano: '1735689600123000000',
    severityNumber,
    severityText: severityNumber >= 17 ? 'ERROR' : 'INFO',
    body: 'checkout completed',
    attributes: {},
    resource: otelResource(),
  };
}

describe('InMemoryTelemetryIngestionAdapter', () => {
  it('ingests OTel batches through the merged converter (spans, metrics, logs)', () => {
    const adapter = new InMemoryTelemetryIngestionAdapter();
    const batch: OtelBatch = {
      spans: [otelSpanFixture()],
      metrics: [metricFixture()],
      logs: [logFixture()],
    };
    const observations = adapter.ingest(batch);
    expect(observations).toHaveLength(3);
    expect(observations[0]!.subject_ref).toBe('otel:service:checkout');
    expect(observations[0]!.availability).toBe('SUCCESS'); // span status OK
    expect(observations[1]!.observed).toMatchObject({ signal: 'metric', value: 42.5 });
    expect(observations[2]!.availability).toBe('UNKNOWN'); // INFO log: observed, outcome undetermined
    expect(adapter.observationCount).toBe(3);
  });

  it('preserves truth states verbatim from the converter (ERROR span -> FAILURE)', () => {
    const adapter = new InMemoryTelemetryIngestionAdapter();
    const observations = adapter.ingest({
      spans: [otelSpanFixture({ status: { code: 'ERROR', message: 'boom' } })],
    });
    expect(observations[0]!.availability).toBe('FAILURE');
  });

  it('answers subject queries in ingestion order', () => {
    const adapter = new InMemoryTelemetryIngestionAdapter();
    adapter.ingest({ spans: [otelSpanFixture()] });
    adapter.ingest({ spans: [otelSpanFixture({ resource: otelResource('billing') })] });
    adapter.ingest({ logs: [logFixture(17)] });
    expect(adapter.allObservations()).toHaveLength(3);
    expect(adapter.observationsForSubject('otel:service:checkout')).toHaveLength(2);
    expect(adapter.observationsForSubject('otel:service:billing')).toHaveLength(1);
    expect(adapter.observationsForSubject('otel:service:unknown-service')).toHaveLength(0);
  });

  it('rejects invalid subject queries loudly', () => {
    const adapter = new InMemoryTelemetryIngestionAdapter();
    expect(() => adapter.observationsForSubject('')).toThrow();
  });

  it('fails loudly on invalid OTel entries (telemetry ingestion VALIDATES)', () => {
    const adapter = new InMemoryTelemetryIngestionAdapter();
    expect(() => adapter.ingest({ spans: [otelSpanFixture({ traceId: 'xyz' })] })).toThrow();
    // A resource without service.name is rejected by the converter.
    expect(() =>
      adapter.ingest({
        spans: [otelSpanFixture({ resource: { attributes: { 'telemetry.sdk.version': '1.28.0' } } })],
      }),
    ).toThrow();
    expect(adapter.observationCount).toBe(0);
  });

  it('records gaps as UNAVAILABLE observations (never zero, never absence-of-failure)', () => {
    const adapter = new InMemoryTelemetryIngestionAdapter();
    const gap = adapter.recordGap({
      subject_ref: 'otel:service:checkout',
      window: { start: T0, end: T1 },
      producer: toolProducer(),
      detail: { reason: 'collector down' },
    });
    expect(gap.availability).toBe('UNAVAILABLE');
    expect(gap.observed).toEqual({ reason: 'collector down' });
    expect(gap.subject_ref).toBe('otel:service:checkout');
    // The gap is held like any other observation.
    expect(adapter.observationsForSubject('otel:service:checkout')).toEqual([gap]);
  });

  it('rejects malformed gap input', () => {
    const adapter = new InMemoryTelemetryIngestionAdapter();
    expect(() => adapter.recordGap({ subject_ref: '', window: { start: T0, end: T1 }, producer: toolProducer() })).toThrow();
    expect(() =>
      adapter.recordGap({
        subject_ref: 'otel:service:checkout',
        window: { start: T0, end: T1 },
        producer: toolProducer(),
        detail: undefined,
      }),
    ).not.toThrow();
  });

  it('exposes its contract descriptor for the semantic guard', () => {
    const adapter = new InMemoryTelemetryIngestionAdapter();
    expect(adapter.descriptor.contract).toBe('TelemetryIngestionAdapter');
    expect(adapter.descriptor.outputs).toEqual({ observation: 'RawObservation' });
  });
});
