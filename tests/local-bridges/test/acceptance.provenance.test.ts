/**
 * ACCEPTANCE (Work Order P11): PROVENANCE LABELLING — every local
 * observation names its LOCAL SOURCE + DEVICE IDENTITY (the
 * @sos-2/telemetry provenance discipline), and SECRETS NEVER ECHO
 * (output scans across all journeys: session token values, credential
 * store values, out-of-scope private content).
 */

import { describe, expect, it } from 'vitest';
import { acceptanceWorld, localWorkOrder, pairCommand, serializedWorldSurfaces, SECRET_SESSION_TOKEN_PREFIX, SECRET_OUT_OF_SCOPE_CONTENT, T0 } from './acceptance-world.js';

describe('acceptance: local observations are provenance-labelled', () => {
  it('every local event names its source + device identity; every ingested observation preserves the labels', async () => {
    const world = acceptanceWorld();
    await world.store.authorityGrants.put(world.grant);
    world.devicePresence.setOnline(false);
    world.commandSource.push(pairCommand());
    world.commandSource.push({
      kind: 'run-work-order',
      order: localWorkOrder('task-provenance-0001', world.grant, [
        { kind: 'workspace.write', path: 'acme/src/provenance.ts', content: 'export const provenance = true;\n' },
        { kind: 'shell.exec', command: 'echo', args: ['provenance-check'], cwd: null },
        { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'provenance' } },
      ]),
    });
    await world.host.drain(); // offline: pair + queue
    world.devicePresence.setOnline(true);
    await world.host.drain(); // reconnect: reconcile + release + run

    // Every local event: source + device identity + producer label.
    const events = world.companion.eventLog.events();
    expect(events.length).toBeGreaterThan(4);
    for (const event of events) {
      expect(event.device_id).toBe('device-acceptance-0001');
      expect(event.provenance).toContain(event.source);
      expect(event.provenance).toContain('device:device-acceptance-0001');
      expect(event.provenance).toContain('producer:local-companion@1.0.0');
    }
    // The body-emitted observation through the §9 surface is labelled too.
    const bodyEvent = events.find((event) => event.kind === 'body.progress');
    expect(bodyEvent).toBeDefined();
    expect(bodyEvent?.source).toBe('local-companion:body');

    // Reconcile everything into the P2 live-store and verify the labels
    // SURVIVE ingestion verbatim (the observation-event provenance array
    // names the local source + device identity).
    await world.host.reconcile();
    const ingested = (await world.store.observationEvents.list()).items.filter((item) => item.source === 'local-companion:device-acceptance-0001');
    expect(ingested.length).toBe(events.length);
    for (const item of ingested) {
      expect(item.source).toBe('local-companion:device-acceptance-0001');
      expect(item.provenance).toContain('device:device-acceptance-0001');
      expect(item.provenance.some((label) => label.startsWith('local-companion:'))).toBe(true);
      expect(item.id.startsWith('local-companion:device-acceptance-0001:evt-')).toBe(true);
      expect(item.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    // SECRETS NEVER ECHO across every serialized surface of the journey.
    expect(serializedWorldSurfaces(world)).not.toContain(SECRET_SESSION_TOKEN_PREFIX);
    expect(JSON.stringify(events)).not.toContain(SECRET_SESSION_TOKEN_PREFIX);
    expect(JSON.stringify(ingested)).not.toContain(SECRET_SESSION_TOKEN_PREFIX);
    expect(JSON.stringify(events)).not.toContain(SECRET_OUT_OF_SCOPE_CONTENT);
    expect(JSON.stringify(ingested)).not.toContain(SECRET_OUT_OF_SCOPE_CONTENT);
    // The durable task record and its observations never carry them either.
    const task = await world.store.tasks.get('task-provenance-0001');
    expect(JSON.stringify(task)).not.toContain(SECRET_SESSION_TOKEN_PREFIX);
    expect(JSON.stringify(task)).not.toContain(SECRET_OUT_OF_SCOPE_CONTENT);
  });

  it('the provenance is deterministic for the same journey (fixed clock, fixed seed)', async () => {
    const run = async (): Promise<string> => {
      const world = acceptanceWorld();
      await world.store.authorityGrants.put(world.grant);
      world.devicePresence.setOnline(true);
      world.pair();
      await world.createTask({ task_id: 'task-determinism-0001' });
      await world.fabric.execute('task-determinism-0001', { kind: 'workspace.write', path: 'acme/src/det.ts', content: 'x' });
      await world.fabric.execute('task-determinism-0001', { kind: 'shell.exec', command: 'echo', args: ['det'], cwd: null });
      await world.host.reconcile();
      return JSON.stringify({
        events: world.companion.eventLog.events(),
        observations: (await world.store.observationEvents.list()).items,
      });
    };
    const first = await run();
    const second = await run();
    expect(first).toBe(second);
    expect(first).not.toContain(SECRET_SESSION_TOKEN_PREFIX);
    void T0;
  });
});
