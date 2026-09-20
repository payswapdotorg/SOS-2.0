/**
 * Architecture Delta test: the W13 delta record (declared at
 * packages/ecology/W13.architecture-delta.json because spec/** is outside
 * W13's owned paths — the W7/W8 pattern) validates through the spine's
 * assertValidArchitectureDelta, and its field set matches the
 * architecture-delta contract exactly.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertValidArchitectureDelta } from '@sos-2/semantic-spine';
import type { ArchitectureDelta } from '@sos-2/semantic-spine';

const here = dirname(fileURLToPath(import.meta.url));

const DELTA_PATH = '../W13.architecture-delta.json';

function readDelta(): ArchitectureDelta {
  return JSON.parse(readFileSync(join(here, DELTA_PATH), 'utf8')) as ArchitectureDelta;
}

describe('W13 Architecture Delta record', () => {
  it('validates through the spine Architecture Delta authority', () => {
    const delta = readDelta();
    expect(() => assertValidArchitectureDelta(delta)).not.toThrow();
  });

  it('covers exactly the three W13 owned paths and cites the Work Order', () => {
    const delta = readDelta();
    expect(delta.work_order).toBe('W13');
    expect(delta.rationale_ref).toBe('spec/work-orders/W13-package-ecology.md');
    expect(delta.affected_artifacts).toContain('packages/ecology');
    expect(delta.affected_artifacts).toContain('packages/diversity');
    expect(delta.affected_artifacts).toContain('packages/transfer');
    expect(delta.removed).toEqual([]);
    expect(delta.modified).toEqual([]);
    // every added entry mentions one of the owned paths or the delta record itself
    for (const entry of delta.added) {
      expect(entry.startsWith('packages/ecology') || entry.startsWith('packages/diversity') || entry.startsWith('packages/transfer')).toBe(true);
    }
    // the locked invariants are explicitly preserved
    const preserved = delta.preserved_invariants.join('\n');
    expect(preserved).toMatch(/diversity is intentional/);
    expect(preserved).toMatch(/NEVER update the source package's applicability/);
    expect(preserved).toMatch(/Evidence outranks assertion/);
    expect(preserved).toMatch(/no second semantic\/evidence\/package registry/);
    expect(preserved).toMatch(/NEVER auto-demote/);
  });
});
