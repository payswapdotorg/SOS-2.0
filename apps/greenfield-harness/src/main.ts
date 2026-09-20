/**
 * The harness entry point. Runs the golden scenario, prints the summary
 * report (mission -> candidate -> decision -> realization -> reconciliation
 * -> evidence + the trace chain) and exits 0 ONLY if every stage succeeded
 * and the trace chain is complete. No network, no time dependence.
 */

import { pathToFileURL } from 'node:url';
import { runGoldenScenario } from './run.js';
import { renderFailureReport, renderSummaryReport } from './report.js';

/** The harness run result (pure — printing and exiting are main's job). */
export function runHarness(): { report: string; exitCode: 0 | 1 } {
  try {
    const result = runGoldenScenario();
    return { report: renderSummaryReport(result), exitCode: 0 };
  } catch (error) {
    return { report: renderFailureReport(error), exitCode: 1 };
  }
}

/** The CLI main: print the report, exit with the harness verdict. */
export function main(): number {
  const { report, exitCode } = runHarness();
  process.stdout.write(`${report}\n`);
  return exitCode;
}

function invokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exit(main());
}
