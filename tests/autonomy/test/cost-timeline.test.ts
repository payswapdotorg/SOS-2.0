/**
 * ACCEPTANCE SUITE 7 — COST ACCOUNTING + TIMELINE (Work Order P12, pinned).
 *
 * "task cost/resource accounting: every lease, retry, and recovery
 * episode appends to the task's durable cost record (evidence, never an
 * enforcement authority)" and "task timeline: a durable, replayable
 * event log per task ... derived views, never a second source of
 * truth": the timeline replay matches the observation log EXACTLY.
 */

import { describe, expect, it } from 'vitest';
import { createAutonomyWorld, seedWorld, startAcceptanceTask, FIRST_BODY, MISSED_BEAT_WINDOW_MS, verifyTranscript } from './world.js';
import { formatRfc3339 } from '@sos-2/live-store';

describe('P12 acceptance: cost accounting appends; the timeline replays as the observation log', () => {
  it('episodes append durably per lifecycle event (grant / retry / recovery) — evidence only', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-cost');
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    await world.cost.append('task-cost', 'LEASE_GRANTED', { lease_id: leaseId, body_id: FIRST_BODY });
    await world.cost.append('task-cost', 'RETRY_SCHEDULED', { attempt: 1, delay_ms: 1_000 });
    const episodes = await world.cost.episodesOf('task-cost');
    expect(episodes.length).toBe(2);
    expect(episodes[0]!.kind).toBe('LEASE_GRANTED');
    expect(episodes[1]!.kind).toBe('RETRY_SCHEDULED');
    expect(episodes[1]!.episode_id).toBe('cost:task-cost:2');

    // The episodes live in the DURABLE record's resource_usage (the section 6 field).
    const record = (await world.store.tasks.get('task-cost'))!;
    expect((record.resource_usage as { episodes: unknown[] }).episodes.length).toBe(2);

    // Accounting NEVER gates execution: the task still runs fine with a rich ledger.
    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());
    const run = await world.runtime.runProgram('task-cost', { interrupt: (index) => (index === 2 ? 'KILL' : 'CONTINUE') });
    expect(run.stop_reason).toBe('INTERRUPTED');

    // A recovery episode appends too.
    world.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-verified-crash-cost',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'verified crash for the cost suite',
    });
    const plan = await world.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-verified-crash-cost', detail: 'verified crash for the cost suite' },
    });
    world.broker.suspendBody(FIRST_BODY, 'verified crash for the cost suite');
    const recovery = await world.runtime.executeRecoveryPlan(plan, 'verified crash for the cost suite');
    expect(recovery.status).toBe('REPLACED');
    await world.cost.append('task-cost', 'RECOVERY_EXECUTED', { replacement_body: recovery.status === 'REPLACED' ? recovery.replacement_body_id : null });
    expect((await world.cost.episodesOf('task-cost')).length).toBe(3);
  });

  it('cost episodes append to EXISTING tasks only (no fabricated tasks, no silent drops)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    await expect(world.cost.append('task-never-created', 'LEASE_GRANTED', {})).rejects.toThrow(/not in the durable store/);
  });

  it('the timeline replays EXACTLY as the observation log (same events, no extras, no gaps)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-timeline');
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';
    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());

    // A journey that produces every category: task events (graph +
    // fabric), checkpoints, heartbeat verdicts, recovery, cancellation.
    await world.runtime.runProgram('task-timeline', { interrupt: (index) => (index === 2 ? 'KILL' : 'CONTINUE') });
    world.beats.forgetBody(FIRST_BODY);
    world.clock.advance(MISSED_BEAT_WINDOW_MS + 1);
    await world.supervisor.supervise(leaseId); // SUSPECTED event
    world.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-verified-crash-timeline',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'verified crash for the timeline suite',
    });
    await world.supervisor.supervise(leaseId); // LOST event
    const plan = await world.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-verified-crash-timeline', detail: 'verified crash for the timeline suite' },
    });
    const recovery = await world.runtime.executeRecoveryPlan(plan, 'verified crash for the timeline suite');
    expect(recovery.status).toBe('REPLACED');
    const resumed = await world.runtime.runProgram('task-timeline', { fromCheckpoint: 'cp-0001' });
    expect(resumed.stop_reason).toBe('COMPLETED');
    const prior = await world.runtime.completionEvidenceOf('task-timeline', 'cp-0001');
    const verification = verifyTranscript(world, 'task-timeline', [...prior, ...resumed.outcomes]);
    await world.runtime.completeTask('task-timeline', verification.record, verification.verificationId);

    const timeline = await world.timeline.replay('task-timeline');
    expect(timeline.length).toBeGreaterThan(5);

    // EXACT MATCH: every timeline entry maps to a real observation event,
    // and every concerning event appears exactly once (no extras/gaps).
    const allEvents = (await world.store.observationEvents.list({ limit: null })).items;
    const byId = new Map(allEvents.map((event) => [event.id, event]));
    const record = (await world.store.tasks.get('task-timeline'))!;
    const concerning = new Set<string>(record.observations);
    for (const event of allEvents) {
      if (event.source === 'autonomy-lease-watch' && (event.payload as Record<string, unknown>)['task_ref'] === 'task-timeline') {
        concerning.add(event.id);
      }
    }
    expect(new Set(timeline.map((entry) => entry.event_id))).toEqual(concerning);
    for (const entry of timeline) {
      expect(byId.has(entry.event_id)).toBe(true);
      expect(entry.event_id).not.toBe('');
    }
    // The categories replay: heartbeat (suspected/lost), checkpoint, recovery, task events.
    const categories = new Set(timeline.map((entry) => entry.category));
    expect(categories.has('heartbeat')).toBe(true);
    expect(categories.has('checkpoint')).toBe(true);
    // The timeline is ordered by reception time with the deterministic
    // event-id tie-break (the same comparator the replay applies).
    const keys = timeline.map((entry) => `${entry.at}|${entry.event_id}`);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});
