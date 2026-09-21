/**
 * Architecture Delta record validation — the P10 record at
 * apps/web/ecology/ARCHITECTURE-DELTA.json must satisfy the repo's
 * spec/contracts/architecture-delta.schema.json contract (checked here
 * against the schema's own constraints read from the frozen spec, without
 * adding an AJV dependency to the app — the same discipline as the P1
 * shell's architecture-delta test).
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

describe('the P10 Architecture Delta record', () => {
  test('validates against the frozen schema constraints', () => {
    for (const key of schema.required) {
      expect(delta[key], `required field ${key}`).toBeDefined();
    }
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
    const allowed = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(delta)) {
      expect(allowed.has(key), `unexpected key ${key} (additionalProperties: false)`).toBe(true);
    }
  });

  test('declares the exact work order and rationale reference', () => {
    expect(delta['work_order']).toBe('P10');
    expect(delta['rationale_ref']).toBe('spec/productization-work-orders/P10-package-history-evolution.md');
  });

  test('declares the three replaced route wrappers and the two new sub-route wrappers as boundary changes', () => {
    const boundaries = (delta['boundary_changes'] as string[]).join('\n');
    for (const wrapper of [
      'apps/web/app/packages/page.tsx',
      'apps/web/app/history/page.tsx',
      'apps/web/app/experiments/page.tsx',
      'apps/web/app/packages/composition/[segment]/page.tsx',
      'apps/web/app/history/revision/[kind]/[segment]/page.tsx',
    ]) {
      expect(boundaries).toContain(wrapper);
    }
    expect((delta['modified'] as string[]).join('\n')).toContain('packages/web-contracts/package.json');
    expect((delta['modified'] as string[]).join('\n')).toContain('apps/web/package.json');
  });

  test('declares the preserved invariants the Work Order pins (frozen core, spine authority, live-store reads, DEMO labelling, lockfile identity)', () => {
    const preserved = (delta['preserved_invariants'] as string[]).join('\n');
    expect(preserved).toContain('git diff --stat pnpm-lock.yaml pnpm-workspace.yaml is empty');
    expect(preserved).toContain('reads canonical live state');
    expect(preserved).toContain('DEMO_MARKER_TEXT');
    expect(preserved).toContain('no score hides uncertainty');
    expect(preserved).toContain('READ-ONLY');
  });
});
