/**
 * The golden-fixture writer: rebuild the golden scenario and write the
 * canonical snapshot (the FULL pipeline result including the trace graph)
 * to fixtures/golden-run.json. Deterministic — the committed fixture
 * reproduces byte-for-byte.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGoldenScenario } from './run.js';
import { canonicalSnapshot } from './snapshot.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '..', 'fixtures', 'golden-run.json');

const result = runGoldenScenario();
mkdirSync(dirname(fixturePath), { recursive: true });
writeFileSync(fixturePath, canonicalSnapshot(result), 'utf8');
process.stdout.write(`wrote ${fixturePath} (${String(canonicalSnapshot(result).length)} bytes)\n`);
