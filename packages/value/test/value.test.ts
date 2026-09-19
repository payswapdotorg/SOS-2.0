import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_PRECEDENCE_CHAIN,
  BUILT_IN_VALUE_CONSTRAINT_TYPES,
  MISSION_PREVAILS,
  createValueConstraintTypeRegistry,
  createValueModel,
  isRegisteredValueConstraintType,
  listValueConstraintTypes,
  outranks,
  precedenceRank,
  registerValueConstraintType,
  reviseValueModel,
  valueModelArtifactId,
  validateValueModel,
} from '../src/index.js';
import type { MissionView, ValueModelContent } from '../src/index.js';
import { PROVENANCE, T0, T1, compatibleMission, sampleValueContent } from './helpers.js';

describe('precedence chain (frozen §3 ordering)', () => {
  it('realizes spec/architecture.md §3 exactly', () => {
    expect([...AUTHORITY_PRECEDENCE_CHAIN]).toEqual([
      'CONSTITUTION',
      'MISSION',
      'APPROVED_VALUE_COMMITMENT',
      'HARD_CONSTRAINT',
      'ASSURANCE_POLICY',
      'ARCHITECTURE_HYPOTHESIS',
      'CANDIDATE',
      'IMPLEMENTATION_DETAIL',
    ]);
  });

  it('MISSION outranks every value tier: value can never outrank mission', () => {
    expect(outranks('MISSION', 'APPROVED_VALUE_COMMITMENT')).toBe(true);
    expect(outranks('MISSION', 'HARD_CONSTRAINT')).toBe(true);
    expect(outranks('CONSTITUTION', 'MISSION')).toBe(true);
    expect(outranks('APPROVED_VALUE_COMMITMENT', 'HARD_CONSTRAINT')).toBe(true);
    // and never the reverse
    expect(outranks('APPROVED_VALUE_COMMITMENT', 'MISSION')).toBe(false);
    expect(outranks('HARD_CONSTRAINT', 'MISSION')).toBe(false);
    expect(outranks('HARD_CONSTRAINT', 'APPROVED_VALUE_COMMITMENT')).toBe(false);
  });

  it('ranks are indices into the frozen chain (smaller = stronger)', () => {
    expect(precedenceRank('MISSION')).toBe(1);
    expect(precedenceRank('APPROVED_VALUE_COMMITMENT')).toBe(2);
    expect(precedenceRank('IMPLEMENTATION_DETAIL')).toBe(7);
    expect(() => precedenceRank('NOT_A_CLASS' as never)).toThrow(/unknown precedence class/);
  });

  it('MISSION_PREVAILS is the only conflict resolution', () => {
    expect(MISSION_PREVAILS).toBe('MISSION_PREVAILS');
  });
});

describe('typed constraint registry', () => {
  it('seeds the built-in types', () => {
    const types = listValueConstraintTypes();
    expect(types.map((t) => t.type).sort()).toEqual(['BUDGET_LIMIT', 'PREFERENCE', 'RISK_TOLERANCE', 'SERVICE_LEVEL']);
    expect(BUILT_IN_VALUE_CONSTRAINT_TYPES.length).toBe(4);
    const budget = types.find((t) => t.type === 'BUDGET_LIMIT')!;
    expect(budget.bounded).toBe(true);
    const preference = types.find((t) => t.type === 'PREFERENCE')!;
    expect(preference.bounded).toBe(false);
  });

  it('registers extension types explicitly (isolated registry)', () => {
    const registry = createValueConstraintTypeRegistry();
    registry.register({ type: 'PRIVACY_CEILING', bounded: true, description: 'Max data exposure.' });
    expect(registry.isRegistered('PRIVACY_CEILING')).toBe(true);
    expect(registry.list().some((t) => t.type === 'PRIVACY_CEILING')).toBe(true);
  });

  it('registers extension types in the default registry', () => {
    registerValueConstraintType({ type: 'TEST_EXTENSION_TYPE', bounded: false, description: 'Test-only extension.' });
    expect(isRegisteredValueConstraintType('TEST_EXTENSION_TYPE')).toBe(true);
  });
});

describe('value model creation (unit)', () => {
  it('creates a versioned artifact of kind ValueModel with a deterministic id', () => {
    const input = { content: sampleValueContent(), provenance: PROVENANCE, created_at: T0 };
    const { artifact, subordination, conflict_links } = createValueModel(input);
    expect(artifact.envelope.kind).toBe('ValueModel');
    expect(artifact.envelope.version).toBe(1);
    expect(artifact.envelope.status).toBe('DRAFT');
    expect(artifact.envelope.id.startsWith('sos://ValueModel/')).toBe(true);
    expect(artifact.envelope.id).toBe(valueModelArtifactId(input));
    expect(createValueModel(input).artifact.envelope.id).toBe(artifact.envelope.id);
    expect(subordination.status).toBe('SUBORDINATE');
    expect(conflict_links).toHaveLength(0);
  });

  it('validates and round-trips through canonical serialization', async () => {
    const { canonicalSerialize } = await import('@sos-2/semantic-spine');
    const { artifact } = createValueModel({ content: sampleValueContent(), provenance: PROVENANCE, created_at: T0 });
    expect(validateValueModel(artifact)).toBe(true);
    const roundTripped = JSON.parse(canonicalSerialize(artifact));
    expect(validateValueModel(roundTripped)).toBe(true);
    expect(canonicalSerialize(roundTripped)).toBe(canonicalSerialize(artifact));
  });

  it('subordination: compatible value content under a mission is SUBORDINATE', () => {
    const { subordination } = createValueModel({
      content: sampleValueContent(),
      provenance: PROVENANCE,
      created_at: T0,
      mission: compatibleMission(),
    });
    expect(subordination.status).toBe('SUBORDINATE');
    expect(subordination.conflicts).toHaveLength(0);
  });

  it('subordination REJECT (default): a value ceiling looser than a hard mission ceiling throws', () => {
    const content = sampleValueContent();
    content.constraints = [
      { id: 'greedy-cost', type: 'BUDGET_LIMIT', statement: 'Spend up to 20000.', bound: { axis: 'monthly-cost', direction: 'MAX', limit: 20000 } },
    ];
    expect(() =>
      createValueModel({ content, provenance: PROVENANCE, created_at: T0, mission: compatibleMission() }),
    ).toThrow(/rejected at construction.*value never outranks mission/);
  });

  it('subordination FLAG: the conflict is recorded as a CONFLICTS_WITH trace link, mission stands', () => {
    const content = sampleValueContent();
    content.budgets = [{ id: 'greedy-budget', resource: 'monthly-cost', limit: 20000, unit: 'USD' }];
    const result = createValueModel({
      content,
      provenance: PROVENANCE,
      created_at: T0,
      mission: compatibleMission(),
      policy: 'FLAG',
    });
    expect(result.subordination.status).toBe('CONFLICT');
    expect(result.subordination.conflicts).toHaveLength(1);
    expect(result.subordination.conflicts[0]!.value_element_id).toBe('greedy-budget');
    expect(result.subordination.conflicts[0]!.mission_constraint_id).toBe('mission-cost-ceiling');
    const link = result.conflict_links[0]!;
    expect(link.type).toBe('CONFLICTS_WITH');
    expect(link.source).toBe(result.artifact.envelope.id);
    expect(link.target).toBe(compatibleMission().artifact_id);
    expect(link.provenance!.some((entry) => entry.includes('greedy-budget'))).toBe(true);
    // the value content is unchanged — nothing was silently clamped
    expect(result.artifact.content.budgets[0]!.limit).toBe(20000);
  });

  it('a MIN value floor below a hard mission floor conflicts (REJECT and FLAG)', () => {
    const mission: MissionView = {
      artifact_id: `sos://Mission/${'f'.repeat(32)}`,
      constraints: [
        { id: 'mission-uptime', statement: 'Uptime at least 99.9.', hard: true, bound: { axis: 'uptime', direction: 'MIN', limit: 99.9 } },
      ],
    };
    const content = sampleValueContent();
    content.constraints = [
      { id: 'lazy-uptime', type: 'SERVICE_LEVEL', statement: 'Uptime at least 99.5 is fine.', bound: { axis: 'uptime', direction: 'MIN', limit: 99.5 } },
    ];
    expect(() =>
      createValueModel({ content, provenance: PROVENANCE, created_at: T0, mission }),
    ).toThrow(/demands at least/);
    const flagged = createValueModel({ content, provenance: PROVENANCE, created_at: T0, mission, policy: 'FLAG' });
    expect(flagged.subordination.conflicts[0]!.value_limit).toBe(99.5);
    expect(flagged.subordination.conflicts[0]!.mission_limit).toBe(99.9);
  });

  it('cross-direction bounds on the same axis never conflict structurally', () => {
    const mission: MissionView = {
      artifact_id: `sos://Mission/${'1'.repeat(32)}`,
      constraints: [
        { id: 'mission-cost-cap', statement: 'At most 10000.', hard: true, bound: { axis: 'monthly-cost', direction: 'MAX', limit: 10000 } },
      ],
    };
    const content = sampleValueContent();
    content.constraints = [
      { id: 'cost-floor', type: 'BUDGET_LIMIT', statement: 'Spend at least 500 to keep capacity.', bound: { axis: 'monthly-cost', direction: 'MIN', limit: 500 } },
    ];
    expect(
      createValueModel({ content, provenance: PROVENANCE, created_at: T0, mission }).subordination.status,
    ).toBe('SUBORDINATE');
  });

  it('soft mission constraints never machine-veto value constraints', () => {
    const mission: MissionView = {
      artifact_id: `sos://Mission/${'2'.repeat(32)}`,
      constraints: [
        { id: 'soft-cost-hope', statement: 'We would like cost around 5000.', hard: false, bound: { axis: 'monthly-cost', direction: 'MAX', limit: 5000 } },
      ],
    };
    const content = sampleValueContent();
    content.constraints = [
      { id: 'cost-ceiling', type: 'BUDGET_LIMIT', statement: 'Up to 8000.', bound: { axis: 'monthly-cost', direction: 'MAX', limit: 8000 } },
    ];
    expect(
      createValueModel({ content, provenance: PROVENANCE, created_at: T0, mission }).subordination.status,
    ).toBe('SUBORDINATE');
  });

  it('unbounded mission constraints never conflict (nothing to compare)', () => {
    const mission: MissionView = {
      artifact_id: `sos://Mission/${'3'.repeat(32)}`,
      constraints: [
        { id: 'unbounded-hard', statement: 'Be frugal.', hard: true, bound: null },
      ],
    };
    expect(
      createValueModel({ content: sampleValueContent(), provenance: PROVENANCE, created_at: T0, mission }).subordination.status,
    ).toBe('SUBORDINATE');
  });

  it('revision: ACTIVE-only, version + 1, subordination re-checked', () => {
    const created = createValueModel({
      content: sampleValueContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    const nextContent = sampleValueContent();
    nextContent.constraints = [
      { id: 'tighter-cost', type: 'BUDGET_LIMIT', statement: 'Up to 6000.', bound: { axis: 'monthly-cost', direction: 'MAX', limit: 6000 } },
    ];
    const revision = reviseValueModel(created.artifact, {
      content: nextContent,
      provenance: [...PROVENANCE, 'revision-1'],
      created_at: T1,
      mission: compatibleMission(),
    });
    expect(revision.revised.envelope.version).toBe(2);
    expect(revision.revised.envelope.supersedes).toBe(created.artifact.envelope.id);
    expect(revision.revised.envelope.status).toBe('ACTIVE');
    expect(revision.subordination.status).toBe('SUBORDINATE');
    // a revision that smuggles in a conflict is rejected
    const smuggled = sampleValueContent();
    smuggled.constraints = [
      { id: 'greedy-cost', type: 'BUDGET_LIMIT', statement: 'Up to 20000.', bound: { axis: 'monthly-cost', direction: 'MAX', limit: 20000 } },
    ];
    expect(() =>
      reviseValueModel(revision.revised, {
        content: smuggled,
        provenance: PROVENANCE,
        created_at: T1,
        mission: compatibleMission(),
      }),
    ).toThrow(/rejected at construction/);
    // and a DRAFT value model cannot be revised
    const draft = createValueModel({ content: sampleValueContent(), provenance: PROVENANCE, created_at: T0 });
    expect(() =>
      reviseValueModel(draft.artifact, { content: sampleValueContent(), provenance: PROVENANCE, created_at: T1 }),
    ).toThrow(/only ACTIVE value models can be revised/);
  });
});
