/**
 * Unit tests: the MAP-Elites Quality-Diversity repertoire.
 */

import { describe, expect, it } from 'vitest';
import { MapElitesArchive, binIndex, cellOf } from '../src/index.js';
import type { InsertOutcome } from '../src/index.js';
import { TWO_AXIS_SPEC, elite } from './helpers.js';

describe('binIndex / cellOf', () => {
  it('bins values below the first edge into 0 and above the last into edges.length', () => {
    expect(binIndex(-1, [50, 100])).toBe(0);
    expect(binIndex(50, [50, 100])).toBe(1);
    expect(binIndex(99.9, [50, 100])).toBe(1);
    expect(binIndex(100, [50, 100])).toBe(2);
    expect(binIndex(1000, [50, 100])).toBe(2);
  });

  it('computes the cell tuple over all spec axes', () => {
    expect(cellOf(TWO_AXIS_SPEC, { latency_ms: 10, monthly_cost: 20 })).toEqual([0, 0]);
    expect(cellOf(TWO_AXIS_SPEC, { latency_ms: 75, monthly_cost: 300 })).toEqual([1, 1]);
    expect(cellOf(TWO_AXIS_SPEC, { latency_ms: 500, monthly_cost: 9999 })).toEqual([2, 2]);
  });
});

describe('MapElitesArchive deterministic updates', () => {
  it('inserts the first candidate of a cell as its elite', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    expect(archive.insert(elite('a', 'edge-cache', 0.8, { latency_ms: 10, monthly_cost: 20 }))).toBe<InsertOutcome>('NEW_CELL');
    expect(archive.size).toBe(1);
  });

  it('replaces the elite on strictly higher fitness (IMPROVED)', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    archive.insert(elite('a', 'edge-cache', 0.8, { latency_ms: 10, monthly_cost: 20 }));
    expect(archive.insert(elite('b', 'edge-cache', 0.9, { latency_ms: 12, monthly_cost: 22 }))).toBe<InsertOutcome>('IMPROVED');
    expect(archive.elites()).toHaveLength(1);
    expect(archive.elites()[0]!.family).toBe('edge-cache');
    expect(archive.get([0, 0])!.fitness).toBe(0.9);
  });

  it('retains the elite on lower fitness (RETAINED — the loser is kept NOWHERE)', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    archive.insert(elite('a', 'edge-cache', 0.9, { latency_ms: 10, monthly_cost: 20 }));
    expect(archive.insert(elite('b', 'edge-cache', 0.5, { latency_ms: 12, monthly_cost: 22 }))).toBe<InsertOutcome>('RETAINED');
    expect(archive.get([0, 0])!.fitness).toBe(0.9);
  });

  it('resolves equal fitness by canonical id (TIE_REPLACED — keeps the archive confluent)', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    const late = { ...elite('zzz', 'edge-cache', 0.8, { latency_ms: 10, monthly_cost: 20 }), id: 'zzz' };
    const early = { ...elite('aaa', 'edge-cache', 0.8, { latency_ms: 11, monthly_cost: 21 }), id: 'aaa' };
    expect(archive.insert(late)).toBe<InsertOutcome>('NEW_CELL');
    expect(archive.insert(early)).toBe<InsertOutcome>('TIE_REPLACED');
    // 'aaa' wins the tie by canonical order; the losing id is gone — one id, one cell.
    expect(archive.get([0, 0])!.id).toBe('aaa');
    // Re-inserting the loser is RETAINED (it loses the same contest again).
    expect(archive.insert(late)).toBe<InsertOutcome>('RETAINED');
    expect(archive.get([0, 0])!.id).toBe('aaa');
  });

  it('is order-independent: the same set in any insertion order yields the same archive', () => {
    const candidates = [
      elite('a', 'edge-cache', 0.8, { latency_ms: 10, monthly_cost: 20 }),
      elite('b', 'edge-cache', 0.9, { latency_ms: 12, monthly_cost: 22 }),
      elite('c', 'durable-queue', 0.7, { latency_ms: 500, monthly_cost: 800 }),
      elite('d', 'privacy-local', 0.6, { latency_ms: 20, monthly_cost: 2000 }),
    ];
    const forward = new MapElitesArchive(TWO_AXIS_SPEC);
    for (const candidate of candidates) {
      forward.insert(candidate);
    }
    const backward = new MapElitesArchive(TWO_AXIS_SPEC);
    for (const candidate of [...candidates].reverse()) {
      backward.insert(candidate);
    }
    expect(backward.snapshot()).toEqual(forward.snapshot());
  });

  it('RETAINS materially different families in their own cells — a dominant family never collapses the repertoire', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    archive.insert(elite('edge-best', 'edge-cache', 0.99, { latency_ms: 10, monthly_cost: 20 }));
    archive.insert(elite('durable-ok', 'durable-queue', 0.4, { latency_ms: 500, monthly_cost: 800 }));
    archive.insert(elite('privacy-ok', 'privacy-local', 0.3, { latency_ms: 20, monthly_cost: 2000 }));
    // The edge-cache elite has the globally highest fitness, yet all three
    // families survive — different behavior, different cells.
    expect(archive.families()).toEqual(['durable-queue', 'edge-cache', 'privacy-local']);
    expect(archive.size).toBe(3);
    expect(archive.get([0, 0])!.family).toBe('edge-cache');
    expect(archive.get([2, 2])!.family).toBe('durable-queue');
    expect(archive.get([0, 2])!.family).toBe('privacy-local');
  });

  it('preserves elite uncertainty verbatim in the archive (never fitness alone)', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    archive.insert(
      elite('cal', 'edge-cache', 0.8, { latency_ms: 10, monthly_cost: 20 }, {
        uncertainty_class: 'STRONG',
        sample_size: 30,
        calibrated_probability: 0.9,
        calibration_ref: 'sos://Evaluation/' + 'a'.repeat(32),
      }),
    );
    const stored = archive.get([0, 0])!;
    expect(stored.uncertainty.uncertainty_class).toBe('STRONG');
    expect(stored.uncertainty.sample_size).toBe(30);
    expect(stored.uncertainty.calibrated_probability).toBe(0.9);
  });

  it('snapshot/restore round trips exactly', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    archive.insert(elite('a', 'edge-cache', 0.8, { latency_ms: 10, monthly_cost: 20 }));
    archive.insert(elite('b', 'durable-queue', 0.7, { latency_ms: 500, monthly_cost: 800 }));
    const restored = MapElitesArchive.restore(archive.snapshot());
    expect(restored.snapshot()).toEqual(archive.snapshot());
    expect(restored.size).toBe(archive.size);
    // The restored archive keeps accepting updates.
    expect(restored.insert(elite('c', 'privacy-local', 0.5, { latency_ms: 20, monthly_cost: 2000 }))).toBe('NEW_CELL');
  });

  it('cellsWithElites lists cells in lexicographic order (deterministic)', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    archive.insert(elite('c', 'f3', 0.5, { latency_ms: 500, monthly_cost: 800 }));
    archive.insert(elite('a', 'f1', 0.8, { latency_ms: 10, monthly_cost: 20 }));
    archive.insert(elite('b', 'f2', 0.6, { latency_ms: 75, monthly_cost: 300 }));
    const cells = archive.cellsWithElites().map((entry) => entry.cell);
    expect(cells).toEqual([[0, 0], [1, 1], [2, 2]]);
  });
});
