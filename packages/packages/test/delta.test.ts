import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertValidArchitectureDelta, buildArchitectureDelta, isArchitectureDelta } from '@sos-2/semantic-spine';
import type { ArchitectureDelta } from '@sos-2/semantic-spine';

const here = dirname(fileURLToPath(import.meta.url));
const delta = JSON.parse(readFileSync(join(here, '../architecture-delta.json'), 'utf8')) as ArchitectureDelta;

describe('the W6 Architecture Delta record (machine-checked)', () => {
  it('is present at packages/packages/architecture-delta.json and schema-valid', () => {
    expect(isArchitectureDelta(delta)).toBe(true);
    expect(() => assertValidArchitectureDelta(delta)).not.toThrow();
  });

  it('declares the three W6 owned paths as affected artifacts and work order W6', () => {
    expect(delta.affected_artifacts).toContain('packages/packages');
    expect(delta.affected_artifacts).toContain('packages/composition');
    expect(delta.affected_artifacts).toContain('packages/registry');
    expect(delta.affected_artifacts).toContain('sos://schema/package');
    expect(delta.work_order).toBe('W6');
    expect(delta.rationale_ref).toBe('spec/work-orders/W6-package-core.md');
  });

  it('preserves the locked invariants explicitly (no silent authority changes)', () => {
    const preserved = delta.preserved_invariants.join(' | ');
    expect(preserved).toMatch(/frozen and unchanged: DISCOVERED/);
    expect(preserved).toMatch(/no second semantic\/evidence\/package authority/);
    expect(preserved).toMatch(/one lucky success/);
    expect(preserved).toMatch(/never multiplied without justified independence/);
    expect(preserved).toMatch(/no universal winner/);
    expect(preserved).toMatch(/require their own evidence/);
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
