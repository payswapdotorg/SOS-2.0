/**
 * Unit tests: the diversity archive (Work Order W13).
 */

import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { DiversityArchive, defaultDiversitySpec } from '../src/index.js';
import type { DiversityCoverageReport } from '../src/index.js';
import { COST_LATENCY_SPEC, calibratedUncertainty, costLatencyBehavior, entry } from './helpers.js';

describe('DiversityArchive — the §11-constrained QD archive', () => {
  it('accepts population entries over a §11 sub-space spec and bins them', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    const outcome = archive.insert(
      entry('durable-queue-1', 'durable-queue', 0.8, costLatencyBehavior(50, 120)),
    );
    expect(outcome).toBe('NEW_CELL');
    expect(archive.size).toBe(1);
    expect(archive.families()).toEqual(['durable-queue']);
  });

  it('accepts composition ids as population members', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    archive.insert(
      entry('composition-1', 'composed-stack', 0.9, costLatencyBehavior(500, 80), undefined, 'PackageComposition'),
    );
    expect(archive.size).toBe(1);
    expect(archive.families()).toEqual(['composed-stack']);
  });

  it('keeps materially different families in different cells (never evict each other)', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    // cheap-and-slow durable queue vs expensive-and-fast edge cache — materially different behavior
    archive.insert(entry('durable-queue-1', 'durable-queue', 0.9, costLatencyBehavior(50, 300)));
    archive.insert(entry('edge-cache-1', 'edge-cache', 0.95, costLatencyBehavior(2000, 20)));
    expect(archive.size).toBe(2);
    expect(archive.families()).toEqual(['durable-queue', 'edge-cache']);
    // a globally better entry in the durable-queue's cell cannot evict the edge cache
    archive.insert(entry('durable-queue-2', 'durable-queue', 0.99, costLatencyBehavior(60, 310)));
    expect(archive.size).toBe(2);
    expect(archive.get([0, 2])!.family).toBe('durable-queue');
    expect(archive.get([2, 0])!.family).toBe('edge-cache');
  });

  it('carries uncertainty through the archive verbatim (§12)', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    const uncertainty = calibratedUncertainty(0.72, 12);
    archive.insert(entry('calibrated-1', 'durable-queue', 0.7, costLatencyBehavior(120, 60), uncertainty));
    const elite = archive.elites()[0]!;
    expect(elite.uncertainty).toEqual(uncertainty);
  });

  it('produces deterministic canonical coverage reports', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    archive.insert(entry('a', 'durable-queue', 0.8, costLatencyBehavior(50, 300)));
    archive.insert(entry('b', 'edge-cache', 0.95, costLatencyBehavior(2000, 20)));
    const report: DiversityCoverageReport = archive.coverageReport();
    expect(report.occupied_cells).toBe(2);
    expect(report.total_cells).toBe(9); // 3 cost bins x 3 latency bins
    expect(report.occupancy_ratio).toBeCloseTo(2 / 9);
    expect(report.families).toEqual(['durable-queue', 'edge-cache']);
    expect(report.cells.map((cell) => cell.cell)).toEqual([[0, 2], [2, 0]]);
    // axes follow spec order with occupied-bin counts
    expect(report.axes.map((axis) => axis.axis)).toEqual(['cost', 'latency']);
    expect(report.axes[0]!.occupied_bins).toEqual([{ bin: 0, elites: 1 }, { bin: 2, elites: 1 }]);
    // canonical text is stable
    expect(canonicalSerialize(archive.coverageReport())).toBe(canonicalSerialize(report));
  });

  it('coverage reports over the default nine-axis spec cover all §11 axes', () => {
    const archive = new DiversityArchive(defaultDiversitySpec());
    archive.insert(
      entry('nine-axis-1', 'balanced', 0.7, {
        cost: 500,
        latency: 100,
        resilience: 3,
        privacy: 3,
        resource_footprint: 3,
        topology: 10,
        operational_complexity: 3,
        customization: 3,
        human_comprehensibility: 3,
      }),
    );
    const report = archive.coverageReport();
    expect(report.axes.map((axis) => axis.axis)).toEqual([
      'cost',
      'latency',
      'resilience',
      'privacy',
      'resource_footprint',
      'topology',
      'operational_complexity',
      'customization',
      'human_comprehensibility',
    ]);
    expect(report.total_cells).toBe(3 ** 9);
    expect(report.occupied_cells).toBe(1);
  });

  it('snapshots and restores canonically (round trip)', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    archive.insert(entry('a', 'durable-queue', 0.8, costLatencyBehavior(50, 300)));
    archive.insert(entry('b', 'edge-cache', 0.95, costLatencyBehavior(2000, 20)));
    const snapshot = archive.snapshot();
    const restored = DiversityArchive.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(canonicalSerialize(restored.coverageReport())).toBe(canonicalSerialize(archive.coverageReport()));
    expect(restored.families()).toEqual(archive.families());
  });

  it('supports the W7 repertoire update outcomes (within-cell competition only)', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    expect(archive.insert(entry('a', 'f1', 0.5, costLatencyBehavior(50, 300)))).toBe('NEW_CELL');
    expect(archive.insert(entry('b', 'f1', 0.6, costLatencyBehavior(60, 310)))).toBe('IMPROVED');
    expect(archive.insert(entry('c', 'f1', 0.6, costLatencyBehavior(70, 320)))).toBe('RETAINED');
    expect(archive.size).toBe(1);
    expect(archive.elites()[0]!.id).toBe(entry('b', 'f1', 0, costLatencyBehavior(0, 0)).id);
  });
});
