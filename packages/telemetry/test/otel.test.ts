import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { assertValidOtelSpan, convertOtelBatch, convertOtelLogRecord, convertOtelMetricDataPoint, convertOtelSpan, nanosToRfc3339 } from '../src/index.js';
import type { OtelLogRecord, OtelMetricDataPoint, OtelSpan } from '../src/index.js';
import {
  GOLDEN_LOG,
  GOLDEN_LOG_OBSERVATION,
  GOLDEN_METRIC,
  GOLDEN_METRIC_OBSERVATION,
  GOLDEN_SPAN,
  GOLDEN_SPAN_OBSERVATION,
  sampleProducer,
} from './helpers.js';

describe('OTel adapter golden conversions (positive)', () => {
  it('converts the golden span bit-exactly (status ERROR -> FAILURE)', () => {
    const observation = convertOtelSpan(GOLDEN_SPAN);
    expect(observation).toEqual(GOLDEN_SPAN_OBSERVATION);
  });

  it('converts the golden metric datapoint bit-exactly (presence -> SUCCESS)', () => {
    const observation = convertOtelMetricDataPoint(GOLDEN_METRIC);
    expect(observation).toEqual(GOLDEN_METRIC_OBSERVATION);
  });

  it('converts the golden log record bit-exactly (severity 17 -> FAILURE)', () => {
    const observation = convertOtelLogRecord(GOLDEN_LOG);
    expect(observation).toEqual(GOLDEN_LOG_OBSERVATION);
  });

  it('conversion is deterministic: repeated conversion is identical (canonical round trip)', () => {
    for (const convert of [convertOtelSpan, convertOtelMetricDataPoint, convertOtelLogRecord] as const) {
      const input =
        convert === convertOtelSpan ? GOLDEN_SPAN : convert === convertOtelMetricDataPoint ? GOLDEN_METRIC : GOLDEN_LOG;
      const first = convert(input as never);
      const second = convert(JSON.parse(JSON.stringify(input)) as never);
      expect(second).toEqual(first);
      expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));
    }
  });

  it('converts a batch in deterministic order: spans, then metrics, then logs', () => {
    const observations = convertOtelBatch({
      spans: [GOLDEN_SPAN],
      metrics: [GOLDEN_METRIC],
      logs: [GOLDEN_LOG],
    });
    expect(observations.map((observation) => observation.observed && (observation.observed as { signal: string }).signal)).toEqual([
      'span',
      'metric',
      'log',
    ]);
    expect(observations).toEqual([GOLDEN_SPAN_OBSERVATION, GOLDEN_METRIC_OBSERVATION, GOLDEN_LOG_OBSERVATION]);
  });
});

describe('OTel availability mapping (positive — distinctness preserved)', () => {
  function spanWithStatus(code: 'UNSET' | 'OK' | 'ERROR'): OtelSpan {
    return {
      ...GOLDEN_SPAN,
      status: { code, message: code === 'ERROR' ? 'boom' : null },
    };
  }

  it('span status OK -> SUCCESS, ERROR -> FAILURE, UNSET -> UNKNOWN (unknown is NOT unavailable)', () => {
    expect(convertOtelSpan(spanWithStatus('OK')).availability).toBe('SUCCESS');
    expect(convertOtelSpan(spanWithStatus('ERROR')).availability).toBe('FAILURE');
    expect(convertOtelSpan(spanWithStatus('UNSET')).availability).toBe('UNKNOWN');
  });

  it('log severities below ERROR -> UNKNOWN; ERROR and above -> FAILURE', () => {
    function logWithSeverity(severityNumber: number): OtelLogRecord {
      return { ...GOLDEN_LOG, severityNumber, severityText: severityNumber >= 17 ? 'ERROR' : 'INFO' };
    }
    expect(convertOtelLogRecord(logWithSeverity(1)).availability).toBe('UNKNOWN');
    expect(convertOtelLogRecord(logWithSeverity(9)).availability).toBe('UNKNOWN');
    expect(convertOtelLogRecord(logWithSeverity(13)).availability).toBe('UNKNOWN');
    expect(convertOtelLogRecord(logWithSeverity(16)).availability).toBe('UNKNOWN');
    expect(convertOtelLogRecord(logWithSeverity(17)).availability).toBe('FAILURE');
    expect(convertOtelLogRecord(logWithSeverity(21)).availability).toBe('FAILURE');
  });

  it('nanosToRfc3339 is deterministic and millisecond-precise', () => {
    expect(nanosToRfc3339('1735689600000000123')).toBe('2025-01-01T00:00:00.000Z');
    expect(nanosToRfc3339('1735689600150000456')).toBe('2025-01-01T00:00:00.150Z');
    expect(nanosToRfc3339('0')).toBe('1970-01-01T00:00:00.000Z');
    expect(nanosToRfc3339('1735689600000000123')).toBe(nanosToRfc3339('1735689600000000123'));
  });
});

describe('OTel producer derivation (positive)', () => {
  it('derives environment from deployment.environment.name with fallback precedence', () => {
    const span: OtelSpan = {
      ...GOLDEN_SPAN,
      resource: {
        attributes: {
          'service.name': 'checkout',
          'service.namespace': 'fallback-namespace',
          'deployment.environment': 'old-key',
        },
      },
    };
    expect(convertOtelSpan(span).producer.environment).toBe('old-key');
    const span2: OtelSpan = {
      ...GOLDEN_SPAN,
      resource: { attributes: { 'service.name': 'checkout', 'service.namespace': 'fallback-namespace' } },
    };
    expect(convertOtelSpan(span2).producer.environment).toBe('fallback-namespace');
    const span3: OtelSpan = {
      ...GOLDEN_SPAN,
      resource: { attributes: { 'service.name': 'checkout' } },
    };
    expect(convertOtelSpan(span3).producer.environment).toBeNull();
    expect(convertOtelSpan(span3).producer.tool).toBe('opentelemetry');
  });

  it('producer is never LLM-involved for OTel adapters (models are not telemetry producers)', () => {
    expect(convertOtelSpan(GOLDEN_SPAN).producer.model).toBeNull();
    expect(convertOtelMetricDataPoint(GOLDEN_METRIC).producer.model).toBeNull();
    expect(convertOtelLogRecord(GOLDEN_LOG).producer.model).toBeNull();
    expect(sampleProducer().model).toBeNull();
  });

  it('a full-length span validation passes via assertValidOtelSpan', () => {
    expect(() => assertValidOtelSpan(GOLDEN_SPAN)).not.toThrow();
    expect(() => assertValidOtelSpan({ ...GOLDEN_SPAN, parentSpanId: '1111111111111111' })).not.toThrow();
  });
});

describe('metric payload fidelity (positive)', () => {
  it('preserves the exact metric value and attributes in the observed payload', () => {
    const point: OtelMetricDataPoint = {
      ...GOLDEN_METRIC,
      value: -0.5,
      attributes: { 'http.route': '/checkout', retry: 2 },
    };
    const observation = convertOtelMetricDataPoint(point);
    expect((observation.observed as { value: number }).value).toBe(-0.5);
    expect((observation.observed as { metric_attributes: Record<string, unknown> }).metric_attributes).toEqual({
      'http.route': '/checkout',
      retry: 2,
    });
    expect(observation.window.start).toBe(observation.window.end);
  });
});
