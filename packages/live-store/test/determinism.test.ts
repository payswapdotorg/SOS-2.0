/**
 * Determinism tests (Work Order P2 hard rules): NO Date.now / Math.random
 * / fetch / process.env anywhere in package src (clocks, sequencers and
 * providers are injected); repeated operation sequences produce identical
 * results (the twice-run gate in miniature).
 */

import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { createInMemoryLiveStore } from '../src/facade.js';
import { buildFixtureWorld, fixtureClock } from './helpers.js';

const FORBIDDEN_PATTERNS: Array<[string, RegExp]> = [
  ['Date.now(', /Date\.now\(/],
  ['Math.random(', /Math\.random\(/],
  ['fetch(', /\bfetch\(/],
  ['process.env', /process\.env/],
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('source-level determinism rules (hard)', () => {
  test('no Date.now / Math.random / fetch / process.env in live-store src', () => {
    const srcDir = join(import.meta.dirname, '..', 'src');
    const files = collectSourceFiles(srcDir);
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const [label, pattern] of FORBIDDEN_PATTERNS) {
        expect(text.includes(label) && pattern.test(text), `${file} contains forbidden ${label}`).toBe(false);
      }
    }
  });

  test('no Date.now / Math.random / fetch / process.env in api-contracts src (the dependency-free boundary)', () => {
    const srcDir = join(import.meta.dirname, '..', '..', 'api-contracts', 'src');
    for (const file of collectSourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf8');
      for (const [label, pattern] of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${file} contains forbidden ${label}`).toBe(false);
      }
    }
  });
});

describe('operational determinism', () => {
  test('the same fixture world produces byte-identical stores on repeated runs', async () => {
    async function runOnce(): Promise<string> {
      const world = buildFixtureWorld();
      const store = createInMemoryLiveStore({ clock: fixtureClock() });
      await store.mission.put(world.mission);
      await store.systemState.put(world.systemState);
      await store.evidence.put(world.evidence);
      await store.evidence.put(world.evidenceLlm);
      await store.task.put(world.task);
      await store.task.put(world.taskV2);
      await store.bodyLease.put(world.bodyLease);
      await store.events.ingest(world.events[0]!);
      await store.events.ingest(world.events[1]!);
      await store.events.ingest(world.events[2]!);
      const missions = await store.mission.list();
      const evidence = await store.evidence.list();
      const events = await store.events.list();
      return canonicalSerialize({
        missions: missions.map((record) => canonicalSerialize(record)),
        evidence: evidence.map((record) => canonicalSerialize(record)),
        events: events.map((event) => canonicalSerialize(event)),
        task: canonicalSerialize(await store.task.get(world.task.task_id)),
      });
    }

    const first = await runOnce();
    const second = await runOnce();
    expect(second).toBe(first);
  });

  test('id fixture identities are deterministic (spine content addressing)', () => {
    const first = buildFixtureWorld();
    const second = buildFixtureWorld();
    expect(second.mission.envelope.id).toBe(first.mission.envelope.id);
    expect(second.evidence.id).toBe(first.evidence.id);
    expect(second.decision.envelope.id).toBe(first.decision.envelope.id);
  });
});
