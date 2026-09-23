/**
 * Zero-dependency declaration check (Work Order P14, the P3 precedent).
 *
 * This acceptance-suite package must declare ZERO dependencies of any
 * kind: composition with merged packages happens through TEST-TIME
 * module aliases (see vitest.config.ts), never through declared
 * dependencies — the only construction that keeps pnpm-lock.yaml
 * byte-identical and `pnpm install --frozen-lockfile` green at this
 * base.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(here, '..', 'package.json');
const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const violations = dependencyFields.filter((field) => {
  const value = pkg[field];
  return value !== undefined && Object.keys(value).length > 0;
});

if (violations.length > 0) {
  console.error(
    `ZERO-DEP CHECK FAIL: tests/production-hardening/package.json declares dependencies in: ${violations.join(', ')}. ` +
      'Compose through test-time aliases (vitest.config.ts) instead — the lockfile must remain byte-identical.',
  );
  process.exit(1);
}

console.log('zero-dependency declaration check: PASS (tests/production-hardening composes through test-time aliases; pnpm-lock.yaml discipline holds)');
