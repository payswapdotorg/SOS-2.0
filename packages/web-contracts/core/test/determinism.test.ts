/**
 * Determinism tests — the same fixture always produces the same world and
 * byte-identical canonical serializations (the W11 discipline, reused via
 * @sos-2/ui-contracts' canonical helpers over the spine serializer).
 */

import { describe, expect, test } from 'vitest';
import { canonicalVMJson, vmHash } from '@sos-2/ui-contracts';
import {
  buildDemoWebWorld,
  compareDemoLeases,
  compareDemoTasks,
  currentGapOf,
  projectEvidenceQuality,
} from '../src/index.js';
import { chainFor, currentOf, demoSource, world } from './helpers.js';

describe('demo world determinism', () => {
  test('building the world twice produces identical canonical serializations', () => {
    const a = buildDemoWebWorld();
    const b = buildDemoWebWorld();
    expect(vmHash(a)).toBe(vmHash(b));
    expect(canonicalVMJson(a)).toBe(canonicalVMJson(b));
  });

  test('deterministic spine ids are stable across builds', () => {
    const a = buildDemoWebWorld();
    const b = buildDemoWebWorld();
    expect(a.missions.map((m) => m.envelope.id)).toEqual(b.missions.map((m) => m.envelope.id));
    expect(a.evidence.map((record) => record.id)).toEqual(b.evidence.map((record) => record.id));
    expect(a.experiment.artifact.envelope.id).toBe(b.experiment.artifact.envelope.id);
    expect(a.ask.request.envelope.id).toBe(b.ask.request.envelope.id);
  });

  test('no hidden clocks or randomness: fixture timestamps are the static literals', () => {
    const w = buildDemoWebWorld();
    expect(w.now).toBe('2025-06-15T12:00:00Z');
    expect(w.fixture_revision).toBe('c924e617650a243df9df7580e60d0e021fac1059');
    expect(w.tasks.every((task) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(task.updated_at))).toBe(true);
    expect(w.leases.every((lease) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(lease.granted_at))).toBe(true);
  });

  test('evidence pool is canonically ordered (sorted by id)', () => {
    const w = buildDemoWebWorld();
    const ids = w.evidence.map((record) => record.id);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});

describe('projection output stability', () => {
  test('the same projection run twice serializes identically', () => {
    const build = () => {
      const w = world();
      return projectEvidenceQuality({
        records: w.evidence,
        coverage: { present: ['telemetry', 'tests'], missing: ['model collector'] },
        rationale: chainFor(currentOf(w.system_states).envelope.id, w.links),
        data_source: demoSource(),
        uncertainty: { uncertainty_class: 'MODERATE', statement: 'x' },
        authority: { mode: 'READ_ONLY', required_permission: null, grant_ref: null, note: 'x' },
        next_allowed_action: {
          action_id: 'a', kind: 'NAVIGATE', label: 'Go', description: 'Go', href: '/evidence', rationale_ref: null, requires_authority: null,
        },
      });
    };
    expect(vmHash(build())).toBe(vmHash(build()));
  });

  test('task and lease ordering rules are total and stable', () => {
    const w = world();
    const tasks = [...w.tasks].sort(compareDemoTasks);
    expect(tasks.map((task) => task.status)).toEqual(['RUNNING', 'AWAITING_DECISION', 'PAUSED', 'QUEUED']);
    const shuffled = [...w.tasks].reverse().sort(compareDemoTasks);
    expect(shuffled.map((task) => task.task_id)).toEqual(tasks.map((task) => task.task_id));
    const leases = [...w.leases].reverse().sort(compareDemoLeases);
    expect(leases.map((lease) => lease.status)).toEqual(['ACTIVE', 'SUSPENDED']);
  });

  test('the current-gap pick is stable under input reordering', () => {
    const w = world();
    expect(currentGapOf(w.gaps)?.record_id).toBe(currentGapOf([...w.gaps].reverse())?.record_id);
  });
});
