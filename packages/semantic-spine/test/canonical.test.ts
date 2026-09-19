import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CanonicalizationError,
  canonicalBytes,
  canonicalSerialize,
  contentHash,
  isCanonicalText,
} from '../src/index.js';

describe('canonical serialization', () => {
  it('sorts keys recursively and emits no whitespace', () => {
    expect(canonicalSerialize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalSerialize({ z: { y: [3, 1, 2], x: null }, a: true })).toBe(
      '{"a":true,"z":{"x":null,"y":[3,1,2]}}',
    );
    expect(canonicalSerialize([])).toBe('[]');
    expect(canonicalSerialize({})).toBe('{}');
    expect(canonicalSerialize(null)).toBe('null');
    expect(canonicalSerialize('hé\n"\\')).toBe(JSON.stringify('hé\n"\\'));
  });

  it('produces UTF-8 canonical bytes', () => {
    const bytes = canonicalBytes({ clé: 'valeur' });
    expect(bytes).toEqual(new TextEncoder().encode(canonicalSerialize({ clé: 'valeur' })));
    expect(bytes instanceof Uint8Array).toBe(true);
  });

  it('round trips byte-identically: serialize -> parse -> serialize', () => {
    const value = { b: [1, { d: 'x', c: [true, false, null] }], a: { nested: { deep: 7 } } };
    const s1 = canonicalSerialize(value);
    const s2 = canonicalSerialize(JSON.parse(s1));
    const s3 = canonicalSerialize(JSON.parse(s2));
    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
  });

  it('is a fixed point (idempotent)', () => {
    const value = { arr: [{ z: 1, a: 2 }], n: -0.5, s: 'txt' };
    const once = canonicalSerialize(value);
    expect(canonicalSerialize(JSON.parse(once))).toBe(once);
    expect(isCanonicalText(once)).toBe(true);
  });

  it('DOCUMENTED BEHAVIOR — normalizes non-canonical input deterministically (never rejects)', () => {
    const nonCanonical = '{ "b" : 2, "a" : 1 }'; // unsorted keys + whitespace
    const normalized = canonicalSerialize(JSON.parse(nonCanonical));
    expect(normalized).toBe('{"a":1,"b":2}');
    expect(isCanonicalText(nonCanonical)).toBe(false);
    expect(isCanonicalText(normalized)).toBe(true);
    // equivalent number spellings are normalized too
    expect(canonicalSerialize(JSON.parse('1E5'))).toBe('100000');
    expect(canonicalSerialize(JSON.parse('0.100'))).toBe('0.1');
    // duplicate keys keep the last occurrence (JSON.parse semantics)
    expect(canonicalSerialize(JSON.parse('{"a":1,"a":2}'))).toBe('{"a":2}');
  });

  it('is invariant under key reordering at any depth', () => {
    const a = { x: { p: 1, q: 2 }, y: [{ b: 1, a: 2 }] };
    const b = { y: [{ a: 2, b: 1 }], x: { q: 2, p: 1 } };
    expect(canonicalSerialize(a)).toBe(canonicalSerialize(b));
  });

  it('rejects non-JSON values with clear errors', () => {
    expect(() => canonicalSerialize(Number.NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalSerialize(Number.POSITIVE_INFINITY)).toThrow(CanonicalizationError);
    expect(() => canonicalSerialize([Number.NEGATIVE_INFINITY])).toThrow(CanonicalizationError);
    expect(() => canonicalSerialize({ a: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalSerialize([undefined] as unknown as never[])).toThrow(CanonicalizationError);
    expect(() => canonicalSerialize(() => 1)).toThrow(CanonicalizationError);
    expect(() => canonicalSerialize(Symbol('x') as unknown as null)).toThrow(CanonicalizationError);
    expect(() => canonicalSerialize(10n as unknown as number)).toThrow(CanonicalizationError);
    expect(() => canonicalSerialize(new Date(0) as unknown as string)).toThrow(CanonicalizationError);
    expect(() => canonicalSerialize(new Map() as unknown as null)).toThrow(CanonicalizationError);
  });

  it('isCanonicalText is total (false for unparseable text, never throws)', () => {
    expect(isCanonicalText('')).toBe(false);
    expect(isCanonicalText('not json')).toBe(false);
    expect(isCanonicalText('{"a":1}')).toBe(true);
    expect(isCanonicalText('{ "a": 1 }')).toBe(false);
    expect(isCanonicalText('{"b":1,"a":2}')).toBe(false);
  });
});

describe('content hashing over canonical bytes', () => {
  it('is stable and independent of key order', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: 1, b: 2 })).toMatch(/^[0-9a-f]{64}$/);
    // sha-256 reference vector: canonical {"a":1,"b":2}
    expect(contentHash({ a: 1, b: 2 })).toBe(
      createHash('sha256').update('{"a":1,"b":2}').digest('hex'),
    );
  });

  it('detects tampering: any content change changes the hash', () => {
    const original = { envelope: { id: 'sos://Mission/abc', provenance: ['w0.5'] } };
    const tampered = { envelope: { id: 'sos://Mission/abd', provenance: ['w0.5'] } };
    expect(contentHash(original)).not.toBe(contentHash(tampered));
    const tampered2 = { envelope: { id: 'sos://Mission/abc', provenance: ['w0.5', 'extra'] } };
    expect(contentHash(original)).not.toBe(contentHash(tampered2));
    // a tampered canonical hash is detectable downstream: recompute and compare
    const stored = contentHash(original);
    expect(contentHash(JSON.parse(canonicalSerialize(original)))).toBe(stored);
    expect(contentHash(JSON.parse(canonicalSerialize(tampered)))).not.toBe(stored);
  });
});
