/**
 * ACCEPTANCE SUITE 2 — MISSION/AUTHORITY REFERENCES (Work Order P6,
 * pinned).
 *
 * "every task has mission and authority references" — scan-pinned across
 * EVERY journey fixture: every node view, every durable P2 TaskRecord,
 * every assignment handoff and every observation event the graph emits
 * carries both references.
 */

import { describe, expect, it } from 'vitest';
import { createAcceptanceWorld, runJourney, startJourney } from './acceptance-world.js';

describe('P6 acceptance: mission + authority references on every task', () => {
  it('every task node in the completed journey carries BOTH references', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    const report = await runJourney(world);
    expect(report.tasks.length).toBe(3);
    const nodes = await world.graph.nodes();
    for (const node of nodes) {
      expect(node.mission_ref).toBe(world.mission.envelope.id);
      expect(node.authority_ref).toBe(world.grant.envelope.id);
    }
  });

  it('every durable P2 TaskRecord carries both references natively (scan-pinned)', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    await runJourney(world);
    const listed = await world.store.tasks.list({ limit: null });
    expect(listed.items.length).toBe(3);
    for (const record of listed.items) {
      expect(record.mission_ref).toBe(world.mission.envelope.id);
      expect(record.authority_context.grant_refs).toEqual([world.grant.envelope.id]);
    }
  });

  it('every observation event the graph emits carries both references (traceability)', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    await runJourney(world);
    const events = await world.store.observationEvents.list({ limit: null });
    const graphEvents = events.items.filter((event) => event.source === 'task-graph');
    expect(graphEvents.length).toBeGreaterThan(0);
    for (const event of graphEvents) {
      const payload = event.payload as Record<string, unknown>;
      expect(payload['mission_ref']).toBe(world.mission.envelope.id);
      expect(payload['authority_ref']).toBe(world.grant.envelope.id);
    }
  });

  it('a node input WITHOUT either reference is a typed rejection (no task exists outside mission+authority)', async () => {
    const world = createAcceptanceWorld();
    await expect(
      world.graph.addNode({
        task_id: 'task-orphan',
        mission_ref: 'checkout-mission-string',
        authority_ref: world.grant.envelope.id,
        title: 'Orphan',
        owned_paths: ['work/orphan'],
        steps: { steps: [] },
      }),
    ).rejects.toThrow(/mission_ref/);
    await expect(
      world.graph.addNode({
        task_id: 'task-orphan',
        mission_ref: world.mission.envelope.id,
        authority_ref: 'self-claimed-authority',
        title: 'Orphan',
        owned_paths: ['work/orphan'],
        steps: { steps: [] },
      }),
    ).rejects.toThrow(/authority_ref/);
  });
});
