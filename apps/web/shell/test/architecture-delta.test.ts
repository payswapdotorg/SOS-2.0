/**
 * Architecture Delta record validation — the record at
 * apps/web/shell/ARCHITECTURE-DELTA.json must satisfy the repo's
 * spec/contracts/architecture-delta.schema.json contract (checked here
 * against the schema's own constraints read from the frozen spec, without
 * adding an AJV dependency to the app).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const deltaPath = join(__dirname, '..', 'ARCHITECTURE-DELTA.json');
const schemaPath = join(repoRoot, 'spec', 'contracts', 'architecture-delta.schema.json');

const delta = JSON.parse(readFileSync(deltaPath, 'utf8')) as Record<string, unknown>;
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  required: string[];
  properties: Record<string, { type: string }>;
  additionalProperties: boolean;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

describe('the P1 Architecture Delta record', () => {
  test('validates against the frozen schema constraints', () => {
    // required: affected_artifacts, preserved_invariants
    for (const key of schema.required) {
      expect(delta[key], `required field ${key}`).toBeDefined();
    }
    // every declared property has the schema's type
    for (const [key, property] of Object.entries(schema.properties)) {
      const value = delta[key];
      if (value === undefined) {
        continue;
      }
      if (property.type === 'array') {
        expect(isStringArray(value), `${key} must be an array of strings`).toBe(true);
      } else {
        expect(typeof value, `${key} must be a string or null`).toMatch(/string|object|null/);
      }
    }
    // additionalProperties: false — no keys outside the schema
    const allowed = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(delta)) {
      expect(allowed.has(key), `unexpected key ${key} (additionalProperties: false)`).toBe(true);
    }
  });

  test('declares the P1 work order and its rationale reference', () => {
    expect(delta['work_order']).toBe('P1');
    expect(delta['rationale_ref']).toBe('spec/productization-work-orders/P1-web-shell.md');
  });

  test('declares the two owned paths as affected artifacts', () => {
    const affected = delta['affected_artifacts'] as string[];
    expect(affected).toContain('apps/web');
    expect(affected).toContain('packages/web-contracts');
  });

  test('declares every structurally-required boundary change (the new-app skeleton files)', () => {
    const boundaries = (delta['boundary_changes'] as string[]).join('\n');
    for (const file of ['package.json', 'next.config.ts', 'tsconfig.json', '.gitignore', 'postcss.config.mjs', 'pnpm-lock.yaml']) {
      expect(boundaries, `boundary_changes must declare ${file}`).toContain(file);
    }
    expect(boundaries).toContain('apps/web/app/**');
    expect(boundaries).toContain('packages/web-contracts/package.json');
  });

  test('declares the determinism and demo-labelling invariants', () => {
    const invariants = (delta['preserved_invariants'] as string[]).join('\n');
    expect(invariants).toContain('DEMO — SIMULATED DATA');
    expect(invariants).toContain('no Date.now, no Math.random');
    expect(invariants).toContain('never conflate');
  });
});
