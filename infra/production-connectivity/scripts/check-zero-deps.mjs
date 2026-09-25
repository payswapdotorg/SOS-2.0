#!/usr/bin/env node
/**
 * Dependency-declaration check (Work Order P17-A, the infra/deployment
 * check-zero-deps precedent adapted to the lane rule): this workspace
 * package may declare ONLY workspace:* @sos-2/* runtime dependencies
 * and ONLY the established toolchain devDependencies (@types/node,
 * typescript, vitest) — ZERO external registry dependencies. The
 * lockfile change from this lane is importer addition only.
 *
 * Exit 0 when the declaration is clean; exit 1 (naming the offending
 * dependency) otherwise.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(here, '..', 'package.json');
const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const violations = [];
for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
  if (spec !== 'workspace:*' || !name.startsWith('@sos-2/')) {
    violations.push(`dependencies.${name}=${String(spec)}`);
  }
}
const allowedToolchain = new Set(['@types/node', 'typescript', 'vitest']);
for (const name of Object.keys(pkg.devDependencies ?? {})) {
  if (!allowedToolchain.has(name)) {
    violations.push(`devDependencies.${name}`);
  }
}
for (const field of ['peerDependencies', 'optionalDependencies']) {
  if (pkg[field] !== undefined && Object.keys(pkg[field]).length > 0) {
    violations.push(`${field} (declared non-empty)`);
  }
}

if (violations.length > 0) {
  console.error(`ZERO-EXTERNAL-DEPS CHECK FAIL: infra/production-connectivity/package.json declares: ${violations.join(', ')}.`);
  console.error('This workspace package may declare workspace:* @sos-2/* runtime dependencies + the established toolchain only — the lockfile change from this lane is importer addition only.');
  process.exit(1);
}

console.log('zero-external-deps check: PASS (infra/production-connectivity declares workspace:* @sos-2/* + the established toolchain only; no external registry dependencies)');
