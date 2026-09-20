/**
 * @sos-2/brownfield-harness tests (W15): deterministic snapshot tests over
 * the golden run — byte-identical outputs across re-runs, the committed
 * golden-run fixture (INCLUDING the trace graph) reproduced exactly, chain
 * completeness, exit-0 semantics and the ROLLBACK path variant.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runHarness } from '../src/run.js';
import { canonicalBrownfieldText, formatBrownfieldSummary } from '@sos-2/brownfield';

const here = dirname(fileURLToPath(import.meta.url));

interface GoldenRunFixture {
  generated_by: string;
  variants: {
    nominal: { decision: string; summary_text: string; summary: unknown; trace: unknown[]; chain: { complete: boolean; root: string; link_count: number } };
    degraded: { decision: string; summary_text: string; summary: unknown; trace: unknown[]; chain: { complete: boolean; root: string; link_count: number } };
  };
  stdout: string;
}

describe('brownfield harness (golden run)', () => {
  const first = runHarness();
  const golden = JSON.parse(readFileSync(join(here, '../fixtures/golden-run.json'), 'utf8')) as GoldenRunFixture;

  it('prints the deterministic summary for BOTH worlds (nominal + ROLLBACK variant)', () => {
    expect(first.results.nominal.stages.promotion.decision).toBe('EXPERIMENT');
    expect(first.results.degraded.stages.promotion.decision).toBe('ROLLBACK');
    expect(first.results.degraded.stages.promotion.recovery).not.toBeNull();
    expect(first.output).toContain('NOMINAL');
    expect(first.output).toContain('DEGRADED');
    expect(first.output).toContain('ROLLBACK');
  });

  it('exits 0 only when BOTH trace chains are complete', () => {
    expect(first.results.nominal.chain.complete).toBe(true);
    expect(first.results.degraded.chain.complete).toBe(true);
    expect(first.ok).toBe(true);
  });

  it('is deterministic: two independent runs are byte-identical', () => {
    const second = runHarness();
    expect(second.output).toBe(first.output);
    expect(canonicalBrownfieldText(second.results.nominal)).toBe(canonicalBrownfieldText(first.results.nominal));
    expect(canonicalBrownfieldText(second.results.degraded)).toBe(canonicalBrownfieldText(first.results.degraded));
  });

  it('reproduces the committed golden-run fixture EXACTLY (including the trace graph)', () => {
    expect(formatBrownfieldSummary(first.results.nominal)).toBe(golden.variants.nominal.summary_text);
    expect(formatBrownfieldSummary(first.results.degraded)).toBe(golden.variants.degraded.summary_text);
    expect(first.results.nominal.trace).toEqual(golden.variants.nominal.trace);
    expect(first.results.degraded.trace).toEqual(golden.variants.degraded.trace);
    expect(first.results.nominal.chain).toEqual(golden.variants.nominal.chain);
    expect(first.results.degraded.chain).toEqual(golden.variants.degraded.chain);
    expect(first.results.nominal.summary).toEqual(golden.variants.nominal.summary);
    expect(first.results.degraded.summary).toEqual(golden.variants.degraded.summary);
    expect(first.output).toBe(golden.stdout);
    expect(golden.variants.nominal.chain.complete).toBe(true);
    expect(golden.variants.degraded.chain.complete).toBe(true);
  });

  it('the trace graph is substantive (typed links across both variants)', () => {
    expect(first.results.nominal.trace.length).toBeGreaterThanOrEqual(25);
    expect(first.results.degraded.trace.length).toBe(first.results.nominal.trace.length);
    const types = new Set(first.results.nominal.trace.map((link) => link.type));
    expect(types.has('DERIVED_FROM')).toBe(true);
    expect(types.has('OBSERVES')).toBe(true);
    expect(types.has('VERIFIES')).toBe(true);
    expect(types.has('REFINES')).toBe(true);
    expect(types.has('CONTRADICTS')).toBe(true);
    expect(types.has('COMPATIBLE_WITH')).toBe(true);
    expect(types.has('CONSTRAINS')).toBe(true);
  });
});
