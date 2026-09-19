import { describe, expect, it } from 'vitest';
import {
  ArtifactIdRegistry,
  buildArtifactId,
  deriveDeterministicArtifactId,
  fullContentHash,
  isArtifactId,
  isRegisteredArtifactKind,
  mintRandomArtifactId,
  parseArtifactId,
} from '../src/index.js';

const H32 = 'a'.repeat(32);

describe('artifact id shape', () => {
  it('accepts well-formed ids', () => {
    expect(isArtifactId(`sos://Mission/${H32}`)).toBe(true);
    expect(isArtifactId(`sos://ImplementationModel/${'0'.repeat(32)}`)).toBe(true);
    expect(isArtifactId(`sos://X9/${'f'.repeat(32)}`)).toBe(true);
  });

  it('rejects malformed ids', () => {
    for (const bad of [
      '',
      'mission:x',
      'sos:/Mission/' + H32,
      'sos://Mission/' + 'a'.repeat(31),
      'sos://Mission/' + 'a'.repeat(33),
      'sos://Mission/' + 'A'.repeat(32), // uppercase hex not allowed
      'sos://Mission/' + 'g'.repeat(32), // not hex
      'sos://Mission',
      'sos://Mission/',
      'SOS://Mission/' + H32,
      'sos://Mission/' + H32 + '/extra',
      42,
      null,
      undefined,
      {},
    ]) {
      expect(isArtifactId(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('id GRAMMAR is permissive about kind case; PascalCase is enforced at registration (layered)', () => {
    // sos://mission/... parses (grammar-level), but 'mission' can never be a
    // REGISTERED kind (registration requires PascalCase), so semantic-layer
    // validation (envelopes, traces via kinds) still rejects it.
    const lower = 'sos://mission/' + H32;
    expect(isArtifactId(lower)).toBe(true);
    expect(parseArtifactId(lower).kind).toBe('mission');
    expect(isRegisteredArtifactKind('mission')).toBe(false);
  });

  it('parses ids into kind and segment', () => {
    const parsed = parseArtifactId(`sos://Evidence/${H32}`);
    expect(parsed).toEqual({ kind: 'Evidence', segment: H32 });
    expect(() => parseArtifactId('not-an-id')).toThrow(/malformed/);
  });

  it('builds ids and validates inputs', () => {
    expect(buildArtifactId('Mission', H32)).toBe(`sos://Mission/${H32}`);
    expect(() => buildArtifactId('mission', H32)).toThrow(/kind/);
    expect(() => buildArtifactId('Mission', 'xyz')).toThrow(/segment/);
  });
});

describe('random minting (UUID-backed)', () => {
  it('mints well-formed unique ids per kind', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const id = mintRandomArtifactId('Evidence');
      expect(isArtifactId(id)).toBe(true);
      expect(parseArtifactId(id).kind).toBe('Evidence');
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(1000);
  });

  it('rejects invalid kinds', () => {
    expect(() => mintRandomArtifactId('lowercase')).toThrow(/kind/);
  });
});

describe('deterministic minting (content-addressed)', () => {
  it('derives the same id for the same content, across calls and key reordering', () => {
    const a = deriveDeterministicArtifactId('Mission', { b: 1, a: 2 });
    const b = deriveDeterministicArtifactId('Mission', { a: 2, b: 1 });
    expect(a).toBe(b);
    expect(isArtifactId(a)).toBe(true);
    // segment = first 32 hex of sha-256 over the canonical serialization
    expect(a).toBe(`sos://Mission/${fullContentHash({ a: 2, b: 1 }).slice(0, 32)}`);
  });

  it('derives different ids for different content', () => {
    const a = deriveDeterministicArtifactId('Mission', { a: 1 });
    const b = deriveDeterministicArtifactId('Mission', { a: 2 });
    expect(a).not.toBe(b);
  });

  it('uses the kind as the id namespace (same content, different kinds -> different ids)', () => {
    const content = { same: true };
    const mission = deriveDeterministicArtifactId('Mission', content);
    const decision = deriveDeterministicArtifactId('Decision', content);
    expect(mission).not.toBe(decision);
    expect(parseArtifactId(mission).kind).toBe('Mission');
    expect(parseArtifactId(decision).kind).toBe('Decision');
  });

  it('is stable across separate derivation rounds (no hidden state, no clock)', () => {
    const first = [1, 2, 3].map((i) => deriveDeterministicArtifactId('Evidence', { round: 1, i }));
    const second = [1, 2, 3].map((i) => deriveDeterministicArtifactId('Evidence', { i, round: 1 }));
    expect(first).toEqual(second);
  });

  it('rejects invalid kinds', () => {
    expect(() => deriveDeterministicArtifactId('not-a-kind', {})).toThrow(/kind/);
  });
});

describe('ArtifactIdRegistry (collision detection)', () => {
  it('is idempotent for the same content (same id returned)', () => {
    const registry = new ArtifactIdRegistry();
    const first = registry.registerDeterministic('Mission', { x: 1 });
    const second = registry.registerDeterministic('Mission', { x: 1 });
    expect(first).toBe(second);
    expect(registry.size).toBe(1);
    expect(registry.has(first)).toBe(true);
    expect(registry.resolve(first)).toEqual({ id: first, kind: 'Mission', contentHash: fullContentHash({ x: 1 }) });
  });

  it('registers different content under different ids', () => {
    const registry = new ArtifactIdRegistry();
    const a = registry.registerDeterministic('Mission', { x: 1 });
    const b = registry.registerDeterministic('Mission', { x: 2 });
    expect(a).not.toBe(b);
    expect(registry.size).toBe(2);
    expect(registry.list()).toHaveLength(2);
    // deterministic listing order
    expect(registry.list().map((e) => e.id)).toEqual([...registry.list().map((e) => e.id)].sort());
  });

  it('never collides silently: same id with a different content hash throws', () => {
    const registry = new ArtifactIdRegistry();
    const id = registry.registerDeterministic('Mission', { x: 1 });
    const foreignHash = 'b'.repeat(64);
    expect(() => registry.register(id, 'Mission', foreignHash)).toThrow(/collision/);
    // registry state unchanged
    expect(registry.resolve(id)?.contentHash).toBe(fullContentHash({ x: 1 }));
  });

  it('re-registering the same (id, hash) pair is idempotent (durable-storage reload)', () => {
    const registry = new ArtifactIdRegistry();
    const id = registry.registerDeterministic('Mission', { x: 1 });
    const hash = fullContentHash({ x: 1 });
    expect(() => registry.register(id, 'Mission', hash)).not.toThrow();
    expect(registry.size).toBe(1);
  });

  it('rejects kind mismatches and malformed inputs on low-level registration', () => {
    const registry = new ArtifactIdRegistry();
    expect(() => registry.register('garbage', 'Mission', null)).toThrow(/malformed/);
    const id = registry.registerDeterministic('Mission', { x: 1 });
    expect(() => registry.register(id, 'Evidence', 'c'.repeat(64))).toThrow(/kind mismatch/);
    expect(() => registry.register(`sos://Mission/${'d'.repeat(32)}`, 'Mission', 'short')).toThrow(/content hash/);
  });

  it('random registration never returns an existing id', () => {
    const registry = new ArtifactIdRegistry();
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      ids.add(registry.registerRandom('Package'));
    }
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(registry.resolve(id)?.contentHash).toBeNull();
    }
  });
});
