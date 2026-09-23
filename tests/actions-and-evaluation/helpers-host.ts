// P9 test helper surface — thin re-export host (assembly alignment, documented
// in the PR body): honest-status.test.ts imports { buildHost, ManualClock }
// from './helpers-host.js'; buildHost lives in the actions composition root
// (@sos-2/actions) and ManualClock in './helpers.js'. Re-export only — no
// logic, no duplication.
export { buildHost } from '@sos-2/actions';
export { ManualClock } from './helpers.js';
