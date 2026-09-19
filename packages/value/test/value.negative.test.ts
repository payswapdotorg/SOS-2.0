import { describe, expect, it } from 'vitest';
import { createEnvelope } from '@sos-2/semantic-spine';
import {
  checkMissionSubordination,
  createValueConstraintTypeRegistry,
  createValueModel,
  isValidValueConstraint,
  validateValueModel,
  validateValueModelContent,
} from '../src/index.js';
import type { MissionView, ValueModelContent } from '../src/index.js';
import { PROVENANCE, T0, compatibleMission, sampleValueContent } from './helpers.js';

describe('value content validation (negative)', () => {
  it('rejects non-object and wrong-field-set content', () => {
    expect(() => validateValueModelContent(null)).toThrow(/value model content must be an object/);
    expect(() => validateValueModelContent({})).toThrow(/exact field set/);
    expect(() => validateValueModelContent({ ...sampleValueContent(), extra: 1 } as unknown as ValueModelContent)).toThrow(/exact field set/);
  });

  it('rejects a non-boolean approved flag', () => {
    const content = sampleValueContent();
    (content as { approved: unknown }).approved = 'yes';
    expect(() => validateValueModelContent(content)).toThrow(/approved must be a boolean/);
  });

  it('rejects unknown objective directions and empty metrics', () => {
    const content = sampleValueContent();
    content.objectives[0]!.direction = 'OPTIMIZE' as never;
    expect(() => validateValueModelContent(content)).toThrow(/direction/);
    const content2 = sampleValueContent();
    content2.objectives[0]!.metric = '';
    expect(() => validateValueModelContent(content2)).toThrow(/metric/);
  });

  it('rejects negative or non-finite budget limits', () => {
    const content = sampleValueContent();
    content.budgets[0]!.limit = -1;
    expect(() => validateValueModelContent(content)).toThrow(/limit must be a finite number >= 0/);
    const content2 = sampleValueContent();
    content2.budgets[0]!.limit = Number.POSITIVE_INFINITY;
    expect(() => validateValueModelContent(content2)).toThrow(/limit must be a finite number >= 0/);
  });

  it('rejects incentive references to unknown objectives', () => {
    const content = sampleValueContent();
    content.incentives[0]!.aligns_with = ['ghost-objective'];
    expect(() => validateValueModelContent(content)).toThrow(/unknown objective/);
  });

  it('rejects duplicate local ids across the whole content', () => {
    const content = sampleValueContent();
    content.constraints[0]!.id = 'grow-revenue';
    expect(() => validateValueModelContent(content)).toThrow(/duplicate local id/);
  });

  it('rejects unknown constraint types (unknown types are never accepted)', () => {
    const content = sampleValueContent();
    content.constraints[0]!.type = 'MYSTERY_TYPE';
    expect(() => validateValueModelContent(content)).toThrow(/uses unknown type/);
    expect(isValidValueConstraint(content.constraints[0])).toBe(false);
  });

  it('rejects bounded-typed constraints without a bound, and unbounded types with one', () => {
    const content = sampleValueContent();
    content.constraints[0] = { id: 'no-bound', type: 'BUDGET_LIMIT', statement: 'x', bound: null };
    expect(() => validateValueModelContent(content)).toThrow(/requires a bound/);
    const content2 = sampleValueContent();
    content2.constraints[0] = {
      id: 'with-bound',
      type: 'PREFERENCE',
      statement: 'x',
      bound: { axis: 'monthly-cost', direction: 'MAX', limit: 1 },
    };
    expect(() => validateValueModelContent(content2)).toThrow(/must carry bound: null/);
  });

  it('rejects malformed bounds (axis, direction, limit)', () => {
    for (const bad of [
      { axis: 'UPPER', direction: 'MAX' as const, limit: 1 },
      { axis: 'cost', direction: 'AT_MOST' as never, limit: 1 },
      { axis: 'cost', direction: 'MAX' as const, limit: Number.NaN },
    ]) {
      expect(
        isValidValueConstraint({ id: 'c', type: 'BUDGET_LIMIT', statement: 's', bound: bad }),
      ).toBe(false);
    }
  });

  it('rejects malformed constraint shape (exact field set)', () => {
    expect(isValidValueConstraint({ id: 'c', type: 'PREFERENCE', statement: 's' })).toBe(false);
    expect(isValidValueConstraint('nope')).toBe(false);
    expect(isValidValueConstraint(null)).toBe(false);
  });

  it('registry rejects duplicate/invalid type registrations', () => {
    const registry = createValueConstraintTypeRegistry();
    expect(() => registry.register({ type: 'BUDGET_LIMIT', bounded: true, description: 'dup' })).toThrow(/already registered/);
    expect(() => registry.register({ type: 'bad name', bounded: true, description: 'x' })).toThrow(/type name must match/);
    expect(() => registry.register({ type: 'OK_TYPE', bounded: 'yes' as unknown as boolean, description: 'x' })).toThrow(/bounded must be a boolean/);
    expect(() => registry.register({ type: 'OK_TYPE', bounded: true, description: '' })).toThrow(/description must be a non-empty string/);
  });

  it('rejects malformed opportunity expected_value', () => {
    const content = sampleValueContent();
    content.opportunities[0]!.expected_value = 'high' as unknown as number;
    expect(() => validateValueModelContent(content)).toThrow(/expected_value/);
  });
});

describe('subordination input validation (negative)', () => {
  it('rejects malformed mission views', () => {
    const content = sampleValueContent();
    expect(() => checkMissionSubordination(content, null as unknown as MissionView)).toThrow(/mission view must be an object/);
    expect(() =>
      checkMissionSubordination(content, { artifact_id: '', constraints: [] } as unknown as MissionView),
    ).toThrow(/artifact_id must be a non-empty string/);
    expect(() =>
      checkMissionSubordination(content, { artifact_id: 'x', constraints: 'nope' } as unknown as MissionView),
    ).toThrow(/constraints must be an array/);
  });

  it('subordination is deterministic: same inputs, same conflicts', () => {
    const content = sampleValueContent();
    content.budgets = [{ id: 'greedy', resource: 'monthly-cost', limit: 99999, unit: 'USD' }];
    const a = checkMissionSubordination(content, compatibleMission());
    const b = checkMissionSubordination(content, compatibleMission());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.status).toBe('CONFLICT');
  });
});

describe('value model artifact validation (negative)', () => {
  it('rejects structurally invalid artifacts', () => {
    const { artifact } = createValueModel({ content: sampleValueContent(), provenance: PROVENANCE, created_at: T0 });
    expect(validateValueModel({ ...artifact, extra: 1 })).toBe(false);
    expect(validateValueModel({ envelope: artifact.envelope })).toBe(false);
    const wrongKind = createEnvelope({ kind: 'Mission', provenance: PROVENANCE, created_at: T0 });
    expect(validateValueModel({ envelope: wrongKind, content: artifact.content })).toBe(false);
    const badContent = sampleValueContent();
    badContent.constraints[0]!.type = 'MYSTERY';
    expect(validateValueModel({ envelope: artifact.envelope, content: badContent })).toBe(false);
  });

  it('rejects non-object creation input', () => {
    expect(() => createValueModel(null as never)).toThrow(/input must be an object/);
  });

  it('delegates envelope discipline to the spine', () => {
    expect(() =>
      createValueModel({ content: sampleValueContent(), provenance: [], created_at: T0 }),
    ).toThrow(/provenance/);
    expect(() =>
      createValueModel({ content: sampleValueContent(), provenance: PROVENANCE, created_at: 'soon' }),
    ).toThrow(/RFC3339/);
  });

  it('isolated registries do not see default-registry extensions and vice versa where unregistered', () => {
    const registry = createValueConstraintTypeRegistry();
    const content = sampleValueContent();
    content.constraints[0] = { id: 'privacy', type: 'PRIVACY_CEILING', statement: 'x', bound: { axis: 'data-exposure', direction: 'MAX', limit: 10 } };
    // not registered in the isolated registry -> rejected
    expect(() =>
      createValueModel({ content, provenance: PROVENANCE, created_at: T0, constraintTypeRegistry: registry }),
    ).toThrow(/uses unknown type/);
    // after explicit registration -> accepted
    registry.register({ type: 'PRIVACY_CEILING', bounded: true, description: 'Max data exposure.' });
    expect(() =>
      createValueModel({ content, provenance: PROVENANCE, created_at: T0, constraintTypeRegistry: registry }),
    ).not.toThrow();
  });
});
