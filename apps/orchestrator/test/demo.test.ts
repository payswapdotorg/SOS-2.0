/**
 * @sos-2/orchestrator-host demo tests (Work Order P6): the deterministic
 * three-lane journey runs end-to-end on the composition root and the
 * report is honest (byte-reproducible; explicit simulated markers).
 */

import { describe, expect, it } from 'vitest';
import { renderDemoReport, runDemoJourney } from '../src/demo.js';

describe('the deterministic demo journey', () => {
  it('completes the three-lane journey with crash recovery and verification-gated completion', async () => {
    const { host, report } = await runDemoJourney();
    expect(report.completed).toBe(true);
    expect(report.tasks).toHaveLength(3);
    for (const task of report.tasks) {
      expect(task.state).toBe('COMPLETED');
      expect(task.verification_ref).not.toBeNull();
    }
    // One lane crashed and recovered (deterministic injection).
    const crashed = report.tasks.filter((task) => task.retries > 0);
    expect(crashed).toHaveLength(1);
    expect(crashed[0]!.retries).toBe(1);
    // The managed default reasoning served — zero BYO providers.
    expect(host.reasoning.providers()).toHaveLength(1);
    expect(report.reasoning!.provider_kind).toBe('managed');
    // The architect gate approved the mission completion under stored authority.
    expect(report.gate!.decision).toBe('APPROVED');
    // Honest simulated markers ride the report.
    expect(report.simulated_markers.length).toBeGreaterThan(0);
    const text = renderDemoReport(report);
    expect(text).toContain('SOS 2.0 Spirit Orchestrator');
    expect(text).toContain('simulated markers');
    expect(text).toContain('verification-gated');
  });

  it('is byte-reproducible (two runs render identical reports)', async () => {
    const first = renderDemoReport((await runDemoJourney()).report);
    const second = renderDemoReport((await runDemoJourney()).report);
    expect(first).toBe(second);
  });
});
