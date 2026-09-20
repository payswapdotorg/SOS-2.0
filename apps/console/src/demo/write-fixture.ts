/**
 * Writes the golden demo fixture to fixtures/demo.json.
 *
 * Run after building: `pnpm --filter @sos-2/console demo:build`.
 * The fixture is deterministic: rebuilding produces byte-identical output
 * (pinned by the golden-fixture test).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoWorld } from './build-demo.js';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', '..', 'fixtures', 'demo.json');

const world = buildDemoWorld();
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(world, null, 2)}\n`, 'utf8');
console.log(`W11 demo fixture written: ${target}`);
