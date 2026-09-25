/**
 * Zero-dependency declaration check (Work Order P14, the P3 precedent).
 *
 * The root cause of the lockfile discipline: this workspace package must
 * declare ZERO dependencies of any kind (dependencies, devDependencies,
 * peerDependencies, optionalDependencies). A zero-dep importer leaves
 * pnpm-lock.yaml byte-identical (empirically pinned by the P3 suite and
 * re-verified for P14); ANY declared dependency — even workspace:* — makes
 * `pnpm install --frozen-lockfile` fail with ERR_PNPM_OUTDATED_LOCKFILE
 * at this base (the governor refreshes importers only after merge). The
 * test toolchain (vitest, tsc) is BORROWED at script-run time from the
 * frozen W17 adversarial suite via `pnpm --filter @sos-2/adversarial
 * exec ...` — runtime borrowing, not a declared dependency.
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
    `ZERO-DEP CHECK FAIL: packages/cost-policy/package.json declares dependencies in: ${violations.join(', ')}. ` +
      'This workspace package must declare ZERO dependencies so pnpm-lock.yaml remains byte-identical and `pnpm install --frozen-lockfile` passes at this base. ' +
      'Borrow the test toolchain at run time from the frozen W17 suites instead.',
  );
  process.exit(1);
}

console.log('zero-dependency declaration check: PASS (packages/cost-policy declares no dependencies of any kind; pnpm-lock.yaml discipline root cause holds)');
