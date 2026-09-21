/**
 * Determinism + live-read discipline: the same fixture ALWAYS produces the
 * same world, the same seeded store, the same read and the same view
 * models — byte-identical canonical serializations; the reads go through
 * the live-store repositories (verbatim round-trips, typed results).
 */

import { describe, expect, test } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  buildDemoEcologyWorld,
  createDemoEcologyLiveStore,
  DEMO_ECOLOGY_STORE_REF,
  readEcologyLiveState,
} from '../src/index.js';

describe('fixture determinism', () => {
  test('the demo ecology world builds identically twice', () => {
    const a = buildDemoEcologyWorld();
    const b = buildDemoEcologyWorld();
    expect(canonicalSerialize(a)).toBe(canonicalSerialize(b));
  });
});

describe('live-read discipline (through the repositories)', () => {
  test('seeding + reading is deterministic: two seeded stores read identically', async () => {
    const world = buildDemoEcologyWorld();
    const readA = await readEcologyLiveState(await createDemoEcologyLiveStore(world), {
      store_ref: DEMO_ECOLOGY_STORE_REF,
      as_of: world.now,
    });
    const readB = await readEcologyLiveState(await createDemoEcologyLiveStore(world), {
      store_ref: DEMO_ECOLOGY_STORE_REF,
      as_of: world.now,
    });
    expect(canonicalSerialize(readA)).toBe(canonicalSerialize(readB));
  });

  test('records round-trip VERBATIM through the repositories (no re-minting, no rewriting)', async () => {
    const world = buildDemoEcologyWorld();
    const read = await readEcologyLiveState(await createDemoEcologyLiveStore(world), {
      store_ref: DEMO_ECOLOGY_STORE_REF,
      as_of: world.now,
    });
    for (const pkg of [...world.packages, world.meta_strategy_package]) {
      const stored = read.packages.find((candidate) => candidate.envelope.id === pkg.envelope.id);
      expect(stored).toBeDefined();
      expect(canonicalSerialize(stored)).toBe(canonicalSerialize(pkg));
    }
    expect(canonicalSerialize(read.memories[0])).toBe(canonicalSerialize(world.failure_memory));
    expect(canonicalSerialize(read.development_state[0])).toBe(canonicalSerialize(world.development_state));
    expect(canonicalSerialize(read.hypotheses[0])).toBe(canonicalSerialize(world.hypothesis));
  });

  test('the read reports every family it touched with honest counts', async () => {
    const world = buildDemoEcologyWorld();
    const read = await readEcologyLiveState(await createDemoEcologyLiveStore(world), {
      store_ref: DEMO_ECOLOGY_STORE_REF,
      as_of: world.now,
    });
    const counts = new Map(read.families_read.map((entry) => [entry.family, entry.count]));
    expect(counts.get('packages')).toBe(5);
    expect(counts.get('history.memories')).toBe(1);
    expect(counts.get('history.hypotheses')).toBe(1);
    expect(counts.get('developmentState')).toBe(1);
    expect(counts.get('evidence')).toBe(20);
    // Honest empty families stay visible in the read result:
    expect(counts.get('architecture')).toBe(0);
    expect(counts.get('assurance')).toBe(0);
    expect(read.architecture).toEqual([]);
    expect(read.assurance).toEqual([]);
  });

  test('reads carry the caller-supplied provenance (no hidden clock)', async () => {
    const world = buildDemoEcologyWorld();
    const read = await readEcologyLiveState(await createDemoEcologyLiveStore(world), {
      store_ref: DEMO_ECOLOGY_STORE_REF,
      as_of: '2025-06-15T12:00:00Z',
    });
    expect(read.store_ref).toBe(DEMO_ECOLOGY_STORE_REF);
    expect(read.as_of).toBe('2025-06-15T12:00:00Z');
  });
});
