import { describe, expect, it } from 'vitest';
import {
  InMemoryTelemetrySource,
  assertValidOtelLogRecord,
  assertValidOtelMetricDataPoint,
  assertValidOtelSpan,
  assertValidRawObservation,
  convertOtelLogRecord,
  convertOtelMetricDataPoint,
  convertOtelSpan,
  nanosToRfc3339,
  validateRawObservation,
} from '../src/index.js';
import type { OtelLogRecord, OtelMetricDataPoint, OtelSpan, RawObservation } from '../src/index.js';
import { GOLDEN_LOG, GOLDEN_METRIC, GOLDEN_SPAN, W0, W1, sampleObservation, sampleProducer } from './helpers.js';

describe('OTel validation (negative)', () => {
  it('rejects spans missing service.name (subject unknowable -> loud failure)', () => {
    const span: OtelSpan = { ...GOLDEN_SPAN, resource: { attributes: { 'telemetry.sdk.version': '1.9.1' } } };
    expect(() => convertOtelSpan(span)).toThrow(/service\.name/);
    expect(() => assertValidOtelSpan(span)).toThrow(/service\.name/);
  });

  it('rejects malformed trace/span ids', () => {
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, traceId: 'XYZ' })).toThrow(/traceId/);
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, spanId: 'eee19b7ec3ee1e0' })).toThrow(/spanId/);
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, parentSpanId: 'nope' })).toThrow(/parentSpanId/);
  });

  it('rejects invalid span kinds, statuses and names', () => {
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, kind: 'MAGIC' as never })).toThrow(/span kind/);
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, name: '' })).toThrow(/name/);
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, status: { code: 'MAYBE' as never } })).toThrow(/status code/);
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, status: { code: 'ERROR', message: '' } })).toThrow(/status message/);
  });

  it('rejects spans whose end precedes start', () => {
    expect(() =>
      assertValidOtelSpan({ ...GOLDEN_SPAN, startTimeUnixNano: '1735689600150000456', endTimeUnixNano: '1735689600000000123' }),
    ).toThrow(/must not precede/);
  });

  it('rejects malformed unix nanos', () => {
    expect(() => nanosToRfc3339('abc')).toThrow(/unix-nanoseconds/);
    expect(() => nanosToRfc3339('-1')).toThrow(/unix-nanoseconds/);
    expect(() => nanosToRfc3339('12345678901234567890123')).toThrow(/unix-nanoseconds/);
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, startTimeUnixNano: 1735689600000000123 as never })).toThrow(
      /startTimeUnixNano/,
    );
  });

  it('rejects non-finite metric values and bad metric kinds', () => {
    expect(() => assertValidOtelMetricDataPoint({ ...GOLDEN_METRIC, value: Number.NaN })).toThrow(/finite number/);
    expect(() => assertValidOtelMetricDataPoint({ ...GOLDEN_METRIC, metricKind: 'COUNTER' as never })).toThrow(/metricKind/);
    expect(() => assertValidOtelMetricDataPoint({ ...GOLDEN_METRIC, metricName: '' })).toThrow(/metricName/);
  });

  it('rejects invalid log severities and bodies', () => {
    expect(() => assertValidOtelLogRecord({ ...GOLDEN_LOG, severityNumber: 0 })).toThrow(/severityNumber/);
    expect(() => assertValidOtelLogRecord({ ...GOLDEN_LOG, severityNumber: 25 })).toThrow(/severityNumber/);
    expect(() => assertValidOtelLogRecord({ ...GOLDEN_LOG, severityNumber: 9.5 })).toThrow(/severityNumber/);
    expect(() => assertValidOtelLogRecord({ ...GOLDEN_LOG, severityText: '' })).toThrow(/severityText/);
    expect(() => assertValidOtelLogRecord({ ...GOLDEN_LOG, body: '' })).toThrow(/body/);
  });

  it('rejects non-OTel attribute values (NaN, nested objects, undefined)', () => {
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, attributes: { bad: Number.NaN } as never })).toThrow(/attribute value/);
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, attributes: { bad: { nested: true } } as never })).toThrow(/attribute value/);
    expect(() => convertOtelLogRecord({ ...GOLDEN_LOG, attributes: { bad: undefined } as never })).toThrow(/attribute value/);
  });

  it('rejects conversion input that is not an object', () => {
    expect(() => convertOtelSpan(null as never)).toThrow(/must be an object/);
    expect(() => convertOtelMetricDataPoint('x' as never)).toThrow(/must be an object/);
    expect(() => convertOtelLogRecord(42 as never)).toThrow(/must be an object/);
  });
});

describe('raw observation validation (negative)', () => {
  it('rejects wrong field sets and empty subject refs', () => {
    const observation = sampleObservation('otel:service:checkout');
    expect(() => assertValidRawObservation(null)).toThrow(/must be an object/);
    expect(() => assertValidRawObservation({ ...observation, extra: 1 })).toThrow(/exact field set/);
    expect(() => assertValidRawObservation({ ...observation, subject_ref: '' })).toThrow(/subject_ref/);
    const { subject_ref, ...withoutSubject } = observation;
    expect(() => assertValidRawObservation(withoutSubject)).toThrow(/exact field set/);
    expect(subject_ref).toBeDefined();
  });

  it('rejects invalid truth states (the 6 states are frozen, imported from the spine)', () => {
    expect(() => assertValidRawObservation({ ...sampleObservation('s'), availability: 'MAYBE' as never })).toThrow(
      /6 distinct evidence truth states/,
    );
    expect(() => assertValidRawObservation({ ...sampleObservation('s'), availability: 'OK' as never })).toThrow(
      /6 distinct evidence truth states/,
    );
  });

  it('rejects invalid windows and non-JSON payloads', () => {
    expect(() => assertValidRawObservation({ ...sampleObservation('s'), window: { start: W1.end, end: W1.start } })).toThrow(
      /window is invalid/,
    );
    expect(() => assertValidRawObservation({ ...sampleObservation('s'), observed: undefined })).toThrow(/observed/);
    expect(() => assertValidRawObservation({ ...sampleObservation('s'), observed: { bad: () => 1 } as never })).toThrow(/observed/);
    expect(() => assertValidRawObservation({ ...sampleObservation('s'), attributes: { '': 1 } })).toThrow(/attributes keys/);
    expect(() => assertValidRawObservation({ ...sampleObservation('s'), attributes: [1, 2] as never })).toThrow(/plain JSON object/);
  });

  it('rejects invalid producers', () => {
    expect(() => assertValidRawObservation({ ...sampleObservation('s'), producer: { ...sampleProducer(), tool: '' } })).toThrow(
      /producer is invalid/,
    );
    expect(() => assertValidRawObservation({ ...sampleObservation('s'), producer: { ...sampleProducer(), model_version: '1' } })).toThrow(
      /producer is invalid/,
    );
    expect(validateRawObservation({ ...sampleObservation('s'), producer: null as never })).toBe(false);
  });
});

describe('in-memory source (negative)', () => {
  it('rejects invalid source ids and inits', () => {
    expect(() => new InMemoryTelemetrySource({ id: '' })).toThrow(/id must be a non-empty string/);
    expect(() => new InMemoryTelemetrySource(null as never)).toThrow(/init must be an object/);
    expect(() => new InMemoryTelemetrySource({ id: 'x', description: '' })).toThrow(/description/);
  });

  it('rejects pushing invalid observations', () => {
    const source = new InMemoryTelemetrySource({ id: 'src' });
    expect(() => source.push({ ...sampleObservation('s'), availability: 'NOPE' as never })).toThrow(/truth states/);
    expect(source.size).toBe(0);
  });

  it('rejects pushing observations for subjects declared unsupported', () => {
    const source = new InMemoryTelemetrySource({ id: 'src', unsupported: ['otel:service:legacy'] });
    expect(() => source.push(sampleObservation('otel:service:legacy'))).toThrow(/unsupported/);
  });

  it('rejects invalid gaps, watches and query filters', () => {
    const source = new InMemoryTelemetrySource({ id: 'src' });
    expect(() => source.recordGap({ subject: '', window: W0 })).toThrow(/gap subject/);
    expect(() => source.recordGap({ subject: 's', window: W0, reason: '' })).toThrow(/gap reason/);
    expect(() => source.watch('')).toThrow(/watched subject/);
    expect(() => source.fetch({ subject: '' })).toThrow(/query subject/);
    expect(() => source.fetch({ window: { start: W1.end, end: W1.start } })).toThrow(/query window is invalid/);
    expect(() => source.fetch({ window: { start: 'nope', end: W1.start } as never })).toThrow(/query window is invalid/);
  });

  it('rejects non-function subscribe listeners', () => {
    const source = new InMemoryTelemetrySource({ id: 'src' });
    expect(() => source.subscribe('not-a-function' as never)).toThrow(/listener must be a function/);
  });

  it('rejects invalid unsupported declarations in the constructor', () => {
    expect(() => new InMemoryTelemetrySource({ id: 'src', unsupported: [''] })).toThrow(/unsupported subjects/);
    expect(() => new InMemoryTelemetrySource({ id: 'src', producer: { ...sampleProducer(), tool: '' } })).toThrow(/producer is invalid/);
  });
});

describe('gap discipline (negative — a gap is never silence)', () => {
  it('a gap observation is UNAVAILABLE with a null payload — never SUCCESS, never zero', () => {
    const source = new InMemoryTelemetrySource({ id: 'src' });
    source.watch('otel:service:checkout');
    const results = source.fetch({ subject: 'otel:service:checkout', window: W0 });
    expect(results).toHaveLength(1);
    expect(results[0]!.availability).toBe('UNAVAILABLE');
    expect(results[0]!.observed).toBeNull();
    expect((results[0]!.attributes as Record<string, string>)['gap.reason']).toBe('no data in window');
  });

  it('UNSUPPORTED subjects surface UNSUPPORTED (distinct from a gap), not UNAVAILABLE', () => {
    const source = new InMemoryTelemetrySource({ id: 'src', unsupported: ['otel:service:legacy'] });
    source.watch('otel:service:legacy');
    const results = source.fetch({ subject: 'otel:service:legacy', window: W0 });
    expect(results).toHaveLength(1);
    expect(results[0]!.availability).toBe('UNSUPPORTED');
    expect(results[0]!.availability).not.toBe('UNAVAILABLE');
  });
});
