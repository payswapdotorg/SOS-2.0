/**
 * The self-evolution harness tests (W16): the harness runs BOTH paths
 * deterministically — byte-identical output on re-run (fresh stores), the
 * committed golden-run fixture (INCLUDING the trace graph) reproduces
 * exactly, and the verdict gate holds only when every stage succeeded.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHarness } from '../src/run.js';
import { canonicalMetaText, formatMetaSummary } from '@sos-2/meta-evolution';

const here = dirname(fileURLToPath(import.meta.url));

describe('self-evolution harness', () => {
  const first = runHarness();
  const second = runHarness();

  it('exits 0 only when every stage succeeded and every trace chain is complete', () => {
    expect(first.ok).toBe(true);
    expect(first.output).toContain('harness verdict: COMPLETE');
    expect(first.results.meta.chain.complete).toBe(true);
    expect(first.results.objectDegraded.chain.complete).toBe(true);
    expect(first.results.objectNominalProbe.stages.separation.object_probe.chain_complete).toBe(true);
  });

  it('runs BOTH meta paths: HEALTHY (promoted, revision applied) and ADVERSARIAL (rejected + rolled back + retained)', () => {
    const meta = first.results.meta;
    expect(meta.summary.guard.rejected).toBe(1);
    expect(meta.summary.decisions.promote).toBe(1);
    expect(meta.summary.decisions.rollback).toBe(1);
    expect(meta.summary.decisions.ask).toBe(1);
    expect(meta.summary.retained_failures.count).toBe(1);
    expect(meta.summary.process_revision.restore_exact).toBe(true);
    expect(meta.summary.effectiveness.simulated).toBe(true);
    expect(meta.summary.effectiveness.negative).toBe(1);
    expect(meta.summary.retained_failures.penalty_demonstrated).toBe(true);
  });

  it('runs the object loop over the W15 golden fixtures in both worlds', () => {
    expect(first.results.objectNominalProbe.stages.separation.object_probe.decision).toBe('EXPERIMENT');
    expect(first.results.objectDegraded.stages.promotion.decision).toBe('ROLLBACK');
    expect(first.results.objectDegraded.summary.system_name).toBe('merch-catalog-legacy');
  });

  it('prints the full summary shape (proposals -> guard verdicts -> measurements -> decisions -> retained failures -> process revision)', () => {
    expect(first.output).toContain('proposals: 4');
    expect(first.output).toContain('guard: 3 passed, 1 rejected');
    expect(first.output).toContain('effectiveness: 3 measured');
    expect(first.output).toContain('decisions: promote=1, rollback=1, ask=1');
    expect(first.output).toContain('retained failures: 1');
    expect(first.output).toContain('process revision:');
    expect(first.output).toContain('trace chain: COMPLETE');
  });

  it('is deterministic: re-running the harness produces the byte-identical output', () => {
    expect(second.output).toBe(first.output);
    expect(formatMetaSummary(second.results.meta)).toBe(formatMetaSummary(first.results.meta));
    expect(canonicalMetaText(second.results.meta)).toBe(canonicalMetaText(first.results.meta));
    expect(second.results.objectDegraded.summary).toEqual(first.results.objectDegraded.summary);
    expect(second.results.objectDegraded.trace).toEqual(first.results.objectDegraded.trace);
  });

  it('reproduces the committed golden-run fixture exactly (deterministic snapshot including the trace graph)', () => {
    const golden = JSON.parse(readFileSync(join(here, '../fixtures/golden-run.json'), 'utf8')) as {
      object: { degraded: { decision: string; trace: unknown[]; chain: { complete: boolean }; summary: unknown } };
      meta: { summary_text: string; trace: unknown[]; chain: { complete: boolean }; summary: unknown };
      stdout: string;
    };
    expect(golden.object.degraded.decision).toBe(first.results.objectDegraded.stages.promotion.decision);
    expect(golden.object.degraded.summary).toEqual(first.results.objectDegraded.summary);
    expect(golden.object.degraded.trace).toEqual(first.results.objectDegraded.trace);
    expect(golden.object.degraded.chain.complete).toBe(first.results.objectDegraded.chain.complete);
    expect(golden.meta.summary_text).toBe(formatMetaSummary(first.results.meta));
    expect(golden.meta.summary).toEqual(first.results.meta.summary);
    expect(golden.meta.trace).toEqual(first.results.meta.trace);
    expect(golden.meta.chain.complete).toBe(first.results.meta.chain.complete);
    expect(golden.stdout).toBe(first.output);
  });

  it('carries a substantive trace graph with the full link vocabulary', () => {
    const linkTypes = new Set(first.results.meta.trace.map((link) => link.type));
    expect(first.results.meta.trace.length).toBeGreaterThanOrEqual(50);
    for (const expectedType of ['DERIVED_FROM', 'CONSTRAINS', 'OBSERVES', 'VERIFIES', 'CAUSED_BY']) {
      expect(linkTypes.has(expectedType as never), `missing link type ${expectedType}`).toBe(true);
    }
  });
});
