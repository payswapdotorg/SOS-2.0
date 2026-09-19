import { describe, expect, it } from 'vitest';
import { createContractValidator } from '@sos-2/contracts/schema-loader';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ArchitectureDeltaError,
  buildArchitectureDelta,
  canonicalSerialize,
  isArchitectureDelta,
  validateArchitectureDelta,
} from '../src/index.js';

const validator = createContractValidator();

describe('buildArchitectureDelta', () => {
  it('builds a minimal valid delta', () => {
    const delta = buildArchitectureDelta({
      affected_artifacts: ['sos://schema/implementation-model'],
      preserved_invariants: ['trace-types-frozen'],
    });
    expect(delta).toEqual({
      affected_artifacts: ['sos://schema/implementation-model'],
      preserved_invariants: ['trace-types-frozen'],
    });
    expect(validateArchitectureDelta(delta)).toBe(true);
  });

  it('builds a full delta with every field', () => {
    const delta = buildArchitectureDelta({
      affected_artifacts: ['a', 'b'],
      added: ['x'],
      removed: [],
      modified: ['y'],
      preserved_invariants: ['p1', 'p2'],
      boundary_changes: [],
      rationale_ref: null,
      work_order: 'W0.5',
    });
    expect(delta.added).toEqual(['x']);
    expect(delta.removed).toEqual([]);
    expect(delta.modified).toEqual(['y']);
    expect(delta.boundary_changes).toEqual([]);
    expect(delta.rationale_ref).toBeNull();
    expect(delta.work_order).toBe('W0.5');
    expect(validateArchitectureDelta(delta)).toBe(true);
  });

  it('round trips through JSON and the schema', () => {
    const delta = buildArchitectureDelta({
      affected_artifacts: ['a'],
      preserved_invariants: ['p'],
      work_order: 'W0.5',
    });
    const parsed = JSON.parse(JSON.stringify(delta));
    expect(validateArchitectureDelta(parsed)).toBe(true);
    validator.assertValid('architecture-delta', parsed);
    expect(canonicalSerialize(delta)).toBe(canonicalSerialize(parsed));
  });

  it('rejects deltas without affected_artifacts or preserved_invariants (missing or empty)', () => {
    const cases: Array<[string, unknown]> = [
      ['missing affected_artifacts', { preserved_invariants: ['p'] }],
      ['missing preserved_invariants', { affected_artifacts: ['a'] }],
      ['empty affected_artifacts', { affected_artifacts: [], preserved_invariants: ['p'] }],
      ['empty preserved_invariants', { affected_artifacts: ['a'], preserved_invariants: [] }],
      ['affected not an array', { affected_artifacts: 'a', preserved_invariants: ['p'] }],
      ['entries not strings', { affected_artifacts: [1], preserved_invariants: ['p'] }],
      ['empty string entry', { affected_artifacts: [''], preserved_invariants: ['p'] }],
      ['not an object', null],
    ];
    for (const [name, input] of cases) {
      expect(() => buildArchitectureDelta(input as never), name).toThrow(ArchitectureDeltaError);
    }
  });

  it('validates optional field types', () => {
    expect(() =>
      buildArchitectureDelta({
        affected_artifacts: ['a'],
        preserved_invariants: ['p'],
        added: [42] as never,
      }),
    ).toThrow(/added/);
    expect(() =>
      buildArchitectureDelta({
        affected_artifacts: ['a'],
        preserved_invariants: ['p'],
        rationale_ref: 5 as never,
      }),
    ).toThrow(/rationale_ref/);
    expect(() =>
      buildArchitectureDelta({ affected_artifacts: ['a'], preserved_invariants: ['p'], work_order: '' }),
    ).toThrow(/work_order/);
  });
});

describe('validateArchitectureDelta (schema + SOS strictness)', () => {
  it('rejects unknown properties (schema additionalProperties: false)', () => {
    expect(
      validateArchitectureDelta({
        affected_artifacts: ['a'],
        preserved_invariants: ['p'],
        secret_field: true,
      }),
    ).toBe(false);
    expect(isArchitectureDelta({ affected_artifacts: ['a'], preserved_invariants: ['p'], secret_field: true })).toBe(
      false,
    );
  });

  it('layering: schema accepts empty arrays, the spine rejects them (documented strictness)', () => {
    const empty = { affected_artifacts: [], preserved_invariants: [] };
    // schema (ajv) accepts: both required keys are present, arrays of strings
    expect(validator.validate('architecture-delta', empty).valid).toBe(true);
    expect(isArchitectureDelta(empty)).toBe(true);
    // spine rejects: a delta must affect something and preserve something
    expect(validateArchitectureDelta(empty)).toBe(false);
  });

  it('rejects empty-string entries at the spine layer', () => {
    expect(validateArchitectureDelta({ affected_artifacts: [''], preserved_invariants: ['p'] })).toBe(false);
    expect(validateArchitectureDelta({ affected_artifacts: ['a'], preserved_invariants: [''] })).toBe(false);
  });

  it('accepts the W0.5 delta record from spec/contracts/deltas', () => {
    // read the checked-in Architecture Delta record for this very PR
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const deltaPath = path.join(repoRoot, 'spec', 'contracts', 'deltas', 'W0.5.architecture-delta.json');
    const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'));
    expect(validateArchitectureDelta(delta)).toBe(true);
    validator.assertValid('architecture-delta', delta);
    expect(delta.work_order).toBe('W0.5');
  });
});
