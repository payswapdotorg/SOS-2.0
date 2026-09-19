import { describe, expect, it } from 'vitest';
import { EvidenceGraph, createEvidence, ingestObservation } from '../src/index.js';
import type { EvidenceRecordW3 } from '../src/index.js';
import { rawObservationHash } from '@sos-2/telemetry';
import {
  SYSTEM_STATE_R1,
  SYSTEM_STATE_R2,
  sampleEvidenceInput,
  sampleRawObservation,
} from './helpers.js';

function makeRecord(method: string = 'telemetry:capture-availability'): EvidenceRecordW3 {
  return createEvidence({ ...sampleEvidenceInput(), method });
}

function makeRecordForSubject(subject: string): EvidenceRecordW3 {
  // Built from an INPUT (not a record spread) so the id is derived from the
  // actual content — subject changes are genuine content changes.
  return createEvidence({ ...sampleEvidenceInput(), subject_ref: subject });
}

describe('evidence graph — records (positive)', () => {
  it('puts, gets and lists evidence records deterministically (sorted by id)', () => {
    const graph = new EvidenceGraph();
    const a = graph.put(makeRecord());
    const b = graph.put(makeRecord('test-run:exit-code'));
    expect(graph.size).toBe(2);
    expect(graph.has(a.id)).toBe(true);
    expect(graph.get(a.id)).toEqual(a);
    expect(graph.list().map((record) => record.id)).toEqual([a.id, b.id].sort());
  });

  it('put is idempotent for identical content and rejects different content under the same id', () => {
    const graph = new EvidenceGraph();
    const record = makeRecord();
    expect(graph.put(record)).toEqual(record);
    expect(graph.put(JSON.parse(JSON.stringify(record)) as EvidenceRecordW3)).toEqual(record);
    expect(graph.size).toBe(1);
    const different: EvidenceRecordW3 = { ...record, kind: 'incident-report' };
    expect(() => graph.put(different)).toThrow(/collision/);
    expect(graph.size).toBe(1);
  });

  it('put validates loudly and stores defensive copies', () => {
    const graph = new EvidenceGraph();
    expect(() => graph.put({} as never)).toThrow();
    const record = makeRecord();
    const stored = graph.put(record);
    stored.availability = 'FAILURE';
    expect(graph.get(record.id)!.availability).toBe(record.availability);
    const fetched = graph.get(record.id)!;
    fetched.availability = 'PARTIAL';
    expect(graph.get(record.id)!.availability).toBe(record.availability);
  });

  it('evidenceFor answers by exact subject_ref', () => {
    const graph = new EvidenceGraph();
    const aboutR1 = graph.put(makeRecord());
    const aboutR2 = graph.put(makeRecordForSubject(SYSTEM_STATE_R2));
    expect(graph.evidenceFor(SYSTEM_STATE_R1).map((record) => record.id)).toEqual([aboutR1.id]);
    expect(graph.evidenceFor(SYSTEM_STATE_R2).map((record) => record.id)).toEqual([aboutR2.id]);
    expect(() => graph.evidenceFor('')).toThrow(/non-empty string/);
  });
});

describe('evidence graph — typed trace links (positive)', () => {
  it('links evidence to subjects through the spine\'s frozen link vocabulary', () => {
    const graph = new EvidenceGraph();
    const record = graph.put(makeRecord());
    const link = graph.link({
      source: record.id,
      target: SYSTEM_STATE_R1,
      type: 'OBSERVES',
      provenance: ['observation:sha256:' + 'a'.repeat(64)],
    });
    expect(link).toEqual({
      source: record.id,
      target: SYSTEM_STATE_R1,
      type: 'OBSERVES',
      provenance: ['observation:sha256:' + 'a'.repeat(64)],
    });
    expect(graph.linkCount).toBe(1);
    expect(graph.linksTo(SYSTEM_STATE_R1)).toEqual([link]);
    expect(graph.linksFrom(record.id)).toEqual([link]);
  });

  it('rejects links whose source is not an evidence record in the graph', () => {
    const graph = new EvidenceGraph();
    expect(() =>
      graph.link({ source: SYSTEM_STATE_R1, target: SYSTEM_STATE_R2, type: 'OBSERVES', provenance: ['x'] }),
    ).toThrow(/not an evidence record in this graph/);
  });

  it('rejects duplicate (source, target, type) links and invalid link inputs (spine discipline)', () => {
    const graph = new EvidenceGraph();
    const record = graph.put(makeRecord());
    graph.link({ source: record.id, target: SYSTEM_STATE_R1, type: 'OBSERVES', provenance: ['x'] });
    expect(() =>
      graph.link({ source: record.id, target: SYSTEM_STATE_R1, type: 'OBSERVES', provenance: ['x'] }),
    ).toThrow(/duplicate trace link rejected/);
    // The same pair with a different type is a distinct link:
    expect(() =>
      graph.link({ source: record.id, target: SYSTEM_STATE_R1, type: 'VERIFIES', provenance: ['x'] }),
    ).not.toThrow();
    expect(() =>
      graph.link({ source: record.id, target: 'not-an-id', type: 'OBSERVES', provenance: ['x'] }),
    ).toThrow(/well-formed artifact id/);
    expect(() =>
      graph.link({ source: record.id, target: SYSTEM_STATE_R1, type: 'NOT_A_TYPE' as never, provenance: ['x'] }),
    ).toThrow(/frozen types/);
    expect(() =>
      graph.link({ source: record.id, target: SYSTEM_STATE_R1, type: 'OBSERVES', provenance: [] }),
    ).toThrow(/provenance/);
  });
});

describe('evidence traceable to System State (positive — W3 acceptance)', () => {
  it('observe(): put + OBSERVES link in one step, authorized by the record\'s own provenance', () => {
    const graph = new EvidenceGraph();
    const record = makeRecord();
    const link = graph.observe(record);
    expect(link.type).toBe('OBSERVES');
    expect(link.source).toBe(record.id);
    expect(link.target).toBe(SYSTEM_STATE_R1);
    expect(link.provenance).toEqual(record.provenance);
    expect(graph.evidenceObserving(SYSTEM_STATE_R1).map((r) => r.id)).toEqual([record.id]);
  });

  it('a full telemetry → evidence → System State traceability scenario', () => {
    const graph = new EvidenceGraph();
    // 1. Telemetry produces a raw observation about a system-state subject
    //    (the evidence layer maps the native label to the spine subject id).
    const observation = sampleRawObservation('otel:service:checkout');
    // 2. Ingestion mints evidence with verbatim truth state + method provenance.
    const evidence = ingestObservation({ observation, subject: SYSTEM_STATE_R1, subjectRevision: 'r1' });
    // 3. The graph stores the evidence and links it OBSERVES the System State.
    graph.observe(evidence);
    // 4. Traceability queries answer from both directions:
    expect(graph.evidenceObserving(SYSTEM_STATE_R1).map((r) => r.id)).toEqual([evidence.id]);
    expect(graph.evidenceFor(SYSTEM_STATE_R1).map((r) => r.id)).toEqual([evidence.id]);
    const links = graph.linksTo(SYSTEM_STATE_R1);
    expect(links).toHaveLength(1);
    expect(links[0]!.type).toBe('OBSERVES');
    expect(links[0]!.provenance).toContain(`observation:sha256:${rawObservationHash(observation)}`);
  });

  it('evidenceObserving ignores non-OBSERVES links and unknown subjects', () => {
    const graph = new EvidenceGraph();
    const record = graph.put(makeRecord());
    graph.link({ source: record.id, target: SYSTEM_STATE_R1, type: 'VERIFIES', provenance: ['x'] });
    expect(graph.evidenceObserving(SYSTEM_STATE_R1)).toEqual([]);
    expect(graph.evidenceObserving(SYSTEM_STATE_R2)).toEqual([]);
  });

  it('allLinks and defensive copies', () => {
    const graph = new EvidenceGraph();
    const record = graph.put(makeRecord());
    graph.observe(record);
    const links = graph.allLinks();
    links[0]!.type = 'CONTRADICTS';
    expect(graph.allLinks()[0]!.type).toBe('OBSERVES');
    expect(() => graph.evidenceObserving('')).toThrow(/non-empty string/);
  });
});
