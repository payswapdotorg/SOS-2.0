/**
 * THE ANOMALY -> SUMMONED BODY -> EVIDENCE -> REPAIR JOURNEY (Work Order
 * P15, lane B): an OBSERVED anomaly (CI failing on the repository head,
 * detected by the no-body observation plane) summons a body THROUGH the
 * P9 action surface (authority-gated body-lifecycle lease), the body
 * executes the repair, and the repair is EVIDENCE-GATED: completion is
 * granted only from the durable transcript by the independent verifier.
 * The timeline records every step.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_SUBJECTS } from '@sos-2/observation-host';
import {
  FIRST_BODY,
  OBSERVED_HEAD_SHA,
  RUNTIME_ACTOR,
  anomalyRepairProgram,
  ciFailureEnvelope,
  createObservationWorld,
  seedWorld,
  verifyTranscript,
} from './world.js';

const ANOMALY_TASK_ID = 'p15b-anomaly-repair';

/** Start the repair task on the observation world (the summon goes through the action surface). */
async function summonRepairBody(world: ReturnType<typeof createObservationWorld>) {
  return world.autonomy.runtime.startTask({
    node: {
      task_id: ANOMALY_TASK_ID,
      mission_ref: world.autonomy.mission.envelope.id,
      authority_ref: world.autonomy.grant.envelope.id,
      title: 'Repair the CI failure observed on the repository head',
      owned_paths: ['work/anomaly-repair'],
    },
    program: anomalyRepairProgram(),
    body_id: FIRST_BODY,
    actor: RUNTIME_ACTOR,
    targetSha: OBSERVED_HEAD_SHA,
  });
}

describe('P15 lane-B anomaly -> summoned body -> evidence -> repair', () => {
  it('the anomaly is OBSERVED with no body active (detection, not polling by an agent)', async () => {
    const world = createObservationWorld();
    await seedWorld(world.autonomy);
    const healthy = await world.plane.loop.drain();

    // Before the anomaly: no CI-failing detection, zero leases.
    expect(healthy.detections.some((detection) => detection.code === 'CI_FAILING_ON_HEAD')).toBe(false);
    expect((await world.autonomy.store.bodyLeases.list({ limit: null })).items.length).toBe(0);

    // The anomaly lands: CI fails on the observed head.
    world.sources.ci.push(ciFailureEnvelope());
    const report = await world.plane.loop.drain();

    const detection = report.detections.find((entry) => entry.code === 'CI_FAILING_ON_HEAD');
    expect(detection).toBeDefined();
    expect(detection!.kind).toBe('SHORTFALL');
    expect(detection!.subject).toBe(REFERENCE_SUBJECTS.repository);
    expect(detection!.evidenceEventIds.length).toBeGreaterThan(0);

    // STILL zero bodies: observation detects; it does not summon.
    expect((await world.autonomy.store.bodyLeases.list({ limit: null })).items.length).toBe(0);
  });

  it('the body is summoned THROUGH the action surface (P9 gateway body-lifecycle, authority-gated)', async () => {
    const world = createObservationWorld();
    await seedWorld(world.autonomy);
    await world.plane.loop.drain();
    world.sources.ci.push(ciFailureEnvelope());
    await world.plane.loop.drain();

    const evaluationsBefore = world.autonomy.authority.evaluations.length;
    const started = await summonRepairBody(world);
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    // The summon was an authority-gated gateway action (action-time re-evaluation happened).
    expect(world.autonomy.authority.evaluations.length).toBeGreaterThan(evaluationsBefore);
    for (const evaluation of world.autonomy.authority.evaluations) {
      expect(evaluation.snapshot.reason).toBe('GRANTED');
    }

    // The durable lease binds the observed head revision (the exact-revision pin).
    const lease = await world.autonomy.store.bodyLeases.get(leaseId);
    expect(lease).toBeDefined();
    expect(lease!.state).toBe('ACTIVE');
    expect(lease!.body_id).toBe(FIRST_BODY);

    // The gateway's own action log records the successful body-lifecycle action.
    const lifecycle = world.autonomy.actionEvents.entries().filter((event) => event.family === 'body-lifecycle');
    expect(lifecycle.length).toBeGreaterThan(0);
    for (const event of lifecycle) {
      expect(event.type).toBe('action.succeeded');
    }
  });

  it('the repair is EVIDENCE-GATED and the timeline records every step', async () => {
    const world = createObservationWorld();
    await seedWorld(world.autonomy);
    await world.plane.loop.drain();
    world.sources.ci.push(ciFailureEnvelope());
    await world.plane.loop.drain();

    const started = await summonRepairBody(world);
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    // The body is healthy while it works.
    world.autonomy.beats.beat(FIRST_BODY, world.autonomy.clock.nowEpochMs());
    expect((await world.autonomy.supervisor.supervise(leaseId)).state).toBe('HEALTHY');

    // The repair runs to completion (write -> checkpoint -> emit -> capture).
    const transcript = await world.autonomy.runtime.runProgram(ANOMALY_TASK_ID);
    expect(transcript.stop_reason).toBe('COMPLETED');
    expect(transcript.checkpoints.length).toBe(1);

    // EVIDENCE-GATED completion: the independent verifier derives the verdict
    // from the durable transcript (the runtime never certifies itself).
    const verification = verifyTranscript(world.autonomy, ANOMALY_TASK_ID, transcript.outcomes);
    expect(verification.record.verified).toBe(true);
    await world.autonomy.runtime.completeTask(ANOMALY_TASK_ID, verification.record, verification.verificationId);

    const record = await world.autonomy.store.tasks.get(ANOMALY_TASK_ID);
    expect(record!.status).toBe('COMPLETED');
    expect(record!.final_verification!.verified).toBe(true);
    expect(record!.final_verification!.evidence_refs.length).toBeGreaterThan(0);

    // The task node kept its semantic identity end-to-end.
    const node = await world.autonomy.graph.node(ANOMALY_TASK_ID);
    expect(node!.mission_ref).toBe(world.autonomy.mission.envelope.id);
    expect(node!.authority_ref).toBe(world.autonomy.grant.envelope.id);
    expect(node!.state).toBe('COMPLETED');
    expect(node!.verification_ref).not.toBeNull();

    // The timeline records every step: lease, checkpoint, task events and the
    // durable completion event.
    const timeline = await world.autonomy.timeline.replay(ANOMALY_TASK_ID);
    expect(timeline.length).toBeGreaterThan(0);
    const categories = new Set(timeline.map((entry) => entry.category));
    expect(categories.has('checkpoint')).toBe(true);
    expect(timeline.some((entry) => entry.detail.includes('task.completed'))).toBe(true);
    for (const entry of timeline) {
      expect(entry.event_id.length).toBeGreaterThan(0);
      expect(entry.at).toMatch(/^\d{4}-/);
    }

    // The repair emitted its own durable observation (the anomaly trace).
    const emitted = await world.autonomy.store.observationEvents.list({ limit: null });
    const repairTrace = emitted.items.filter((event) => event.kind === 'p15b.anomaly-repair.executed');
    expect(repairTrace.length).toBe(1);
    expect((repairTrace[0]!.payload as Record<string, unknown>)['anomaly']).toBe('CI_FAILING_ON_HEAD');
  });

  it('the SAME anomaly with REVOKED authority never summons a body (typed denial, nothing fabricated)', async () => {
    const world = createObservationWorld();
    await seedWorld(world.autonomy);
    await world.plane.loop.drain();
    world.sources.ci.push(ciFailureEnvelope());
    await world.plane.loop.drain();

    // Revoke the runtime actor's standing body-lifecycle grant BEFORE the summon.
    const grantId = world.autonomy.authority.grant(RUNTIME_ACTOR.id, 'body-lifecycle', '*');
    world.autonomy.authority.revoke(grantId);

    const started = await summonRepairBody(world);
    expect(started.status).toBe('DENIED');

    // Fail closed: no lease, no execution, no fabricated repair evidence.
    expect((await world.autonomy.store.bodyLeases.list({ limit: null })).items.length).toBe(0);
    const record = await world.autonomy.store.tasks.get(ANOMALY_TASK_ID);
    expect(record!.body_lease_ref).toBeNull();
    const emitted = await world.autonomy.store.observationEvents.list({ limit: null });
    expect(emitted.items.some((event) => event.kind === 'p15b.anomaly-repair.executed')).toBe(false);
  });
});
