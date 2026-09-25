/**
 * LANE C, SCENARIO 00 — THE FRESH-USER FLAGSHIP ACCEPTANCE (Work Order
 * P15's headline): "A fresh user can start and complete the flagship
 * journey without developer knowledge. The resulting repository,
 * runtime, deployment and evidence graph are linked to exact revisions
 * and all unresolved uncertainty is visible."
 *
 * The journey is driven ONLY through surfaces a non-developer can reach:
 * the composed product surface (mission in plain language -> connect
 * repository -> approve authority -> watch progress -> read the
 * completion record) and the optional P11 local-companion path. Progress
 * is visible as typed records WITH EVIDENCE — never raw agent
 * transcripts — and "Done" means EVIDENCE-GATED completion.
 */

import { describe, expect, it } from 'vitest';
import { GREENFIELD_JOURNEY_STAGES, recomputeCompletionId } from '@sos-2/greenfield-runtime';
import { ArrayCommandSource, RecordingUserDevicePresence, createReferenceCompanionRuntime, referenceManualClock } from '@sos-2/companion';
import type { CompanionWorkOrder } from '@sos-2/companion';
import {
  DEFAULT_RAW_MISSION,
  EMPTY_REPOSITORY_SLUG,
  PRODUCT_T0,
  createProductWorld,
  driveOnCloudTicks,
  startFlagshipJourney,
} from './helpers.js';
import type { ProductWorld } from './helpers.js';

/** Run the complete flagship journey on a fresh product world. */
async function runFlagshipJourney(): Promise<ProductWorld> {
  const world = createProductWorld();
  await startFlagshipJourney(world);
  await driveOnCloudTicks(world);
  return world;
}

/** A plain-language readability check: uncertainty entries are sentences a user can read. */
function isPlainSentence(entry: string): boolean {
  return (
    entry.length >= 20 &&
    /\s/.test(entry) &&
    /^[A-Za-z]/.test(entry) &&
    !/^source:[0-9a-f]+$/.test(entry)
  );
}

describe('P15 lane C: the fresh-user flagship journey (§11, user-reachable surfaces only)', () => {
  it('a fresh user completes the flagship journey from a plain-language mission (no developer knowledge required)', async () => {
    const world = await runFlagshipJourney();
    const state = world.journey.state();

    // The user typed ONE sentence in their own words; the record shows it verbatim.
    expect(state.rawMissionStatement).toBe('Build a URL shortener service with a public API');

    // The journey ran every §11 stage, in contract order, and COMPLETED.
    const entered = state.transitions.map((transition) => transition.to);
    expect(entered).toEqual(GREENFIELD_JOURNEY_STAGES);
    expect(state.stage).toBe('COMPLETED');
    expect(state.status).toBe('COMPLETED');
    expect(state.pendingAsk).toBeNull();

    // The user's computer was offline for EVERY cloud tick (§7): a fresh
    // user may close the laptop after approving.
    const ticks = world.journey.ticks();
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.userDeviceOnline).toBe(false);
    }

    // No raw developer transcript is the record: every user-visible
    // surface is a typed record (id + kind + instants + provenance).
    const timeline = await world.journey.timeline();
    for (const event of timeline) {
      expect(event.eventId.length).toBeGreaterThan(0);
      expect(event.kind.length).toBeGreaterThan(0);
      expect(event.provenance.length).toBeGreaterThan(0);
      expect(event.occurredAt).toMatch(/^\d{4}-/);
    }
  });

  it('progress is visible as EVIDENCE, not transcripts: every stage transition has an observable record; the body\u2019s own report is non-authoritative', async () => {
    const world = await runFlagshipJourney();

    // The user-visible timeline carries the §11 stage story.
    const timeline = await world.journey.timeline();
    const stageKinds = timeline.filter((event) => event.kind.startsWith('journey.')).map((event) => event.kind);
    for (const expected of [
      'journey.mission-received',
      'journey.repository-connected',
      'journey.authority-approved',
      'journey.mission-formalized',
      'journey.plan-prepared',
      'journey.node-dispatched',
      'journey.node-completed',
      'journey.change-realized',
      'journey.deployed',
      'journey.runtime-verified',
      'journey.completed',
    ]) {
      expect(stageKinds, `the user-visible timeline must contain ${expected}`).toContain(expected);
    }

    // Every consequential action left typed evidence (the P9 discipline).
    const families = new Set(world.actionEvents.entries().map((event) => event.family));
    for (const family of ['commit', 'push', 'pull-request', 'deployment']) {
      expect(families, `the evidence chain must cover the ${family} action`).toContain(family);
    }
    expect(world.evidence.all().length).toBeGreaterThanOrEqual(world.actionEvents.entries().length);

    // The body's OWN completion report is present in the durable trace
    // (pre-semantic input), but "Done" was gated by the INDEPENDENT
    // certifier — the body never certifies itself.
    const evidenceTimeline = await world.journey.evidenceTimeline();
    expect(evidenceTimeline.some((event) => event.kind === 'task.body-completion-report')).toBe(true);
    const report = world.journey.completionReport()!;
    expect(report.certifiedUponRequestBy.kind).toBe('system');
    expect(report.producedBy.kind).toBe('body');
    expect(report.producedBy.id).not.toBe(report.certifiedUponRequestBy.id);
  });

  it('the resulting repository, runtime and deployment are linked to EXACT revisions in the user-visible record', async () => {
    const world = await runFlagshipJourney();
    const state = world.journey.state();
    const report = world.journey.completionReport()!;

    // Exact repository revisions: workspace head + per-task commits + the imported base.
    expect(report.sourceRevisions.workspaceHead).toMatch(/^source:[0-9a-f]+$/);
    expect(state.workspaceHead).toBe(report.sourceRevisions.workspaceHead);
    expect(report.sourceRevisions.commits.length).toBeGreaterThan(0);
    for (const commit of report.sourceRevisions.commits) {
      expect(commit.sha).toMatch(/^source:[0-9a-f]+$/);
    }
    expect(report.sourceRevisions.importedBase).toMatchObject({ repository: { owner: 'acme', name: 'empty-repo' } });

    // The push and the pull request point at the exact final revision.
    const branch = `sos/mission-${world.journey.journeyId}`;
    expect(report.sourceRevisions.push).toMatchObject({ ref: branch, sha: report.sourceRevisions.workspaceHead });
    expect(report.sourceRevisions.pullRequest).toMatchObject({ headBranch: branch, baseBranch: 'main' });

    // The deployment is linked to the exact final revision.
    expect(report.sourceRevisions.deployment).toMatchObject({
      environment: 'production',
      sourceSha: report.sourceRevisions.workspaceHead,
    });

    // The reference git world actually holds the pushed head (the record
    // and the repository agree — never a decorative link).
    expect(world.gatewayWorld.heads.get('workspace')).toBe(report.sourceRevisions.workspaceHead);
    expect(world.gatewayWorld.pushes).toEqual([
      { remote: `github.com/${EMPTY_REPOSITORY_SLUG}`, ref: branch, sha: report.sourceRevisions.workspaceHead },
    ]);
  });

  it('all unresolved uncertainty is visible to the user in plain, non-developer-encoding terms', async () => {
    const world = await runFlagshipJourney();
    const report = world.journey.completionReport()!;

    // The journey-level remaining uncertainty is retained (never dropped).
    expect(report.remainingUncertainty.length).toBeGreaterThan(0);
    for (const entry of report.remainingUncertainty) {
      expect(isPlainSentence(entry), `uncertainty must be a plain sentence, received: ${JSON.stringify(entry)}`).toBe(true);
    }
    // The reference-mode limitation is stated so a non-developer can read it.
    expect(report.remainingUncertainty.some((entry) => entry.includes('SIMULATED'))).toBe(true);
    expect(report.remainingUncertainty.some((entry) => entry.includes('never a real GitHub connection'))).toBe(true);

    // Honest provider statuses ride along (never live claims).
    for (const status of report.providerStatuses) {
      expect(status.status).toBe('REFERENCE');
      expect(status.detail.length).toBeGreaterThan(0);
    }

    // The evaluation slice carries its own retained uncertainty per verdict.
    expect(report.evaluation.passed).toBeGreaterThan(0);
    expect(report.evaluation.failed).toBe(0);
    expect(report.evaluation.unknown).toBe(0);
    for (const ref of report.evaluation.verdictRefs) {
      expect(ref.targetSourceRevision).toBe(report.sourceRevisions.workspaceHead);
    }
  });

  it('every consequential product-review question is answerable from the user-visible record (what/why/evidence/uncertainty/authority/next)', async () => {
    const world = await runFlagshipJourney();
    const state = world.journey.state();
    const report = world.journey.completionReport()!;
    const timeline = await world.journey.timeline();

    // WHAT is happening: the stage record + its timeline events.
    expect(state.stage).toBe('COMPLETED');
    expect(timeline.some((event) => event.kind === 'journey.completed')).toBe(true);

    // WHY does SOS believe this: the independent evaluation slice.
    expect(report.evaluation.certificationId.length).toBeGreaterThan(0);
    expect(report.evaluation.verdictRefs.length).toBeGreaterThan(0);

    // WHAT EVIDENCE supports it: the durable evidence timeline + typed action evidence.
    const evidenceTimeline = await world.journey.evidenceTimeline();
    expect(evidenceTimeline.length).toBeGreaterThan(0);
    expect(world.evidence.all().length).toBeGreaterThan(0);

    // WHAT uncertainty remains: the retained uncertainty entries.
    expect(report.remainingUncertainty.length).toBeGreaterThan(0);

    // WHAT authority was required: the authority summary + the action-time re-evaluations.
    expect(report.authority).not.toBeNull();
    expect(state.authorityGrantId).toBe(report.authority!.grantId);
    for (const evaluation of world.authority.evaluations) {
      expect(evaluation.snapshot.reason).toBe('GRANTED');
    }

    // WHAT can happen next: no pending ask blocks the completed state.
    expect(state.pendingAsk).toBeNull();
  });

  it('the completion record the user saw reproduces bit-exactly (deterministic, evidence-gated)', async () => {
    const world = await runFlagshipJourney();
    const report = world.journey.completionReport()!;
    expect(recomputeCompletionId(report)).toBe(report.completionId);
    expect(world.journey.reproducedCompletionId()).toBe(report.completionId);

    // A SECOND identical journey by another fresh user produces the SAME record.
    const second = await runFlagshipJourney();
    const secondReport = second.journey.completionReport()!;
    expect(secondReport).toEqual(report);
    expect(second.journey.ticks()).toEqual(world.journey.ticks());
  });

  it('the optional P11 local-companion path: a fresh user\u2019s local work order queues while their device is offline and completes on reconnect (nothing lost, nothing duplicated)', async () => {
    // The P11 reference companion runtime — the local product surface a
    // non-developer pairs with. Everything injected; offline determinism.
    const commandSource = new ArrayCommandSource();
    const devicePresence = new RecordingUserDevicePresence(false);
    const runtime = createReferenceCompanionRuntime({
      clock: referenceManualClock(),
      devicePresence,
      commandSource,
    });
    const grant = runtime.grant;
    await runtime.store.authorityGrants.put(grant);

    // The user pairs their laptop and submits a LOCAL work order — while
    // the device reports OFFLINE (e.g. they queued work then left).
    commandSource.push({ kind: 'pair-companion', pairing_code: 'pair-local-0001', device_id: 'device-p15c-0001', device_label: 'fresh user laptop' });
    const order: CompanionWorkOrder = {
      task_id: 'task-p15c-local-0001',
      mission_ref: null,
      plan: { steps: ['write-local-source', 'read-back'] },
      grant_refs: [grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal', 'filesystem'], placement: 'user-device' },
      holder: 'spirit:persistent',
      expires_at: null,
      steps: [
        { kind: 'workspace.write', path: 'acme/src/local-feature.ts', content: 'export const localFeature = 11;\n' },
        { kind: 'shell.exec', command: 'cat', args: ['acme/src/local-feature.ts'], cwd: null },
        { kind: 'artifacts.capture', name: 'local-source', content: 'export const localFeature = 11;\n' },
        { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'local-complete' } },
      ],
    };
    commandSource.push({ kind: 'run-work-order', order });

    // While offline: the pairing lands, the order QUEUES (never runs).
    const offlineOutcomes = await runtime.host.drain();
    expect(offlineOutcomes.filter((outcome) => outcome.status === 'PAIRED')).toHaveLength(1);
    expect(offlineOutcomes.filter((outcome) => outcome.status === 'QUEUED')).toHaveLength(1);
    expect(await runtime.store.tasks.get('task-p15c-local-0001')).toBeUndefined();

    // On reconnect: reconcile first (exactly-once), then the local work
    // runs to a VERIFIED completion the user can see.
    devicePresence.setOnline(true);
    const onlineOutcomes = await runtime.host.drain();
    const completed = onlineOutcomes.find((outcome) => outcome.status === 'COMPLETED');
    expect(completed).toBeDefined();
    const task = await runtime.store.tasks.get('task-p15c-local-0001');
    expect(task?.status).toBe('COMPLETED');
    expect(task?.final_verification?.verified).toBe(true);

    // The user-visible record stays honest about the installation status.
    expect(runtime.installation.status).toBe('NOT_YET_INSTALLED');
  });
});
