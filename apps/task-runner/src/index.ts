/**
 * @sos-2/task-runner — the P12 composition root host (public surface for
 * embedders: build the host, reach every seam).
 */

export { buildTaskRunnerHost, REFERENCE_BODY_COUNT } from './composition.js';
export type { TaskRunnerHost, ProviderStatus, ProviderStatusKind } from './composition.js';
export { SystemClock, ManualClock } from './clock.js';
export type { Clock } from './clock.js';
