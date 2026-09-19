import { describe, expect, it } from 'vitest';
import { InMemoryTelemetrySource, rawObservationHash, validateRawObservation } from '../src/index.js';
import type { RawObservation } from '../src/index.js';
import { W0, W1, sampleObservation } from './helpers.js';

describe('in-memory telemetry source (positive)', () => {
  it('pushes and fetches observations (pull-based ingest)', () => {
    const source = new InMemoryTelemetrySource({ id: 'otel:collector:prod', description: 'stub collector' });
    const a = source.push(sampleObservation('otel:service:checkout'));
    const b = source.push(sampleObservation('sos://SystemState/00000000000000000000000000000001'));
    expect(source.size).toBe(2);
    expect(source.fetch()).toEqual([a, b]);
    expect(source.id).toBe('otel:collector:prod');
    expect(source.description).toBe('stub collector');
  });

  it('streams pushed observations to subscribers (push-based ingest)', () => {
    const source = new InMemoryTelemetrySource({ id: 'src' });
    const seen: RawObservation[] = [];
    const unsubscribe = source.subscribe((observation) => seen.push(observation));
    const pushed = source.push(sampleObservation('otel:service:checkout'));
    expect(seen).toEqual([pushed]);
    unsubscribe();
    source.push(sampleObservation('otel:service:billing'));
    expect(seen).toHaveLength(1);
  });

  it('fetch filters by subject and overlapping window (inclusive bounds)', () => {
    const source = new InMemoryTelemetrySource({ id: 'src' });
    const inWindow = source.push({ ...sampleObservation('otel:service:checkout'), window: W0 });
    const later = source.push({ ...sampleObservation('otel:service:checkout'), window: W1 });
    expect(source.fetch({ subject: 'otel:service:checkout' })).toEqual([inWindow, later]);
    // Windows overlap INCLUSIVELY on both ends (windowsOverlap): later.start == W0.end,
    // so a W0-bounded query still matches `later`; and inWindow.end == W1.start, so a
    // W1-bounded query still matches `inWindow`. Adjacent windows are overlapping.
    expect(source.fetch({ subject: 'otel:service:checkout', window: W0 })).toEqual([inWindow, later]);
    expect(source.fetch({ window: W1 })).toEqual([inWindow, later]);
    // A window touching neither observation window matches nothing.
    expect(source.fetch({ window: { start: '2025-06-01T00:00:00.000Z', end: '2025-06-02T00:00:00.000Z' } })).toEqual([]);
    // Subject filtering excludes other subjects' observations (pushed last, after the
    // window assertions above, so its adjacent W0 window cannot interfere with them).
    const other = source.push({ ...sampleObservation('otel:service:billing'), window: W0 });
    expect(source.fetch({ subject: 'otel:service:billing' })).toEqual([other]);
    expect(source.fetch({ subject: 'otel:service:checkout', window: W0 })).not.toContainEqual(other);
  });

  it('fetch returns defensive copies (callers cannot mutate the store)', () => {
    const source = new InMemoryTelemetrySource({ id: 'src' });
    source.push(sampleObservation('otel:service:checkout'));
    const fetched = source.fetch()[0]!;
    fetched.availability = 'FAILURE';
    expect(source.fetch()[0]!.availability).toBe('SUCCESS');
  });

  it('records explicit gaps as UNAVAILABLE observations with the given reason', () => {
    const source = new InMemoryTelemetrySource({ id: 'src' });
    const gap = source.recordGap({ subject: 'otel:service:checkout', window: W0, reason: 'collector restart' });
    expect(gap.availability).toBe('UNAVAILABLE');
    expect(gap.observed).toBeNull();
    expect(gap.attributes).toEqual({ 'gap.reason': 'collector restart' });
    expect(source.fetch({ subject: 'otel:service:checkout', window: W0 })).toEqual([gap]);
  });

  it('auto-detects gaps for watched subjects on window-bounded fetches only', () => {
    const source = new InMemoryTelemetrySource({ id: 'src' });
    source.watch('otel:service:checkout');
    source.watch('otel:service:billing');
    const data = source.push(sampleObservation('otel:service:billing'));
    // no window -> no synthesis
    expect(source.fetch()).toEqual([data]);
    const results = source.fetch({ window: W0 });
    expect(results).toEqual([data, expect.objectContaining({ subject_ref: 'otel:service:checkout', availability: 'UNAVAILABLE' })]);
  });

  it('initial observations and unsupported subjects from init', () => {
    const source = new InMemoryTelemetrySource({
      id: 'src',
      observations: [sampleObservation('otel:service:checkout')],
      unsupported: ['otel:service:legacy'],
    });
    expect(source.size).toBe(1);
    const results = source.fetch({ subject: 'otel:service:legacy', window: W0 });
    expect(results).toHaveLength(1);
    expect(results[0]!.availability).toBe('UNSUPPORTED');
  });
});

describe('observation hashing (positive)', () => {
  it('rawObservationHash is deterministic and content-sensitive', () => {
    const a = sampleObservation('otel:service:checkout');
    const b = JSON.parse(JSON.stringify(a)) as RawObservation;
    expect(rawObservationHash(b)).toBe(rawObservationHash(a));
    const mutated = { ...a, availability: 'PARTIAL' as const };
    expect(rawObservationHash(mutated)).not.toBe(rawObservationHash(a));
    expect(rawObservationHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes reject invalid observations loudly', () => {
    expect(() => rawObservationHash({ ...sampleObservation('s'), availability: 'MAYBE' as never })).toThrow(/truth states/);
  });

  it('validateRawObservation accepts canonical round-tripped observations', () => {
    const observation = sampleObservation('otel:service:checkout');
    const round = JSON.parse(JSON.stringify(observation)) as RawObservation;
    expect(validateRawObservation(round)).toBe(true);
  });
});
