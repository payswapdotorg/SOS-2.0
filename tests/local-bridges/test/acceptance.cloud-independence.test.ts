/**
 * ACCEPTANCE (Work Order P11): CLOUD TASKS DO NOT REQUIRE THE COMPANION.
 *
 * A FULL cloud-body journey through the PUBLIC §9 contract behind the P5
 * broker (lease -> execute -> release) in a COMPANION-ABSENT world: this
 * file imports ZERO P11 packages (pinned structurally by
 * acceptance.structure.test.ts reading this file's import specifiers) —
 * the world is composed ONLY of merged packages (@sos-2/body-runtimes,
 * @sos-2/body-broker, @sos-2/execution-fabric, @sos-2/live-store,
 * @sos-2/authority, @sos-2/harness). No companion object, bridge, queue,
 * event log or device-presence port exists anywhere in this journey —
 * cloud work is INDEPENDENT of the user's device (§7) and of the local
 * companion entirely.
 */

import { describe, expect, it } from 'vitest';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { BodyBroker } from '@sos-2/body-broker';
import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import type { FabricOperation } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { TaskRecord } from '@sos-2/live-store';

const T0 = Date.parse('2026-01-15T09:00:00Z');
const MISSION_REF = `sos://Mission/${'b2c3d4e5'.repeat(4)}`;

const CLOUD_STEPS: readonly FabricOperation[] = [
  { kind: 'workspace.write', path: 'src/feature.ts', content: 'export const feature = 11;\n' },
  { kind: 'shell.exec', command: 'cat', args: ['src/feature.ts'], cwd: null },
  { kind: 'git.status' },
  { kind: 'git.createBranch', name: 'feature/eleven', from_ref: null },
  { kind: 'git.commit', message: 'feat: feature eleven', paths: [] },
  { kind: 'git.push', remote: 'origin', ref: 'feature/eleven' },
  { kind: 'git.createPullRequest', title: 'feat: feature eleven', source_branch: 'feature/eleven', target_branch: 'main' },
  { kind: 'artifacts.capture', name: 'build-report', content: 'all checks passed' },
  { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'complete' } },
];

describe('acceptance: cloud tasks do not require the companion (companion-absent world)', () => {
  it('a FULL cloud-body journey completes with ZERO companion presence (no companion probes — nothing companion-shaped exists here)', async () => {
    // The companion-absent world: ONLY merged packages, NO P11 import
    // anywhere in this file (pinned by the structural scan).
    const clock = new ManualClock(T0);
    const store = createInMemoryLiveStore({ clock });
    const broker = new BodyBroker({ leases: store.bodyLeases, clock });
    const fabric = new ExecutionFabric({
      tasks: store.tasks,
      authorityGrants: store.authorityGrants,
      observationEvents: store.observationEvents,
      objects: store.objects,
      broker,
      clock,
    });
    const grant: AuthorityGrantArtifact = createGrant({
      grantee: 'spirit:persistent',
      scope: { kind: 'KIND', artifact_kind: 'Mission' },
      permissions: ['READ', 'REVISE'],
      expiry: { kind: 'TIME', at: formatRfc3339(T0 + 86_400_000) },
      provenance: ['p11-cloud-independence-suite'],
      created_at: formatRfc3339(T0),
      status: 'ACTIVE',
    });
    await store.authorityGrants.put(grant);

    // The cloud body (the P8 reference disposable cloud coding/shell body).
    const body = new CloudCodingShellBody({
      bodyId: 'cloud-independence-shell',
      sandboxPolicy: {
        filesystem: { mode: 'workspace', root: '/workspace/cloud-independence' },
        network: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
        secrets: ['github-token'],
        budgets: { fileWrites: 50, fileBytes: 100_000, shellCommands: 50, networkCalls: 50, secretReveals: 50 },
        resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
      },
      secrets: { 'github-token': 'cloud-journey-secret-never-echoed' },
    });
    broker.registerBody({
      body_id: 'cloud-independence-shell',
      provider: { name: 'reference-cloud-shell', version: '1.0.0' },
      capabilities: body.capabilities(),
      placement: 'cloud',
      harness: body,
    });

    // Lease -> execute -> release: the full bounded task through the
    // fabric's uniform gate pipeline.
    const created = await fabric.createBoundedTask({
      task_id: 'task-cloud-independent-0001',
      mission_ref: MISSION_REF,
      plan: { steps: ['prepare', 'implement', 'commit', 'report'] },
      grant_refs: [grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
      holder: 'spirit:persistent',
      expires_at: null,
    });
    expect(created.status).toBe('CREATED');
    const task: TaskRecord = created.status === 'CREATED' ? created.task : ({} as TaskRecord);
    expect(task.status).toBe('RUNNING');
    expect(await broker.isLeaseLive(task.body_lease_ref!)).toBe(true);

    let executed = 0;
    let failures = 0;
    for (const step of CLOUD_STEPS) {
      const result = await fabric.execute('task-cloud-independent-0001', step);
      if (result.status === 'EXECUTED') {
        executed += 1;
        if (result.availability === 'FAILURE') {
          failures += 1;
        }
      }
    }
    expect(executed).toBe(CLOUD_STEPS.length);
    expect(failures).toBe(0);

    const running = await store.tasks.get('task-cloud-independent-0001');
    expect(running?.observations.length).toBeGreaterThanOrEqual(CLOUD_STEPS.length + 1);
    expect(running?.artifacts.length).toBe(1);

    const completion = await fabric.completeTask('task-cloud-independent-0001', {
      verified: true,
      recorded_at: formatRfc3339(T0 + 3_600_000),
      evidence_refs: running?.observations ?? [],
      summary: 'the cloud journey completed in a companion-absent world — cloud tasks never require the companion',
    });
    expect(completion.status).toBe('TRANSITIONED');
    const completed = await store.tasks.get('task-cloud-independent-0001');
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.final_verification?.verified).toBe(true);
    const lease = await store.bodyLeases.get(task.body_lease_ref!);
    expect(lease?.state).toBe('RELEASED');
  });
});
