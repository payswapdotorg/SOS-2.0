import { describe, expect, it } from 'vitest';
import { createEnvelope } from '@sos-2/semantic-spine';
import { createContext, validateContext, validateContextDimensions } from '../src/index.js';

const PROVENANCE = ['W1:test'];
const T0 = '2025-01-01T00:00:00.000Z';

describe('context creation (negative)', () => {
  it('rejects unknown dimensions (unknown dimensions are never accepted)', () => {
    expect(() =>
      createContext({ dimensions: { mystery_dimension: 'x' }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/unknown context dimension/);
    expect(() => validateContextDimensions({ another_unknown: 1 })).toThrow(/unknown context dimension/);
  });

  it('rejects mistyped values per dimension type', () => {
    expect(() =>
      createContext({ dimensions: { environment: 'prod' }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/expects one of \[development, test, staging, production\]/);
    expect(() =>
      createContext({ dimensions: { platform: '' }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/non-empty text value/);
    expect(() =>
      createContext({ dimensions: { regulatory: 'GDPR' }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/non-empty list of unique non-empty strings/);
    expect(() =>
      createContext({ dimensions: { regulatory: [] }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/non-empty list of unique non-empty strings/);
    expect(() =>
      createContext({ dimensions: { regulatory: ['GDPR', 'GDPR'] }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/non-empty list of unique non-empty strings/);
  });

  it('rejects malformed dimensions payloads', () => {
    expect(() => validateContextDimensions(null)).toThrow(/dimensions must be an object/);
    expect(() => validateContextDimensions(['list'])).toThrow(/dimensions must be an object/);
    expect(() => validateContextDimensions(42)).toThrow(/dimensions must be an object/);
  });

  it('rejects non-object creation input', () => {
    expect(() => createContext(null as never)).toThrow(/input must be an object/);
  });

  it('delegates envelope discipline to the spine', () => {
    expect(() =>
      createContext({ dimensions: {}, provenance: [], created_at: T0 }),
    ).toThrow(/provenance/);
    expect(() =>
      createContext({ dimensions: {}, provenance: PROVENANCE, created_at: 'nowish' }),
    ).toThrow(/RFC3339/);
  });

  it('validateContext rejects structurally invalid artifacts', () => {
    const good = createContext({ dimensions: { platform: 'web' }, provenance: PROVENANCE, created_at: T0 });
    expect(validateContext({ ...good, extra: 1 })).toBe(false);
    expect(validateContext({ envelope: good.envelope })).toBe(false);
    const wrongKind = createEnvelope({ kind: 'Mission', provenance: PROVENANCE, created_at: T0 });
    expect(validateContext({ envelope: wrongKind, content: good.content })).toBe(false);
    // content shape violation
    expect(validateContext({ envelope: good.envelope, content: { dimensions: good.content.dimensions, extra: 1 } })).toBe(false);
    // unknown dimension inside a structurally fine artifact
    expect(
      validateContext({ envelope: good.envelope, content: { dimensions: { nope: 'x' } } }),
    ).toBe(false);
  });
});
