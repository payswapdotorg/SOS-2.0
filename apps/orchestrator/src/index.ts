/**
 * @sos-2/orchestrator-host — the composition root main (Work Order P6).
 *
 * A plain Node + TypeScript host (repo-standard ESM + tsc, no vendor
 * framework — the apps/api + apps/worker-runtimes precedent). The
 * composition boundary (SystemClock) attaches here for real deployments;
 * the DEMO main deliberately runs on the fixed ManualClock so its output
 * is byte-reproducible (demo state is explicitly simulated — never
 * presented as live state).
 */

export * from './composition.js';
export * from './tick-source.js';
export * from './system-clock.js';
export * from './demo.js';

import { fileURLToPath } from 'node:url';
import { renderDemoReport, runDemoJourney } from './demo.js';

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // The deterministic three-lane demo journey (mission -> decomposition
  // -> 3 concurrent lanes on disjoint scopes -> crash + recovery ->
  // verification-gated completion -> architect gate -> honest report).
  await runDemoJourney()
    .then(({ report }) => {
      console.log(renderDemoReport(report));
    })
    .catch((cause: unknown) => {
      console.error(`the demo journey failed honestly: ${(cause as Error).message}`);
      process.exitCode = 1;
    });
}
