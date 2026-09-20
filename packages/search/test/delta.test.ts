/**
 * The W7 Architecture Delta record (machine-checked — the repo discipline:
 * architecture-relevant PRs declare an Architecture Delta, validated by the
 * spine's authority).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertValidArchitectureDelta, buildArchitectureDelta, isArchitectureDelta } from '@sos-2/semantic-spine';
import type { ArchitectureDelta } from '@sos-2/semantic-spine';

const here = dirname(fileURLToPath(import.meta.url));
const delta = JSON.parse(readFileSync(join(here, '../W7.architecture-delta.json'), 'utf8')) as ArchitectureDelta;

describe('the W7 Architecture Delta record (machine-checked)', () => {
  it('is present at packages/search/W7.architecture-delta.json and schema-valid', () => {
    expect(isArchitectureDelta(delta)).toBe(true);
    expect(() => assertValidArchitectureDelta(delta)).not.toThrow();
  });

  it('declares the three W7 owned paths as affected artifacts and work order W7', () => {
    expect(delta.affected_artifacts).toContain('packages/search');
    expect(delta.affected_artifacts).toContain('packages/optimization');
    expect(delta.affected_artifacts).toContain('packages/retrieval');
    expect(delta.work_order).toBe('W7');
    expect(delta.rationale_ref).toBe('spec/work-orders/W7-search.md');
  });

  it('preserves the locked invariants explicitly (no silent authority changes)', () => {
    const preserved = delta.preserved_invariants.join(' | ');
    expect(preserved).toMatch(/no second semantic\/evidence\/package authority/);
    expect(preserved).toMatch(/never a single global architecture score as the sole authority/);
    expect(preserved).toMatch(/descends ONLY with a recorded justification/);
    expect(preserved).toMatch(/uncertainty is preserved end-to-end/i);
    expect(preserved).toMatch(/never inferred from member probabilities without justified independence|never be multiplied|without justified independence/);
    expect(preserved).toMatch(/require their own evidence/);
    expect(preserved).toMatch(/marked uncalibrated unless calibration evidence is attached/);
  });

  it('round trips through the spine builder unchanged (canonical serialization)', () => {
    const rebuilt = buildArchitectureDelta({
      affected_artifacts: [...delta.affected_artifacts],
      preserved_invariants: [...delta.preserved_invariants],
      added: [...(delta.added ?? [])],
      removed: [...(delta.removed ?? [])],
      modified: [...(delta.modified ?? [])],
      boundary_changes: [...(delta.boundary_changes ?? [])],
      rationale_ref: delta.rationale_ref ?? null,
      work_order: delta.work_order,
    });
    expect(rebuilt).toEqual(delta);
  });
});
