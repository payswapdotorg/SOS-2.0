/**
 * @sos-2/brownfield-harness — the CLI entry point.
 *
 * Runs the golden brownfield scenario end-to-end, prints the deterministic
 * summary and exits 0 ONLY if the full trace chain of BOTH variants is
 * complete. No network, no time dependence.
 */

import { runHarness } from './run.js';

const run = runHarness();
console.log(run.output);
process.exit(run.ok ? 0 : 1);
