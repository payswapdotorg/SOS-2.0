/**
 * @sos-2/companion — the local companion host (Work Order P11).
 *
 * A plain Node + TypeScript host (repo-standard ESM + tsc build, no
 * vendor framework): assembles the durable P2 stores, the P5 Body
 * Broker + Execution Fabric, the authenticated LocalCompanion contract
 * (pairing authority, credential store, granted-scope file port,
 * simulated process seam, durable local event log) and the §9 companion
 * body (placement user-device), with the optional tier-4 browser/IDE
 * bridges attached behind their honest simulated reference transports.
 * NO long-running work inside any request lifetime: the host runs on an
 * INJECTED tick/command source (poll-driven, testable offline — no
 * ambient timers). The §7 user-device model is enforced at the
 * scheduling gate: local-only work orders queue while the device is
 * offline and run when it reconnects (reconcile FIRST — exactly-once,
 * gap-free); cloud work orders never consult device presence.
 *
 * Composition root (the only impure boundary, mirroring apps/api and
 * apps/worker-runtimes): SystemClock + the reference composition attach
 * here; everything deeper is deterministic.
 */

export * from './commands.js';
export * from './errors.js';
export * from './host.js';
export * from './composition.js';
export * from './system-clock.js';

import { fileURLToPath } from 'node:url';
import { SystemClock } from './system-clock.js';
import { ArrayCommandSource, RecordingUserDevicePresence } from './commands.js';
import { createReferenceCompanionRuntime } from './composition.js';

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // The reference demo: pair the companion, run one LOCAL work order that
  // QUEUES while the device is offline and runs when the device reconnects
  // (reconcile FIRST — exactly-once), driven by drains of the injected
  // command source (the real desktop companion drives the same ticks in
  // production).
  const commandSource = new ArrayCommandSource();
  const devicePresence = new RecordingUserDevicePresence(false);
  const runtime = createReferenceCompanionRuntime({
    clock: new SystemClock(),
    devicePresence,
    commandSource,
  });
  runtime.registerCloudBody();
  const grant = runtime.grant;
  void runtime.store.authorityGrants.put(grant);
  commandSource.push({ kind: 'pair-companion', pairing_code: 'pair-local-0001', device_id: 'device-reference-0001', device_label: 'reference laptop' });
  commandSource.push({
    kind: 'run-work-order',
    order: {
      task_id: 'task-local-demo-0001',
      mission_ref: null,
      plan: { steps: ['write-local-source', 'read-back', 'capture-evidence'] },
      grant_refs: [grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal', 'filesystem'], placement: 'user-device' },
      holder: 'spirit:persistent',
      expires_at: null,
      steps: [
        { kind: 'workspace.write', path: 'acme/src/local-feature.ts', content: 'export const localFeature = 11;\n' },
        { kind: 'shell.exec', command: 'cat', args: ['acme/src/local-feature.ts'], cwd: null },
        { kind: 'artifacts.capture', name: 'local-source', content: 'export const localFeature = 11;\n' },
        { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'local-demo-complete' } },
      ],
    },
  });
  const report = (outcomes: readonly { status: string }[]): void => {
    for (const outcome of outcomes) {
      if (outcome.status === 'PAIRED') {
        const paired = outcome as { status: 'PAIRED'; session_id: string; token_name: string };
        console.log(`SOS 2.0 local companion (P11) — paired session ${paired.session_id} (token NAME only: ${paired.token_name})`);
      } else if (outcome.status === 'QUEUED') {
        const queued = outcome as { status: 'QUEUED'; task_id: string; reason: string };
        console.log(`SOS 2.0 local companion (P11) — LOCAL order ${queued.task_id} QUEUED (device offline, §7)`);
      } else if (outcome.status === 'RECONCILED') {
        const reconciled = outcome as { status: 'RECONCILED'; report: { replayed: number; applied: number; duplicates: number; watermark: number } };
        console.log(`SOS 2.0 local companion (P11) — reconciled ${reconciled.report.replayed} local event(s) (applied ${reconciled.report.applied}, duplicates ${reconciled.report.duplicates}, watermark ${reconciled.report.watermark})`);
      } else if (outcome.status === 'COMPLETED') {
        const completed = outcome as { status: 'COMPLETED'; task: { task_id: string; status: string }; verified: boolean; steps: { operation: string; availability: string | null; status: string }[]; evidence_refs: string[]; summary: string };
        console.log(`SOS 2.0 local companion (P11) — task ${completed.task.task_id} ${completed.task.status} (verified: ${completed.verified})`);
        console.log(`  steps: ${completed.steps.map((step) => `${step.operation}:${step.availability ?? step.status}`).join(' | ')}`);
        console.log(`  evidence refs: ${completed.evidence_refs.length}`);
        console.log(`  summary: ${completed.summary}`);
      } else {
        console.log(`SOS 2.0 local companion (P11) — outcome ${outcome.status}: ${JSON.stringify(outcome)}`);
      }
    }
  };
  // Drain while the device is OFFLINE: pairing happens, the local order queues.
  runtime.host.drain().then(async (offlineOutcomes) => {
    report(offlineOutcomes);
    // The device comes back online: reconcile FIRST, then release + run.
    devicePresence.setOnline(true);
    const onlineOutcomes = await runtime.host.drain();
    report(onlineOutcomes);
    console.log(`companion installation: ${runtime.installation.status} (simulated: ${runtime.installation.simulated})`);
    console.log('Reference runtime (in-memory stores, deterministic simulated seams — never presented as live local-device evidence).');
  });
}
