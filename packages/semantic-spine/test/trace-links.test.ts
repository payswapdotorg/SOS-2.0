import { describe, expect, it } from 'vitest';
import {
  TraceLinkError,
  TraceLinkStore,
  createTraceLink,
  isTraceLink,
  validateTraceLink,
} from '../src/index.js';

const MISSION = `sos://Mission/${'a'.repeat(32)}`;
const CONSTITUTION = `sos://Constitution/${'b'.repeat(32)}`;
const EVIDENCE = `sos://Evidence/${'c'.repeat(32)}`;

describe('createTraceLink', () => {
  it('creates a valid link with provenance', () => {
    const link = createTraceLink({ source: MISSION, target: CONSTITUTION, type: 'SATISFIES', provenance: ['w0.5'] });
    expect(link).toEqual({ source: MISSION, target: CONSTITUTION, type: 'SATISFIES', provenance: ['w0.5'] });
    expect(validateTraceLink(link)).toBe(true);
    expect(isTraceLink(link)).toBe(true);
  });

  it('rejects malformed source/target ids', () => {
    expect(() => createTraceLink({ source: 'mission', target: CONSTITUTION, type: 'SATISFIES', provenance: ['x'] })).toThrow(
      /source/,
    );
    expect(() => createTraceLink({ source: MISSION, target: '', type: 'SATISFIES', provenance: ['x'] })).toThrow(
      /target/,
    );
    expect(() => createTraceLink({ source: MISSION, target: 'sos://Mission/short', type: 'SATISFIES', provenance: ['x'] })).toThrow(
      /target/,
    );
  });

  it('rejects unknown trace link types (only the 17 frozen types)', () => {
    expect(() =>
      createTraceLink({ source: MISSION, target: CONSTITUTION, type: 'ADMIREs' as never, provenance: ['x'] }),
    ).toThrow(/unknown trace link type/);
    expect(() =>
      createTraceLink({ source: MISSION, target: CONSTITUTION, type: 'satisfies' as never, provenance: ['x'] }),
    ).toThrow(/unknown trace link type/);
  });

  it('rejects missing or empty provenance (SOS discipline: no provenance-less links)', () => {
    expect(() =>
      createTraceLink({ source: MISSION, target: CONSTITUTION, type: 'SATISFIES', provenance: [] }),
    ).toThrow(/provenance/);
    expect(() =>
      createTraceLink({ source: MISSION, target: CONSTITUTION, type: 'SATISFIES', provenance: ['ok', ''] }),
    ).toThrow(/provenance/);
    expect(() =>
      createTraceLink({ source: MISSION, target: CONSTITUTION, type: 'SATISFIES', provenance: 'x' as never }),
    ).toThrow(/provenance/);
  });

  it('accepts all 17 frozen types', () => {
    for (const type of [
      'SATISFIES', 'REALIZES', 'REFINES', 'CONSTRAINS', 'IMPLEMENTS', 'VERIFIES', 'OBSERVES',
      'SUPPORTS', 'CONTRADICTS', 'CAUSED_BY', 'CAUSED', 'DERIVED_FROM', 'COMPATIBLE_WITH',
      'CONFLICTS_WITH', 'COMPOSES', 'SPECIALIZES', 'GENERALIZES',
    ] as const) {
      const link = createTraceLink({ source: MISSION, target: CONSTITUTION, type, provenance: ['w0.5'] });
      expect(link.type).toBe(type);
      expect(validateTraceLink(link)).toBe(true);
    }
  });
});

describe('validateTraceLink (layered validation)', () => {
  it('accepts schema-valid links without provenance (schema permits absence)', () => {
    expect(validateTraceLink({ source: MISSION, target: CONSTITUTION, type: 'VERIFIES' })).toBe(true);
  });

  it('rejects shape violations, bad ids and empty provenance entries', () => {
    expect(validateTraceLink(null)).toBe(false);
    expect(validateTraceLink({ source: 'x', target: CONSTITUTION, type: 'VERIFIES' })).toBe(false);
    expect(validateTraceLink({ source: MISSION, target: CONSTITUTION, type: 'NOT_A_TYPE' })).toBe(false);
    expect(validateTraceLink({ source: MISSION, target: CONSTITUTION, type: 'VERIFIES', extra: 1 })).toBe(false);
    expect(
      validateTraceLink({ source: MISSION, target: CONSTITUTION, type: 'VERIFIES', provenance: [''] }),
    ).toBe(false);
    expect(
      validateTraceLink({ source: MISSION, target: CONSTITUTION, type: 'VERIFIES', provenance: 'x' }),
    ).toBe(false);
  });

  it('survives JSON round trips', () => {
    const link = createTraceLink({ source: MISSION, target: CONSTITUTION, type: 'SUPPORTS', provenance: ['w0.5'] });
    expect(validateTraceLink(JSON.parse(JSON.stringify(link)))).toBe(true);
  });
});

describe('TraceLinkStore', () => {
  it('adds links and answers forward/backward queries', () => {
    const store = new TraceLinkStore();
    const l1 = store.addLink({ source: MISSION, target: CONSTITUTION, type: 'SATISFIES', provenance: ['w0.5'] });
    const l2 = store.addLink({ source: EVIDENCE, target: MISSION, type: 'VERIFIES', provenance: ['w0.5'] });
    const l3 = store.addLink({ source: MISSION, target: EVIDENCE, type: 'DERIVED_FROM', provenance: ['w0.5'] });

    expect(store.size).toBe(3);
    expect(store.from(MISSION)).toEqual([l1, l3]);
    expect(store.to(MISSION)).toEqual([l2]);
    expect(store.from(CONSTITUTION)).toEqual([]);
    expect(store.to(CONSTITUTION)).toEqual([l1]);
    expect(store.all()).toEqual([l1, l2, l3]);
    expect(store.has(MISSION, CONSTITUTION, 'SATISFIES')).toBe(true);
    expect(store.has(MISSION, CONSTITUTION, 'VERIFIES')).toBe(false);
    expect(store.has(CONSTITUTION, MISSION, 'SATISFIES')).toBe(false);
  });

  it('rejects duplicate (source, target, type) pairs', () => {
    const store = new TraceLinkStore();
    store.addLink({ source: MISSION, target: CONSTITUTION, type: 'SATISFIES', provenance: ['w0.5'] });
    expect(() =>
      store.addLink({ source: MISSION, target: CONSTITUTION, type: 'SATISFIES', provenance: ['other-run'] }),
    ).toThrow(TraceLinkError);
    expect(() =>
      store.add(createTraceLink({ source: MISSION, target: CONSTITUTION, type: 'SATISFIES', provenance: ['x'] })),
    ).toThrow(/duplicate/);
    // same pair, different type -> different link, allowed
    expect(() =>
      store.addLink({ source: MISSION, target: CONSTITUTION, type: 'CONTRADICTS', provenance: ['w0.5'] }),
    ).not.toThrow();
    // reversed direction -> different pair, allowed
    expect(() =>
      store.addLink({ source: CONSTITUTION, target: MISSION, type: 'SATISFIES', provenance: ['w0.5'] }),
    ).not.toThrow();
    expect(store.size).toBe(3);
  });

  it('rejects structurally invalid links at add time', () => {
    const store = new TraceLinkStore();
    expect(() => store.add({ source: 'nope', target: CONSTITUTION, type: 'SATISFIES' } as never)).toThrow(
      TraceLinkError,
    );
    expect(() =>
      store.add({ source: MISSION, target: CONSTITUTION, type: 'SUPPORTS', provenance: [] } as never),
    ).toThrow(TraceLinkError);
    expect(store.size).toBe(0);
  });

  it('returns defensive copies (mutating results does not corrupt the store)', () => {
    const store = new TraceLinkStore();
    store.addLink({ source: MISSION, target: CONSTITUTION, type: 'SATISFIES', provenance: ['w0.5'] });
    const links = store.all();
    links[0]!.provenance = ['tampered'];
    expect(store.all()[0]!.provenance).toEqual(['w0.5']);
  });
});
