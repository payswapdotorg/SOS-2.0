/**
 * Writes the committed golden-run fixture (fixtures/golden-run.json) — the
 * deterministic snapshot of the harness output INCLUDING the full meta trace
 * graph (the W0.5/W15 fixture discipline: byte-stable, re-generable, pinned
 * by tests).
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHarness } from './run.js';
import { formatMetaSummary } from '@sos-2/meta-evolution';

const here = dirname(fileURLToPath(import.meta.url));
const run = runHarness();

const fixture = {
  generated_by: '@sos-2/self-evolution-harness write-fixture (deterministic; re-runnable)',
  object: {
    nominal_probe: {
      decision: run.results.objectNominalProbe.stages.separation.object_probe.decision,
      chain_complete: run.results.objectNominalProbe.stages.separation.object_probe.chain_complete,
      trace_links: run.results.objectNominalProbe.stages.separation.object_probe.trace_links,
      summary: run.results.objectNominalProbe.artifacts.object_loop_summary,
    },
    degraded: {
      decision: run.results.objectDegraded.stages.promotion.decision,
      summary: run.results.objectDegraded.summary,
      trace: run.results.objectDegraded.trace,
      chain: run.results.objectDegraded.chain,
    },
  },
  meta: {
    summary_text: formatMetaSummary(run.results.meta),
    summary: run.results.meta.summary,
    trace: run.results.meta.trace,
    chain: run.results.meta.chain,
  },
  stdout: run.output,
};

writeFileSync(join(here, '../fixtures/golden-run.json'), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(
  'fixtures/golden-run.json written (meta decisions: promote=%s, rollback=%s, ask=%s; guard rejected=%s; chain %s)',
  run.results.meta.summary.decisions.promote,
  run.results.meta.summary.decisions.rollback,
  run.results.meta.summary.decisions.ask,
  run.results.meta.summary.guard.rejected,
  run.results.meta.summary.trace.complete ? 'COMPLETE' : 'BROKEN',
);
