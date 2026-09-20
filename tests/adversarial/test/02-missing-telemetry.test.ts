/**
 * ADVERSARIAL CLASS 2 — MISSING TELEMETRY (truthful UNKNOWN/UNAVAILABLE,
 * never fabricated).
 *
 * The fault: the telemetry source has NO data for a watched subject in the
 * queried window. The system must surface a truthful gap — an UNAVAILABLE
 * observation with observed: null, ingested as UNAVAILABLE evidence, never
 * folded into success or zero — and the trace chain stays queryable.
 */

import { describe, expect, test } from 'vitest';
import { InMemoryTelemetrySource } from '@sos-2/telemetry';
import type { RawObservation } from '@sos-2/telemetry';
import { EvidenceGraph, ingestObservation, summarizeAvailability } from '@sos-2/evidence';
import { assertTruthStateIs } from '@sos-2/contracts';
import { createTraceLink } from '@sos-2/semantic-spine';
import {
  ADVERSARIAL_PROVENANCE,
  T0,
  T1,
  assertTraceQueryable,
  subjectId,
  toolProducer,
} from './helpers.js';

const SUBJECT = 'otel:service:checkout';

describe('adversarial class 2: missing telemetry', () => {
  test('a watched subject with no data yields a synthesized UNAVAILABLE gap (never silence, never zero)', () => {
    const source = new InMemoryTelemetrySource({ id: 'otel:collector:adversarial-2' });
    source.watch(SUBJECT);
    const observations = source.fetch({ window: { start: T0, end: T1 } });
    // The gap is synthesized, truthfully UNAVAILABLE.
    expect(observations.length).toBe(1);
    const gap = observations[0]!;
    expect(gap.subject_ref).toBe(SUBJECT);
    expect(gap.availability).toBe('UNAVAILABLE');
    expect(gap.observed).toBeNull();
    expect(gap.attributes['gap.reason']).toBeDefined();
  });

  test('an explicitly recorded gap stays UNAVAILABLE through ingestion (verbatim truth states)', () => {
    const source = new InMemoryTelemetrySource({ id: 'otel:collector:adversarial-2b' });
    const gap = source.recordGap({
      subject: SUBJECT,
      window: { start: T0, end: T1 },
      reason: 'the collector was down for the whole window',
    });
    expect(gap.availability).toBe('UNAVAILABLE');
    expect(gap.observed).toBeNull();

    // Ingestion maps the gap onto the semantic subject VERBATIM.
    const systemStateId = subjectId('SystemState', 'adversarial-2-state');
    const record = ingestObservation({
      observation: gap,
      subject: systemStateId,
      subjectRevision: '1',
      sourceRevision: 'git:31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2',
    });
    expect(record.availability).toBe('UNAVAILABLE');
    expect(record.evidence_class).toBe('OBSERVATIONAL');
    // The distinct truth state is preserved — never conflated.
    expect(() => assertTruthStateIs('UNAVAILABLE', record.availability)).not.toThrow();
    expect(() => assertTruthStateIs('SUCCESS', record.availability)).toThrow();

    // The availability summary counts the gap honestly.
    const summary = summarizeAvailability([record]);
    expect(summary.UNAVAILABLE).toBe(1);
    expect(summary.SUCCESS).toBe(0);
    expect(summary.UNKNOWN).toBe(0);
  });

  test('a partially observed subject: covered windows return data, uncovered windows return a truthful gap', () => {
    const source = new InMemoryTelemetrySource({ id: 'otel:collector:adversarial-2c' });
    const observation: RawObservation = {
      subject_ref: SUBJECT,
      availability: 'SUCCESS',
      window: { start: T0, end: '2025-06-01T01:00:00.000Z' },
      observed: { requests: 100 },
      attributes: {},
      producer: toolProducer(),
    };
    source.push(observation);
    source.watch(SUBJECT);
    // The covered sub-window returns the stored observation — NO gap.
    const covered = source.fetch({ window: { start: T0, end: '2025-06-01T00:30:00.000Z' } });
    expect(covered.map((entry) => entry.availability)).toEqual(['SUCCESS']);
    // The UNCOVERED window (no overlapping data) returns a synthesized gap —
    // never silence, never a fabricated value.
    const uncovered = source.fetch({ window: { start: '2025-06-01T02:00:00.000Z', end: '2025-06-01T03:00:00.000Z' } });
    expect(uncovered.length).toBe(1);
    expect(uncovered[0]!.availability).toBe('UNAVAILABLE');
    expect(uncovered[0]!.observed).toBeNull();
  });

  test('the trace chain stays queryable after the missing-telemetry gap', () => {
    const source = new InMemoryTelemetrySource({ id: 'otel:collector:adversarial-2d' });
    source.watch(SUBJECT);
    const gap = source.fetch({ window: { start: T0, end: T1 } })[0]!;
    const systemStateId = subjectId('SystemState', 'adversarial-2-state-d');
    const record = ingestObservation({ observation: gap, subject: systemStateId, subjectRevision: '1' });
    const graph = new EvidenceGraph();
    const link = graph.observe(record);
    const { queryFrom, queryTo } = assertTraceQueryable([link]);
    expect(queryFrom(record.id).length).toBe(1);
    expect(queryTo(systemStateId).length).toBe(1);
    expect(graph.evidenceObserving(systemStateId).map((entry) => entry.id)).toEqual([record.id]);
    expect(graph.evidenceFor(systemStateId).length).toBe(1);
  });
});
