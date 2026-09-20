/**
 * The self-evolution harness CLI entry (W16). Prints the deterministic
 * summary and exits 0 ONLY if every stage succeeded and every trace chain
 * is complete.
 */

import { runHarness } from './run.js';

const run = runHarness();
console.log(run.output);
process.exit(run.ok ? 0 : 1);
