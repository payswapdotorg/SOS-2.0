/**
 * THE PROVIDER OUTAGE JOURNEY (Work Order P15, lane B) — a body/reasoning
 * provider goes down mid-task; the system holds HONEST UNKNOWN/DEGRADED
 * state, re-plans when capacity returns, and NEVER silently pretends work
 * continued. Driven through the P12 composition-root exemplar
 * (apps/task-runner buildTaskRunnerHost) — every seam injected, offline.
 *
 *   - outage window open -> truthful UNAVAILABLE (the provider status view
 *     says so verbatim), the missed beat is SUSPECTED (UNKNOWN — not LOST);
 *   - NO fake progress: no checkpoint, no completion, no fabricated liveness;
 *   - bounded backoff: typed retry records, then ASK — never an infinite loop;
 *   - capacity returns -> the provider re-observes -> verified failure ->
 *     LOST -> recovery plan -> replacement -> resume -> completion;
 *   - the outage window stays VISIBLE: in the timeline (heartbeat events)
 *     and in the evidence-only cost ledger (typed episodes on the task).
 */

import { describe, expect, it } from 'vitest';
import { BackoffRetryController, InMemoryAskSink, providerStatusOf, readLedger } from '@sos-2/autonomy-runtime';
import type { StepOutcome } from '@sos-2/task-runtime';
import { buildTaskRunnerHost } from '@sos-2/task-runner';
import { ManualClock } from '@sos-2/task-runner';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { formatRfc3339 } from '@sos-2/live-store';
import { dogfoodProgram } from './world.js';

/** The outage-journey epoch: 2026-04-01T10:00:00Z. */
const OUTAGE_T0 = Date.parse('2026-04-01T10:00:00Z');

/** The provider the task-runner reference composition runs its bodies on. */
const BODY_PROVIDER = 'task-runner-reference-cloud';

/** The body the outage journey leases first. */
const OUTAGE_BODY = 'task-runner-cloud-01';

const OUTAGE_TASK_ID = 'p15b-outage-resilience';

/** The deterministic independent verifier of the outage journey (derived from the durable evidence only). */
function verifyOutcome(taskId: string, nowEpochMs: number, outcomes: readonly StepOutcome[]): { verificationId: string; record: { verified: boolean; recorded_at: string; evidence_refs: string[]; summary: string } } {
  const allOk = outcomes.every((entry) => entry.outcome === 'OK' || entry.outcome === 'CHECKPOINTED' || entry.outcome === 'RECORDED');
  const artifactSteps = outcomes.filter((entry) => entry.kind === 'operation' && entry.outcome === 'OK' && entry.output !== null);
  const digest = `${taskId}:${outcomes.length}:${artifactSteps.map((entry) => JSON.stringify(entry.output)).join('|')}`;
  return {
    verificationId: `verify:${digest.length}:${digest.slice(0, 24)}`,
    record: {
      verified: allOk && outcomes.length > 0,
      recorded_at: formatRfc3339(nowEpochMs),
      evidence_refs: artifactSteps.map((entry) => `step-${entry.index}:ok`),
      summary: `${outcomes.length} steps, ${artifactSteps.length} operations verified from the durable transcript`,
    },
  };
}

/** The outage detail the provider reports (visible in every honest surface). */
const OUTAGE_DETAIL = 'the provider reports a region-wide capacity outage affecting reference cloud bodies';

/** Assemble the outage world on the P12 composition-root exemplar. */
async function createOutageWorld(): Promise<{
  clock: ManualClock;
  host: ReturnType<typeof buildTaskRunnerHost>;
  grant: AuthorityGrantArtifact;
  mission: MissionArtifact;
}> {
  const clock = new ManualClock(OUTAGE_T0);
  const host = buildTaskRunnerHost(clock, { missedBeatWindowMs: 30_000 });

  // The durable truth: a mission + a task authority grant (the fabric gate
  // re-evaluates it at action time from this store).
  const now = clock.nowEpochMs();
  const grant: AuthorityGrantArtifact = createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(now + 86_400_000) },
    provenance: ['p15b-dogfood:outage-grant'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });
  const mission: MissionArtifact = createMission({
    content: {
      purpose: 'Survive a provider outage without fabricating progress',
      goals: [{ id: 'goal-outage-resilience', statement: 'Complete the durable task across a provider outage', status: 'PROPOSED' as const, measures: [] }],
      outcomes: [],
      stakeholders: [],
      measures: [],
      assumptions: [],
      ambiguities: [],
      constraints: [],
    },
    provenance: ['p15b-dogfood:outage-mission'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });
  await host.store.authorityGrants.put(grant);
  await host.store.missions.put(mission);
  host.authority.grant('spirit:persistent', 'body-lifecycle', '*');
  return { clock, host, grant, mission };
}

/** Start the outage-journey task on the host's first body. */
async function startOutageTask(host: ReturnType<typeof buildTaskRunnerHost>, mission: MissionArtifact, grant: AuthorityGrantArtifact) {
  return host.runtime.startTask({
    node: {
      task_id: OUTAGE_TASK_ID,
      mission_ref: mission.envelope.id,
      authority_ref: grant.envelope.id,
      title: 'Outage-resilient autonomous run',
      owned_paths: ['work/outage-resilience'],
    },
    program: dogfoodProgram(),
    body_id: OUTAGE_BODY,
    actor: { kind: 'system', id: 'spirit:persistent' },
    targetSha: '86a6921631113167f071c2f9019dddd0c1ab6447',
  });
}

describe('P15 lane-B provider outage (truthful DEGRADED/UNKNOWN, re-plan, completion)', () => {
  it('the full outage journey: down -> honest UNKNOWN -> capacity returns -> re-plan -> completion; the window stays visible', async () => {
    const { clock, host, grant, mission } = await createOutageWorld();
    const started = await startOutageTask(host, mission, grant);
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    // Healthy start.
    host.beats.beat(OUTAGE_BODY, clock.nowEpochMs());
    expect((await host.supervisor.supervise(leaseId)).state).toBe('HEALTHY');
    expect(providerStatusOf(host.outage, BODY_PROVIDER).state).toBe('AVAILABLE');

    // THE OUTAGE: the provider goes down mid-task (the run is interrupted at
    // step 5 — exactly where the capacity loss hits the body).
    const transcript = await host.runtime.runProgram(OUTAGE_TASK_ID, { interrupt: (index) => (index === 5 ? 'KILL' : 'CONTINUE') });
    expect(transcript.stop_reason).toBe('INTERRUPTED');
    const window = host.outage.open(BODY_PROVIDER, formatRfc3339(clock.nowEpochMs()), OUTAGE_DETAIL);
    expect(window.status).toBe('OPEN');

    // Honest UNAVAILABLE — the provider status says so verbatim, and the
    // composition-root surface carries it too.
    const during = providerStatusOf(host.outage, BODY_PROVIDER);
    expect(during.state).toBe('UNAVAILABLE');
    expect(during.open_window?.detail).toContain('region-wide');
    const providerEntry = host.providerStatus().find((status) => status.provider === BODY_PROVIDER);
    expect(providerEntry).toBeDefined();
    expect(providerEntry!.detail).toContain('outage window open');

    // The body stops beating: SUSPECTED — truthful UNKNOWN, never LOST,
    // never HEALTHY (no fabricated liveness).
    host.beats.forgetBody(OUTAGE_BODY);
    clock.advance(31_000);
    const suspected = await host.supervisor.supervise(leaseId);
    expect(suspected.state).toBe('SUSPECTED');
    expect(suspected.verifiedFailure).toBeNull();
    expect(suspected.detail).toContain('UNKNOWN');

    // NO fake progress during the outage: no checkpoint beyond the two the
    // interrupted segment captured, no completion, no fabricated verdict.
    const duringRecord = await host.store.tasks.get(OUTAGE_TASK_ID);
    expect(duringRecord!.status).toBe('RUNNING');
    expect(duringRecord!.checkpoints.length).toBe(2);
    expect(duringRecord!.final_verification).toBeNull();

    // The outage window is recorded as typed, evidence-only cost accounting.
    await host.cost.append(OUTAGE_TASK_ID, 'OUTAGE_WINDOW_OPENED', { provider: BODY_PROVIDER, opened_at: window.opened_at, detail: OUTAGE_DETAIL });

    // Bounded backoff while degraded: typed retry records, then ASK — the
    // system asks instead of pretending to retry forever.
    const asks = new InMemoryAskSink();
    const backoff = new BackoffRetryController({ backoffScheduleMs: [1_000, 4_000] }, OUTAGE_TASK_ID, asks);
    const first = backoff.next(formatRfc3339(clock.nowEpochMs()));
    expect(first.kind).toBe('RETRY');
    const second = backoff.next(formatRfc3339(clock.nowEpochMs()));
    expect(second.kind).toBe('RETRY');
    const third = backoff.next(formatRfc3339(clock.nowEpochMs()));
    expect(third.kind).toBe('ASK');
    expect(asks.asks.length).toBe(1);

    // CAPACITY RETURNS: the outage window closes; the provider re-observes
    // the body and attests the verified failure (the ONLY path to LOST).
    const closed = host.outage.close(BODY_PROVIDER, formatRfc3339(clock.nowEpochMs()));
    expect(closed?.status).toBe('CLOSED');
    expect(providerStatusOf(host.outage, BODY_PROVIDER).state).toBe('AVAILABLE');
    await host.cost.append(OUTAGE_TASK_ID, 'OUTAGE_WINDOW_CLOSED', { provider: BODY_PROVIDER, closed_at: closed!.closed_at });
    host.failures.record({
      bodyId: OUTAGE_BODY,
      observationId: 'obs-p15b-post-incident-verified-failure',
      observedAt: formatRfc3339(clock.nowEpochMs()),
      detail: 'the provider post-incident record attests the body crashed during the outage',
    });
    const lost = await host.supervisor.supervise(leaseId);
    expect(lost.state).toBe('LOST');
    expect(lost.verifiedFailure?.observationId).toBe('obs-p15b-post-incident-verified-failure');

    // RE-PLAN on capacity return: the recovery plan inherits identity + checkpoint.
    clock.advance(1_000);
    const plan = await host.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-p15b-post-incident-verified-failure', detail: 'the provider post-incident record attests the body crashed during the outage' },
    });
    expect(plan.task_id).toBe(OUTAGE_TASK_ID);
    expect(plan.inheritance.resume_from_checkpoint?.checkpoint_id).toBe('cp-0002');
    await host.cost.append(OUTAGE_TASK_ID, 'RECOVERY_PLANNED', { lost_lease_id: leaseId, resume_from_checkpoint: 'cp-0002' });

    // The replacement is summoned (a HEALTHY spare on the recovered provider).
    await host.broker.suspendBody(OUTAGE_BODY, 'verified body failure during the outage');
    const recovery = await host.runtime.executeRecoveryPlan(plan, 'verified body failure during the outage');
    expect(recovery.status).toBe('REPLACED');
    if (recovery.status === 'REPLACED') {
      expect(recovery.replacement_body_id).not.toBe(OUTAGE_BODY);
      expect(recovery.resume_from_checkpoint).toBe('cp-0002');
    }
    await host.cost.append(OUTAGE_TASK_ID, 'RECOVERY_EXECUTED', { replacement_body_id: recovery.status === 'REPLACED' ? recovery.replacement_body_id : OUTAGE_BODY });

    // Resume -> completion, evidence-gated by the independent verifier.
    const replacementBody = recovery.status === 'REPLACED' ? recovery.replacement_body_id : OUTAGE_BODY;
    host.beats.beat(replacementBody, clock.nowEpochMs());
    clock.advance(1_000);
    const resumed = await host.runtime.runProgram(OUTAGE_TASK_ID, { fromCheckpoint: 'cp-0002' });
    expect(resumed.stop_reason).toBe('COMPLETED');
    const prior = await host.runtime.completionEvidenceOf(OUTAGE_TASK_ID, 'cp-0002');
    const verification = verifyOutcome(OUTAGE_TASK_ID, clock.nowEpochMs(), [...prior, ...resumed.outcomes]);
    expect(verification.record.verified).toBe(true);
    clock.advance(1_000);
    await host.runtime.completeTask(OUTAGE_TASK_ID, verification.record, verification.verificationId);
    const completed = await host.store.tasks.get(OUTAGE_TASK_ID);
    expect(completed!.status).toBe('COMPLETED');
    expect(completed!.final_verification!.verified).toBe(true);

    // The outage window is VISIBLE in the evidence-only cost ledger.
    const episodes = await host.cost.episodesOf(OUTAGE_TASK_ID);
    const kinds = episodes.map((episode) => episode.kind);
    expect(kinds).toContain('OUTAGE_WINDOW_OPENED');
    expect(kinds).toContain('OUTAGE_WINDOW_CLOSED');
    expect(kinds).toContain('RECOVERY_PLANNED');
    expect(kinds).toContain('RECOVERY_EXECUTED');
    const opened = episodes.find((episode) => episode.kind === 'OUTAGE_WINDOW_OPENED');
    expect(JSON.stringify(opened!.detail)).toContain(OUTAGE_DETAIL);
    const ledger = readLedger(completed!);
    expect(ledger.episodes.length).toBe(episodes.length);

    // And in the timeline: the heartbeat UNKNOWN (suspected) precedes LOST,
    // which precedes the durable completion event — the outage left a trace.
    const timeline = await host.timeline.replay(OUTAGE_TASK_ID);
    const categories = new Set(timeline.map((entry) => entry.category));
    expect(categories.has('heartbeat')).toBe(true);
    const suspectedIndex = timeline.findIndex((entry) => entry.detail.includes('lease.suspected'));
    const lostIndex = timeline.findIndex((entry) => entry.detail.includes('lease.lost'));
    const completionIndex = timeline.findIndex((entry) => entry.detail.includes('task.completed'));
    expect(suspectedIndex).toBeGreaterThan(-1);
    expect(lostIndex).toBeGreaterThan(suspectedIndex);
    expect(completionIndex).toBeGreaterThan(lostIndex);
    const suspectedEntries = timeline.filter((entry) => entry.detail.includes('lease.suspected'));
    for (const entry of suspectedEntries) {
      expect(entry.detail).toContain('UNKNOWN');
    }
  });

  it('an outage with NO verified failure stays SUSPECTED forever (truthful UNKNOWN — never fabricated death or liveness)', async () => {
    const { clock, host, grant, mission } = await createOutageWorld();
    const started = await startOutageTask(host, mission, grant);
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    host.beats.forgetBody(OUTAGE_BODY);
    host.outage.open(BODY_PROVIDER, formatRfc3339(clock.nowEpochMs()), OUTAGE_DETAIL);
    clock.advance(31_000);
    expect((await host.supervisor.supervise(leaseId)).state).toBe('SUSPECTED');

    // Much later, still no verification: STILL SUSPECTED (never silently LOST,
    // never HEALTHY — the state stays truthful for as long as truth is unknown).
    clock.advance(600_000);
    const still = await host.supervisor.supervise(leaseId);
    expect(still.state).toBe('SUSPECTED');
    expect(still.verifiedFailure).toBeNull();

    // And the task never fabricated progress in the meantime.
    const record = await host.store.tasks.get(OUTAGE_TASK_ID);
    expect(record!.status).toBe('RUNNING');
    expect(record!.final_verification).toBeNull();
  });
});
