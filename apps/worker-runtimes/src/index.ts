/**
 * @sos-2/worker-runtimes — the worker runtime host (Work Order P8).
 *
 * A plain Node + TypeScript host (repo-standard ESM + tsc build, no
 * vendor framework): leases a reference body through the P5 broker,
 * executes a bounded task in the sandbox, emits observations/artifacts
 * through the typed boundaries and releases the body — the LOCAL
 * REFERENCE of the external worker topology. No long-running work
 * inside any request lifetime: the host runs on an injected
 * tick/command source (testable offline).
 *
 * Composition root (the only impure boundary, mirroring apps/api):
 * SystemClock + the reference composition attach here; everything
 * deeper is deterministic.
 */

export * from './commands.js';
export * from './errors.js';
export * from './host.js';
export * from './composition.js';
export * from './system-clock.js';

import { fileURLToPath } from 'node:url';
import { SystemClock } from './system-clock.js';
import { ArrayCommandSource, RecordingDevicePresence } from './commands.js';
import { createReferenceWorkerRuntime } from './composition.js';

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // The reference demo: one bounded task on the reference cloud body,
  // driven by one drain of the injected command source (the external
  // worker topology drives the same ticks in production).
  const commandSource = new ArrayCommandSource();
  const runtime = createReferenceWorkerRuntime({
    clock: new SystemClock(),
    devicePresence: new RecordingDevicePresence(true),
    commandSource,
  });
  runtime.registerCloudBody();
  const grant = runtime.grant;
  runtime.store.authorityGrants.put(grant);
  commandSource.push({
    kind: 'run-bounded-task',
    order: {
      task_id: 'task-reference-demo-0001',
      mission_ref: null,
      plan: { steps: ['write-source', 'verify', 'capture-evidence'] },
      grant_refs: [grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
      holder: 'spirit:persistent',
      expires_at: null,
      steps: [
        { kind: 'workspace.write', path: 'src/hello.ts', content: 'export const hello = () => "sos";\n' },
        { kind: 'shell.exec', command: 'cat', args: ['src/hello.ts'], cwd: null },
        { kind: 'git.status' },
        { kind: 'artifacts.capture', name: 'hello-source', content: 'export const hello = () => "sos";\n' },
        { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'demo-complete' } },
      ],
    },
  });
  runtime.host.drain().then((outcomes) => {
    for (const outcome of outcomes) {
      if (outcome.status === 'COMPLETED') {
        console.log(`SOS 2.0 worker runtime (P8) — task ${outcome.task.task_id} ${outcome.task.status} (verified: ${outcome.verified})`);
        console.log(`  steps: ${outcome.steps.map((step) => `${step.operation}:${step.availability ?? step.status}`).join(' | ')}`);
        console.log(`  evidence refs: ${outcome.evidence_refs.length}`);
        console.log(`  summary: ${outcome.summary}`);
      } else {
        console.log(`SOS 2.0 worker runtime (P8) — outcome ${outcome.status}: ${JSON.stringify(outcome)}`);
      }
    }
    console.log('Reference runtime (in-memory stores, simulated provider states — never presented as live provider evidence).');
  });
}
