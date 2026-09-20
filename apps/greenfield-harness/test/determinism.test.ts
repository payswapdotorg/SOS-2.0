/**
 * Determinism tests: the golden scenario is a pure function of its fixed
 * inputs — two independent runs produce byte-identical snapshots, the
 * harness verdict is stable, and the ecology rebuilds identically.
 */

import { describe, expect, it } from 'vitest';
import { runGoldenScenario } from '../src/run.js';
import { canonicalSnapshot } from '../src/snapshot.js';
import { runHarness } from '../src/main.js';
import { buildGoldenEcology, buildGoldenScenarioInput } from '../src/scenario.js';
import { runGreenfieldPipeline } from '@sos-2/greenfield';

describe('determinism', () => {
  it('two independent golden runs produce byte-identical canonical snapshots', () => {
    const first = canonicalSnapshot(runGoldenScenario());
    const second = canonicalSnapshot(runGoldenScenario());
    expect(second).toBe(first);
  });

  it('the golden ecology rebuilds identically (registry listing + evidence resolution)', () => {
    const first = buildGoldenEcology();
    const second = buildGoldenEcology();
    expect(second.registry.list().map((entry) => entry.artifact.envelope.id)).toEqual(
      first.registry.list().map((entry) => entry.artifact.envelope.id),
    );
    for (const entry of first.registry.list()) {
      for (const ref of entry.artifact.content.evidence_refs) {
        expect(second.evidenceResolver(ref)?.id).toBe(first.evidenceResolver(ref)?.id);
      }
    }
  });

  it('the harness verdict is stable across runs (exit 0 + identical report)', () => {
    const first = runHarness();
    const second = runHarness();
    expect(second.exitCode).toBe(0);
    expect(second.report).toBe(first.report);
  });

  it('the escalated alternative (no grants) is deterministic too and still fails when unresolved', () => {
    const attempt = (): string => {
      try {
        runGreenfieldPipeline(buildGoldenScenarioInput({ grants: [] }));
        return 'completed';
      } catch (error) {
        return (error as Error).message;
      }
    };
    const runA = attempt();
    const runB = attempt();
    expect(runB).toBe(runA);
    expect(runA).toMatch(/realization REFUSED/i);
  });
});
