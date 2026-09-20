/**
 * Writes the committed golden-run fixture (fixtures/golden-run.json) — the
 * deterministic snapshot of the harness output INCLUDING the full trace
 * graph of both variants (the W0.5/W9 fixture discipline: byte-stable,
 * re-generable, pinned by tests). Mirror of the console app's
 * demo:build convention.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHarness } from './run.js';
import { formatBrownfieldSummary } from '@sos-2/brownfield';

const here = dirname(fileURLToPath(import.meta.url));
const run = runHarness();

const fixture = {
  generated_by: '@sos-2/brownfield-harness write-fixture (deterministic; re-runnable)',
  variants: {
    nominal: {
      decision: run.results.nominal.stages.promotion.decision,
      summary_text: formatBrownfieldSummary(run.results.nominal),
      summary: run.results.nominal.summary,
      trace: run.results.nominal.trace,
      chain: run.results.nominal.chain,
    },
    degraded: {
      decision: run.results.degraded.stages.promotion.decision,
      summary_text: formatBrownfieldSummary(run.results.degraded),
      summary: run.results.degraded.summary,
      trace: run.results.degraded.trace,
      chain: run.results.degraded.chain,
    },
  },
  stdout: run.output,
};

writeFileSync(join(here, '../fixtures/golden-run.json'), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(
  'fixtures/golden-run.json written (nominal decision: %s, degraded decision: %s)',
  fixture.variants.nominal.decision,
  fixture.variants.degraded.decision,
);
