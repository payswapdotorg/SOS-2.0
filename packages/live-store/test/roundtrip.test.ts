/**
 * Round-trip preservation tests (Work Order P2): every repository stores
 * and returns records VERBATIM — semantic ids preserved (never re-minted),
 * exact revisions preserved (never rewritten), truth states and provenance
 * preserved BIT-EXACT (store -> load equality on canonical serialization),
 * deterministic listing order, deterministic cursor pagination.
 */

import { describe, expect, test } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { EnvelopedRecordPort, RevisionedRecordPort } from '../src/repositories.js';
import type { LiveStore } from '../src/facade.js';
import { createInMemoryLiveStore } from '../src/facade.js';
import { buildFixtureWorld, fixtureClock, type FixtureWorld } from './helpers.js';

describe('verbatim round-trip preservation (every repository)', () => {
  test('every record family round-trips bit-exactly on canonical serialization', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await seed(store, world);

    const cases: Array<[string, RevisionedRecordPort<unknown>, unknown]> = [
      ['mission', store.mission as unknown as RevisionedRecordPort<unknown>, world.mission],
      ['mission v2', store.mission as unknown as RevisionedRecordPort<unknown>, world.missionV2],
      ['context', store.context as unknown as RevisionedRecordPort<unknown>, world.context],
      ['system state', store.systemState as unknown as RevisionedRecordPort<unknown>, world.systemState],
      ['system state v2', store.systemState as unknown as RevisionedRecordPort<unknown>, world.systemStateV2],
      ['evidence', store.evidence as unknown as RevisionedRecordPort<unknown>, world.evidence],
      ['llm evidence', store.evidence as unknown as RevisionedRecordPort<unknown>, world.evidenceLlm],
      ['architecture graph', store.architecture as unknown as RevisionedRecordPort<unknown>, world.graph],
      ['candidate', store.candidate as unknown as RevisionedRecordPort<unknown>, world.candidate],
      ['assurance', store.assurance as unknown as RevisionedRecordPort<unknown>, world.assurance],
      ['experiment', store.experiment as unknown as RevisionedRecordPort<unknown>, world.experiment],
      ['decision', store.decision as unknown as RevisionedRecordPort<unknown>, world.decision],
      ['authority grant', store.authorityGrant as unknown as RevisionedRecordPort<unknown>, world.grant],
      ['package', store.package as unknown as RevisionedRecordPort<unknown>, world.pkg],
      ['architecture memory (history)', store.history.memory as unknown as RevisionedRecordPort<unknown>, world.memory],
      ['causal hypothesis (history)', store.history.causal as unknown as RevisionedRecordPort<unknown>, world.causal],
      ['provenance record (history)', store.history.provenance as unknown as RevisionedRecordPort<unknown>, world.provenance],
      // Mutable revision chains (task, development state) hold the LATEST
      // revision per id — forward writes replace the row (the §6 model);
      // the latest revision round-trips bit-exactly.
      ['development state (latest revision)', store.developmentState as unknown as RevisionedRecordPort<unknown>, world.developmentStateV2],
      ['task (latest revision)', store.task as unknown as RevisionedRecordPort<unknown>, world.taskV2],
      ['body lease', store.bodyLease as unknown as RevisionedRecordPort<unknown>, world.bodyLease],
    ];

    for (const [name, repository, record] of cases) {
      const id = idOf(repository, record);
      const loaded = await repository.get(id);
      expect(loaded, `${name}: record present`).toBeDefined();
      expect(canonicalSerialize(loaded), `${name}: bit-exact canonical round-trip`).toBe(canonicalSerialize(record));
    }
  });

  test('truth states and provenance are preserved bit-exact (the evidence discipline)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.evidence.put(world.evidence);
    await store.evidence.put(world.evidenceLlm);

    const loadedSuccess = await store.evidence.get(world.evidence.id);
    expect(loadedSuccess?.availability).toBe('SUCCESS');
    expect(loadedSuccess?.provenance).toEqual(world.evidence.provenance);
    expect(loadedSuccess?.source_revision).toBe(world.evidence.source_revision);
    expect(loadedSuccess?.deployment_revision).toBe(world.evidence.deployment_revision);
    expect(loadedSuccess?.llm_output).toBe(false);

    // UNKNOWN stays UNKNOWN; llm_output marks non-authoritative provenance.
    const loadedUnknown = await store.evidence.get(world.evidenceLlm.id);
    expect(loadedUnknown?.availability).toBe('UNKNOWN');
    expect(loadedUnknown?.llm_output).toBe(true);
    expect(canonicalSerialize(loadedUnknown)).toBe(canonicalSerialize(world.evidenceLlm));
  });

  test('the store returns the exact ids it was given and never re-mints', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await seed(store, world);

    expect((await store.mission.get(world.mission.envelope.id))?.envelope.id).toBe(world.mission.envelope.id);
    expect((await store.evidence.get(world.evidence.id))?.id).toBe(world.evidence.id);
    expect((await store.history.provenance.get(world.provenance.id))?.id).toBe(world.provenance.id);
    expect(await store.mission.has(world.mission.envelope.id)).toBe(true);
    expect(await store.mission.has('sos://Mission/' + 'f'.repeat(32))).toBe(false);
  });

  test('listing order is deterministic (sorted by record id) across repeated queries', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await seed(store, world);

    const first = await store.evidence.list();
    const second = await store.evidence.list();
    expect(first.map((record) => record.id)).toEqual([world.evidence.id, world.evidenceLlm.id].sort());
    expect(second).toEqual(first);
    expect(await store.evidence.size()).toBe(2);

    const missions = await store.mission.list();
    expect(missions.map((record) => record.envelope.id)).toEqual(
      [world.mission.envelope.id, world.missionV2.envelope.id].sort(),
    );
  });

  test('cursor pagination is deterministic and exhaustive (mission repository)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await seed(store, world);

    const collected: string[] = [];
    let afterKey: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await store.mission.listPage({ after_key: afterKey, limit: 1 });
      expect(page.total).toBe(2);
      collected.push(...page.items.map((record) => record.envelope.id));
      if (page.next_key === null) {
        break;
      }
      afterKey = page.next_key;
    }
    expect(collected).toEqual([world.mission.envelope.id, world.missionV2.envelope.id].sort());
  });

  test('revisionOf exposes the exact revision of every record family', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await seed(store, world);

    expect(store.mission.revisionOf(world.missionV2)).toBe(2);
    expect(store.systemState.revisionOf(world.systemStateV2)).toBe(2);
    expect(store.evidence.revisionOf(world.evidence)).toBe(1);
    expect(store.history.provenance.revisionOf(world.provenance)).toBe(1);
    expect(store.task.revisionOf(world.taskV2)).toBe(2);
    expect(store.bodyLease.revisionOf(world.bodyLease)).toBe(1);
    expect(store.developmentState.revisionOf(world.developmentStateV2)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function idOf(repository: RevisionedRecordPort<unknown> | EnvelopedRecordPort<unknown>, record: unknown): string {
  if (repository === undefined || record === undefined) {
    throw new Error('bad case');
  }
  const asRecord = record as { envelope?: { id: string }; id?: string; task_id?: string; lease_id?: string; state_id?: string };
  return asRecord.envelope?.id ?? asRecord.id ?? asRecord.task_id ?? asRecord.lease_id ?? asRecord.state_id ?? '';
}

export async function seed(store: LiveStore, world: FixtureWorld): Promise<void> {
  await store.mission.put(world.mission);
  await store.mission.put(world.missionV2);
  await store.context.put(world.context);
  await store.systemState.put(world.systemState);
  await store.systemState.put(world.systemStateV2);
  await store.evidence.put(world.evidence);
  await store.evidence.put(world.evidenceLlm);
  await store.architecture.put(world.graph);
  await store.candidate.put(world.candidate);
  await store.assurance.put(world.assurance);
  await store.experiment.put(world.experiment);
  await store.decision.put(world.decision);
  await store.authorityGrant.put(world.grant);
  await store.package.put(world.pkg);
  await store.history.memory.put(world.memory);
  await store.history.causal.put(world.causal);
  await store.history.provenance.put(world.provenance);
  await store.developmentState.put(world.developmentState);
  await store.developmentState.put(world.developmentStateV2);
  await store.task.put(world.task);
  await store.task.put(world.taskV2);
  await store.bodyLease.put(world.bodyLease);
}
