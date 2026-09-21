/**
 * Zero-dependency declaration check (Work Order P4, mirroring the P3
 * root-cause check at infra/deployment/scripts/check-zero-deps.mjs).
 *
 * This workspace package must declare ZERO dependencies of any kind
 * (dependencies, devDependencies, peerDependencies, optionalDependencies).
 * A zero-dep importer leaves pnpm-lock.yaml byte-identical; ANY declared
 * dependency would change the lockfile and violate the Work Order's hard
 * rule. The test toolchain (vitest, tsc) is BORROWED at script-run time
 * from the frozen W17 adversarial suite via
 * `pnpm --filter @sos-2/adversarial exec ...` — runtime borrowing, not a
 * declared dependency.
 *
 * Exit 0 when the declaration is clean; exit 1 (naming the offending
 * field) otherwise.
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
    `ZERO-DEP CHECK FAIL: packages/github/package.json declares dependencies in: ${violations.join(', ')}. ` +
      'This workspace package must declare ZERO dependencies so pnpm-lock.yaml remains byte-identical (P4 determinism rule, P3 precedent). ' +
      'Borrow the test toolchain at run time from the frozen W17 suites instead.',
  );
  process.exit(1);
}

console.log('zero-dependency declaration check: PASS (packages/github declares no dependencies of any kind; pnpm-lock.yaml discipline root cause holds)');
