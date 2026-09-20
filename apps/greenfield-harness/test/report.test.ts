/**
 * Report tests: the summary report renders every stage marker + the trace
 * chain + the verdict; the exit code is 0 only on a complete run and 1 on
 * any failure (the no-silent-success discipline).
 */

import { describe, expect, it } from 'vitest';
import { main, runHarness } from '../src/main.js';
import { renderFailureReport, renderSummaryReport } from '../src/report.js';
import { runGoldenScenario } from '../src/run.js';

describe('the harness report', () => {
  it('renders the six stage markers + the trace chain + a complete verdict', () => {
    const report = renderSummaryReport(runGoldenScenario());
    for (const marker of [
      '1. MISSION FORMALIZATION',
      '2. CANDIDATE COMPOSITION',
      '3. HUMAN DECISION FLOW',
      '4. REALIZATION',
      '5. RECONCILIATION',
      '6. EVIDENCE INGESTION',
      'TRACE CHAIN (Mission -> SystemState)',
      'VERDICT: GREENFIELD REALIZATION COMPLETE',
    ]) {
      expect(report).toContain(marker);
    }
    // The traceability path is rendered.
    expect(report).toContain('state -> mission');
    expect(report).toContain('chain complete     : true');
    // Truthful availability is rendered (UNAVAILABLE never hidden).
    expect(report).toContain('UNAVAILABLE=1');
    expect(report).toContain('SUCCESS=2');
  });

  it('runHarness exits 0 on the golden scenario', () => {
    const { exitCode, report } = runHarness();
    expect(exitCode).toBe(0);
    expect(report).toContain('VERDICT: GREENFIELD REALIZATION COMPLETE');
  });

  it('main() returns the exit code (0 on the golden scenario)', () => {
    // main prints to stdout; the exit code is the contract under test.
    expect(main()).toBe(0);
  });

  it('the failure report renders the error + the exit-1 contract', () => {
    const text = renderFailureReport(new Error('boom: realization REFUSED'));
    expect(text).toContain('HARNESS FAILURE');
    expect(text).toContain('boom: realization REFUSED');
    expect(text).toContain('Exit code: 1');
  });
});
