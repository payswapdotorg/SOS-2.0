import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  InMemoryTelemetrySource,
  convertOtelLogRecord,
  convertOtelMetricDataPoint,
  convertOtelSpan,
  rawObservationHash,
  validateRawObservation,
} from '../src/index.js';
import type { OtelLogRecord, OtelMetricDataPoint, OtelSpan, RawObservation } from '../src/index.js';
import { GOLDEN_LOG, GOLDEN_METRIC, GOLDEN_SPAN, sampleProducer } from './helpers.js';

// Deterministic property tests (seed pinned in test/setup.ts — W0.5/W1 discipline).

const serviceNameArb = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter((name) => name.trim().length > 0 && !name.includes('"'));
const nanosArb = fc.integer({ min: 0, max: 1_000_000_000_000_000 }).map((ms) => `${ms}000000`);
const truthStateArb = fc.constantFrom('SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL') as fc.Arbitrary<
  'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL'
>;
const payloadArb = fc.jsonValue();
const subjectArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((subject) => subject.trim().length > 0 && !subject.startsWith('sos://'));

const observationArb: fc.Arbitrary<RawObservation> = fc
  .record({
    subject: subjectArb,
    availability: truthStateArb,
    startMs: fc.integer({ min: 0, max: 1_000_000_000_000 }),
    durationMs: fc.integer({ min: 0, max: 86_400_000 }),
    payload: payloadArb,
  })
  .map((input) => ({
    subject_ref: input.subject,
    availability: input.availability,
    window: {
      start: new Date(input.startMs).toISOString(),
      end: new Date(input.startMs + input.durationMs).toISOString(),
    },
    observed: input.payload,
    attributes: {},
    producer: sampleProducer(),
  }));

const spanArb: fc.Arbitrary<OtelSpan> = fc
  .record({
    service: serviceNameArb,
    name: fc.string({ minLength: 1, maxLength: 24 }).filter((n) => n.trim().length > 0),
    startMs: fc.integer({ min: 0, max: 1_000_000_000_000 }),
    durationMs: fc.integer({ min: 0, max: 3_600_000 }),
    status: fc.constantFrom('UNSET', 'OK', 'ERROR') as fc.Arbitrary<'UNSET' | 'OK' | 'ERROR'>,
  })
  .map((input) => ({
    traceId: '5b8efff798038103d269b633813fc60c',
    spanId: 'eee19b7ec3ee1e0f',
    parentSpanId: null,
    name: input.name,
    kind: 'SERVER' as const,
    startTimeUnixNano: `${input.startMs}000000`,
    endTimeUnixNano: `${input.startMs + input.durationMs}000000`,
    status: { code: input.status, message: input.status === 'ERROR' ? 'boom' : null },
    attributes: {},
    resource: { attributes: { 'service.name': input.service } },
  }));

describe('telemetry property tests', () => {
  it('every generated observation validates and canonical round trips', () => {
    fc.assert(
      fc.property(observationArb, (observation) => {
        expect(validateRawObservation(observation)).toBe(true);
        const text = canonicalSerialize(observation);
        const round = JSON.parse(text) as RawObservation;
        expect(canonicalSerialize(round)).toBe(text);
        expect(round).toEqual(observation);
        return true;
      }),
    );
  });

  it('observation hashes are deterministic and injective across mutations', () => {
    fc.assert(
      fc.property(observationArb, truthStateArb, (observation, otherState) => {
        const base = rawObservationHash(observation);
        expect(rawObservationHash(JSON.parse(JSON.stringify(observation)) as RawObservation)).toBe(base);
        if (otherState !== observation.availability) {
          expect(rawObservationHash({ ...observation, availability: otherState })).not.toBe(base);
        }
        return true;
      }),
    );
  });

  it('OTel span conversion is deterministic and availability-distinct', () => {
    fc.assert(
      fc.property(spanArb, (span) => {
        const first = convertOtelSpan(span);
        const second = convertOtelSpan(JSON.parse(JSON.stringify(span)) as OtelSpan);
        expect(second).toEqual(first);
        expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));
        const expected = span.status.code === 'ERROR' ? 'FAILURE' : span.status.code === 'OK' ? 'SUCCESS' : 'UNKNOWN';
        expect(first.availability).toBe(expected);
        expect(first.subject_ref).toBe(`otel:service:${span.resource.attributes['service.name']}`);
        return true;
      }),
    );
  });

  it('in-memory sources: fetch is deterministic under randomized pushes and queries', () => {
    fc.assert(
      fc.property(fc.array(observationArb, { minLength: 0, maxLength: 10 }), fc.option(subjectArb, { nil: undefined }), (observations, subject) => {
        const source = new InMemoryTelemetrySource({ id: 'src' });
        for (const observation of observations) {
          source.push(observation);
        }
        const query = subject === undefined ? {} : { subject };
        const first = source.fetch(query);
        const second = source.fetch(query);
        expect(second).toEqual(first);
        const expected = observations.filter((observation) => subject === undefined || observation.subject_ref === subject);
        expect(first).toEqual(expected);
        return true;
      }),
    );
  });

  it('gap synthesis is deterministic: same watched subject + window, same gap observation', () => {
    fc.assert(
      fc.property(subjectArb, fc.integer({ min: 0, max: 1_000_000_000_000 }), (subject, startMs) => {
        const window = { start: new Date(startMs).toISOString(), end: new Date(startMs + 3_600_000).toISOString() };
        const make = () => {
          const source = new InMemoryTelemetrySource({ id: 'src' });
          source.watch(subject);
          return source.fetch({ subject, window });
        };
        const first = make();
        const second = make();
        expect(second).toEqual(first);
        expect(first).toHaveLength(1);
        expect(first[0]!.availability).toBe('UNAVAILABLE');
        return true;
      }),
    );
  });

  it('OTel metric and log conversions stay valid observations under randomization', () => {
    fc.assert(
      fc.property(
        serviceNameArb,
        fc.integer({ min: 0, max: 1_000_000_000_000 }),
        fc.integer({ min: 1, max: 24 }),
        (service, startMs, severity) => {
          const metric: OtelMetricDataPoint = {
            ...GOLDEN_METRIC,
            timeUnixNano: `${startMs}000000`,
            resource: { attributes: { 'service.name': service } },
          };
          const log: OtelLogRecord = {
            ...GOLDEN_LOG,
            severityNumber: severity,
            timeUnixNano: `${startMs}000000`,
            resource: { attributes: { 'service.name': service } },
          };
          const metricObservation = convertOtelMetricDataPoint(metric);
          const logObservation = convertOtelLogRecord(log);
          expect(validateRawObservation(metricObservation)).toBe(true);
          expect(validateRawObservation(logObservation)).toBe(true);
          expect(metricObservation.availability).toBe('SUCCESS');
          expect(logObservation.availability).toBe(severity >= 17 ? 'FAILURE' : 'UNKNOWN');
          expect(metricObservation.subject_ref).toBe(`otel:service:${service}`);
          expect(logObservation.subject_ref).toBe(`otel:service:${service}`);
          return true;
        },
      ),
    );
  });
});
