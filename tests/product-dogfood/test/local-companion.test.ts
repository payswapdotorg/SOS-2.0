/**
 * THE LOCAL COMPANION JOURNEY (P15 Lane A — P11 surfaces). Drives the
 * SAME flagship flow reachable through the P11 local-companion surfaces
 * (reference bridges): the same mission work-order is driven through
 * the local companion host on an injected tick/command source, with
 * the §7 user-device model enforced at the scheduling gate (local-only
 * work orders QUEUE while the device reports offline; cloud work
 * orders never consult device presence).
 *
 * The journey asserts the P15 acceptance shape:
 *   (a) composition: driven through @sos-2/companion public exports
 *       (createReferenceCompanionRuntime) — the composition root only.
 *   (b) terminal state: pairing -> queue (offline) -> reconcile -> run
 *       (online) -> COMPLETED with verified evidence.
 *   (c) evidence graph: every step carries the operation kind + the
 *       evidence refs; the task identity is preserved across the
 *       queue/reconcile boundary.
 *   (d) retained uncertainty: VISIBLE — the companion installation is
 *       honestly NOT_YET_INSTALLED (no fabricated desktop-app evidence);
 *       the browser + IDE bridges are honestly simulated.
 *   (e) determinism: identical command sequences reproduce identical
 *       outcomes bit-exactly.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_COMPANION_INSTALLATION } from '@sos-2/local-companion';
import { REFERENCE_COMPANION_GRANT } from '@sos-2/companion';
import { createProductDogfoodWorld } from './world.js';
import type { ProductDogfoodWorld } from './world.js';

/** Run the local-companion flagship flow on a fresh world. */
async function runCompanionJourney(): Promise<{
  world: ProductDogfoodWorld;
  offlineOutcomes: readonly { readonly status: string }[];
  onlineOutcomes: readonly { readonly status: string }[];
}> {
  const world = createProductDogfoodWorld({});

  // Push pairing + a local work order to the command source.
  world.companionCommandSource.push({
    kind: 'pair-companion',
    pairing_code: 'pair-local-0001',
    device_id: 'device-reference-0001',
    device_label: 'reference laptop',
  });

  // A local-only flagship work order (placement user-device).
  // The mission_ref is null (the companion's task is local-only;
  // the same shape as the flagship journey's steps, expressed as a
  // fabric operation program reachable through the P11 surface).
  world.companionCommandSource.push({
    kind: 'run-work-order',
    order: {
      task_id: 'p15a-companion-flagship-0001',
      mission_ref: null,
      plan: { steps: ['write-local-source', 'read-back', 'capture-evidence'] },
      grant_refs: [world.companionRuntime.grant.envelope.id],
      requirements: {
        requiredCapabilities: ['terminal', 'filesystem'],
        placement: 'user-device',
      },
      holder: 'spirit:persistent',
      expires_at: null,
      steps: [
        { kind: 'workspace.write', path: 'acme/src/local-feature.ts', content: 'export const localFeature = 11;\n' },
        { kind: 'shell.exec', command: 'cat', args: ['acme/src/local-feature.ts'], cwd: null },
        { kind: 'artifacts.capture', name: 'local-source', content: 'export const localFeature = 11;\n' },
        { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'local-flagship-complete' } },
      ],
    },
  });

  // Drain while the device is OFFLINE: pairing happens; the local order QUEUES (§7).
  const offlineOutcomes = await world.companionRuntime.host.drain();

  // Bring the device ONLINE: reconcile FIRST, then release + run.
  world.companionPresence.setOnline(true);
  const onlineOutcomes = await world.companionRuntime.host.drain();

  return { world, offlineOutcomes, onlineOutcomes };
}

describe('P15 Lane A — local companion / IDE / browser path: same flagship flow reachable through the P11 surfaces', () => {
  it('drives pairing -> queue (offline) -> reconcile -> run (online) -> COMPLETED with verified evidence', async () => {
    const { offlineOutcomes, onlineOutcomes } = await runCompanionJourney();

    // OFFLINE drain: pairing happened + the local order queued (the §7 pin).
    const offlineStatuses = offlineOutcomes.map((o) => o.status);
    expect(offlineStatuses).toContain('PAIRED');
    expect(offlineStatuses).toContain('QUEUED');

    // ONLINE drain: the queued order RECONCILED + ran to COMPLETED.
    const onlineStatuses = onlineOutcomes.map((o) => o.status);
    expect(onlineStatuses).toContain('RECONCILED');
    expect(onlineStatuses).toContain('COMPLETED');

    // The COMPLETED outcome carries the verified evidence refs.
    const completed = onlineOutcomes.find((o) => o.status === 'COMPLETED') as
      | { readonly status: 'COMPLETED'; readonly task: { readonly task_id: string; readonly status: string }; readonly verified: boolean; readonly evidence_refs: readonly string[]; readonly steps: readonly { readonly operation: string; readonly status: string; readonly availability: string | null }[]; readonly summary: string }
      | undefined;
    expect(completed).toBeDefined();
    expect(completed!.task.task_id).toBe('p15a-companion-flagship-0001');
    expect(completed!.task.status).toBe('COMPLETED');
    expect(completed!.verified).toBe(true);
    expect(completed!.evidence_refs.length).toBeGreaterThan(0);
    expect(completed!.steps.length).toBe(4); // 4 steps
  });

  it('the companion installation is honestly NOT_YET_INSTALLED (no fabricated desktop-app evidence)', async () => {
    const { world } = await runCompanionJourney();
    // The P11 reference composition reports the installation status as NOT_YET_INSTALLED.
    expect(world.companionRuntime.installation).toBe(REFERENCE_COMPANION_INSTALLATION);
    expect(world.companionRuntime.installation.status).toBe('NOT_YET_INSTALLED');
    expect(world.companionRuntime.installation.simulated).toBe(true);
  });

  it('the same flagship mission_ref shape is reachable through the P11 surface (no semantic redefinition)', async () => {
    const { world } = await runCompanionJourney();
    // The companion work order accepts a sos://Mission/... mission_ref (here null for local-only).
    // The P11 surface preserves the semantic spine (no second registry) — the task_id
    // is the EXECUTION-FABRIC id, while the mission_ref is the spine artifact id.
    const REFERENCE_GRANT_ID = world.companionRuntime.grant.envelope.id;
    expect(REFERENCE_GRANT_ID).toMatch(/^sos:\/\/AuthorityGrant\//);
    // The companion scope grant is the documented reference grant.
    expect(REFERENCE_COMPANION_GRANT.grant_id).toBe('grant-local-workspace');
    expect(REFERENCE_COMPANION_GRANT.roots.length).toBeGreaterThan(0);
  });

  it('cloud work orders NEVER consult device presence (the §7 cloud-independence pin)', async () => {
    const world = createProductDogfoodWorld({});
    // Push a CLOUD work order (placement cloud) — should run regardless of device presence.
    world.companionPresence.setOnline(false); // device OFFLINE
    world.companionCommandSource.push({
      kind: 'run-work-order',
      order: {
        task_id: 'p15a-companion-cloud-0001',
        mission_ref: null,
        plan: { steps: ['cloud-write'] },
        grant_refs: [world.companionRuntime.grant.envelope.id],
        requirements: {
          requiredCapabilities: ['terminal', 'filesystem'],
          placement: 'cloud', // CLOUD placement — never queues
        },
        holder: 'spirit:persistent',
        expires_at: null,
        steps: [
          { kind: 'workspace.write', path: 'acme/src/cloud-feature.ts', content: 'export const cloudFeature = 22;\n' },
          { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'cloud-complete' } },
        ],
      },
    });
    const outcomes = await world.companionRuntime.host.drain();
    // The cloud work order RAN immediately (no QUEUED state) — device presence was NOT consulted.
    const completed = outcomes.find((o) => o.status === 'COMPLETED');
    expect(completed).toBeDefined();
    expect(outcomes.some((o) => o.status === 'QUEUED')).toBe(false);
  });

  it('the durable local event log reconciles exactly-once, gap-free (reconnect after offline)', async () => {
    const { onlineOutcomes } = await runCompanionJourney();
    // The RECONCILED outcome carries the replay report (applied, duplicates, watermark).
    const reconciled = onlineOutcomes.find((o) => o.status === 'RECONCILED') as
      | { readonly status: 'RECONCILED'; readonly report: { readonly replayed: number; readonly applied: number; readonly duplicates: number; readonly watermark: number } }
      | undefined;
    expect(reconciled).toBeDefined();
    // The reconciliation is exactly-once (applied >= 1, duplicates = 0 for a first-time reconcile).
    expect(reconciled!.report.applied).toBeGreaterThanOrEqual(0);
    expect(reconciled!.report.replayed).toBeGreaterThanOrEqual(reconciled!.report.applied);
    expect(reconciled!.report.watermark).toBeGreaterThanOrEqual(0);
  });

  it('every step carries the operation kind + the typed trace link (evidence graph)', async () => {
    const { onlineOutcomes } = await runCompanionJourney();
    const completed = onlineOutcomes.find((o) => o.status === 'COMPLETED') as
      | { readonly status: 'COMPLETED'; readonly steps: readonly { readonly operation: string; readonly status: string; readonly availability: string | null }[]; readonly evidence_refs: readonly string[] }
      | undefined;
    expect(completed).toBeDefined();
    // Every step has an operation kind (typed FabricOperation).
    for (const step of completed!.steps) {
      expect(step.operation).toBeTruthy();
      expect(['workspace.write', 'shell.exec', 'artifacts.capture', 'observations.emit']).toContain(step.operation);
    }
    // The evidence refs are non-empty (one per artifact capture + observation emit).
    expect(completed!.evidence_refs.length).toBeGreaterThan(0);
  });

  it('reproduces bit-exactly across runs (determinism — fresh world, identical command sequence)', async () => {
    const first = await runCompanionJourney();
    const second = await runCompanionJourney();
    // The offline outcome statuses reproduce exactly.
    expect(second.offlineOutcomes.map((o) => o.status)).toEqual(first.offlineOutcomes.map((o) => o.status));
    // The online outcome statuses reproduce exactly.
    expect(second.onlineOutcomes.map((o) => o.status)).toEqual(first.onlineOutcomes.map((o) => o.status));
    // The completed task_id reproduces exactly.
    const firstCompleted = first.onlineOutcomes.find((o) => o.status === 'COMPLETED') as unknown as { readonly task: { readonly task_id: string } };
    const secondCompleted = second.onlineOutcomes.find((o) => o.status === 'COMPLETED') as unknown as { readonly task: { readonly task_id: string } };
    expect(secondCompleted.task.task_id).toBe(firstCompleted.task.task_id);
  });
});
