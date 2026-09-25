// ---------------------------------------------------------------------------
// COMPOSITION BOUNDARY (apps/task-runner only): the ambient clock lives
// here and nowhere else. The host runs on whatever clock the embedder
// injects; main() is the offline status entry point.
// ---------------------------------------------------------------------------

import { buildTaskRunnerHost } from './composition.js';
import { SystemClock } from './clock.js';

export function main(): void {
  const host = buildTaskRunnerHost(new SystemClock());
  for (const status of host.providerStatus()) {
    console.log(`${status.provider}: ${status.status} — ${status.detail}`);
  }
  console.log('task-runner host ready: durable tasks + resumable execution + body lifecycle online (reference mode)');
}

main();
