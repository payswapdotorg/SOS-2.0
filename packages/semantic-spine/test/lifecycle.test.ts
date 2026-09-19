import { describe, expect, it } from 'vitest';
import {
  ALLOWED_STATUS_TRANSITIONS,
  ARTIFACT_STATUSES,
  EnvelopeStore,
  LifecycleError,
  canTransition,
  createEnvelope,
  deriveDeterministicArtifactId,
  transitionStatus,
  validateEnvelope,
  withStatus,
} from '../src/index.js';
import type { ArtifactStatus } from '../src/index.js';

const H = 'a'.repeat(32);
const CONSTITUTION = `sos://Constitution/${H}`;

function validInput() {
  return {
    kind: 'Mission' as const,
    provenance: ['w0.5:test'],
    created_at: '2025-01-01T00:00:00Z',
  };
}

describe('status vocabulary and transitions', () => {
  it('documents the full transition table', () => {
    expect(ALLOWED_STATUS_TRANSITIONS).toEqual({
      DRAFT: ['ACTIVE', 'RETIRED'],
      ACTIVE: ['SUPERSEDED', 'RETIRED'],
      SUPERSEDED: [],
      RETIRED: [],
    });
    expect([...ARTIFACT_STATUSES]).toEqual(['DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED']);
  });

  it('allows exactly the legal transitions', () => {
    const legal: Array<[ArtifactStatus, ArtifactStatus]> = [
      ['DRAFT', 'ACTIVE'],
      ['DRAFT', 'RETIRED'],
      ['ACTIVE', 'SUPERSEDED'],
      ['ACTIVE', 'RETIRED'],
    ];
    for (const [from, to] of legal) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
      expect(transitionStatus(from, to)).toBe(to);
    }
  });

  it('rejects every illegal transition (terminal states, reversals, skips)', () => {
    const illegal: Array<[ArtifactStatus, ArtifactStatus]> = [
      ['DRAFT', 'DRAFT'],
      ['DRAFT', 'SUPERSEDED'],
      ['ACTIVE', 'DRAFT'],
      ['ACTIVE', 'ACTIVE'],
      ['SUPERSEDED', 'ACTIVE'],
      ['SUPERSEDED', 'DRAFT'],
      ['SUPERSEDED', 'RETIRED'],
      ['SUPERSEDED', 'SUPERSEDED'],
      ['RETIRED', 'ACTIVE'],
      ['RETIRED', 'DRAFT'],
      ['RETIRED', 'SUPERSEDED'],
      ['RETIRED', 'RETIRED'],
    ];
    for (const [from, to] of illegal) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      expect(() => transitionStatus(from, to), `${from} -> ${to}`).toThrow(LifecycleError);
    }
    expect(() => transitionStatus('WEIRD' as ArtifactStatus, 'ACTIVE')).toThrow(/unknown/);
  });
});

describe('createEnvelope', () => {
  it('creates a DRAFT envelope by default with a deterministic content-addressed id', () => {
    const envelope = createEnvelope(validInput());
    expect(envelope.status).toBe('DRAFT');
    expect(envelope.version).toBe(1);
    expect(envelope.kind).toBe('Mission');
    expect(envelope.supersedes).toBeNull();
    expect(envelope.authority_ref).toBeNull();
    const expectedId = deriveDeterministicArtifactId('Mission', {
      kind: 'Mission',
      version: 1,
      status: 'DRAFT',
      authority_ref: null,
      provenance: ['w0.5:test'],
      created_at: '2025-01-01T00:00:00Z',
      supersedes: null,
    });
    expect(envelope.id).toBe(expectedId);
    expect(validateEnvelope(envelope)).toBe(true);
  });

  it('is deterministic: identical inputs produce identical envelopes', () => {
    expect(createEnvelope(validInput())).toEqual(createEnvelope(validInput()));
  });

  it('accepts ACTIVE creation (used by supersede) but never terminal states', () => {
    expect(createEnvelope({ ...validInput(), status: 'ACTIVE' }).status).toBe('ACTIVE');
    expect(() => createEnvelope({ ...validInput(), status: 'SUPERSEDED' })).toThrow(/terminal/);
    expect(() => createEnvelope({ ...validInput(), status: 'RETIRED' })).toThrow(/terminal/);
  });

  it('validates every field with SOS discipline', () => {
    const cases: Array<[string, object]> = [
      ['unregistered kind', { ...validInput(), kind: 'NotARegisteredKind' }],
      ['bad kind format', { ...validInput(), kind: 'lower' }],
      ['version 0', { ...validInput(), version: 0 }],
      ['version negative', { ...validInput(), version: -1 }],
      ['version fractional', { ...validInput(), version: 1.5 }],
      ['version string', { ...validInput(), version: '1' }],
      ['empty provenance', { ...validInput(), provenance: [] }],
      ['provenance not array', { ...validInput(), provenance: 'x' }],
      ['provenance empty entry', { ...validInput(), provenance: ['ok', ''] }],
      ['created_at not RFC3339', { ...validInput(), created_at: 'January 1, 2025' }],
      ['created_at date only', { ...validInput(), created_at: '2025-01-01' }],
      ['created_at missing timezone', { ...validInput(), created_at: '2025-01-01T00:00:00' }],
      ['created_at not a string', { ...validInput(), created_at: 1735689600000 }],
      ['authority_ref malformed', { ...validInput(), authority_ref: 'not-an-id' }],
      ['authority_ref empty', { ...validInput(), authority_ref: '' }],
      ['supersedes malformed', { ...validInput(), supersedes: 'nope' }],
    ];
    for (const [name, input] of cases) {
      expect(() => createEnvelope(input as never), name).toThrow(LifecycleError);
    }
  });

  it('accepts RFC3339 variants (offsets, fractional seconds, lowercase t/z)', () => {
    for (const created_at of [
      '2025-01-01T00:00:00Z',
      '2025-01-01t00:00:00z',
      '2025-01-01T00:00:00.123456Z',
      '2025-01-01T00:00:00+02:00',
      '2025-01-01T00:00:00-05:30',
    ]) {
      expect(createEnvelope({ ...validInput(), created_at }).created_at).toBe(created_at);
    }
  });

  it('accepts an explicit id only when well-formed and kind-matched', () => {
    const id = `sos://Mission/${'b'.repeat(32)}`;
    const envelope = createEnvelope({ ...validInput(), id });
    expect(envelope.id).toBe(id);
    expect(() => createEnvelope({ ...validInput(), id: 'garbage' })).toThrow(/id/);
    expect(() => createEnvelope({ ...validInput(), id: `sos://Evidence/${'b'.repeat(32)}` })).toThrow(/kind mismatch/);
  });
});

describe('validateEnvelope (full semantic validation)', () => {
  const good = createEnvelope({ ...validInput(), authority_ref: CONSTITUTION });

  it('accepts a valid envelope and its JSON round trip', () => {
    expect(validateEnvelope(good)).toBe(true);
    expect(validateEnvelope(JSON.parse(JSON.stringify(good)))).toBe(true);
  });

  it('rejects shape violations and semantic violations', () => {
    expect(validateEnvelope(null)).toBe(false);
    expect(validateEnvelope({ ...good, extra: 1 })).toBe(false);
    expect(validateEnvelope({ ...good, status: 'PUBLISHED' })).toBe(false);
    // semantic layer: id/kind mismatch
    expect(validateEnvelope({ ...good, id: `sos://Evidence/${H}` })).toBe(false);
    // unregistered kind
    expect(validateEnvelope({ ...good, kind: 'NotARegisteredKind' })).toBe(false);
    // malformed created_at passes the contracts guard but fails the spine layer
    expect(validateEnvelope({ ...good, created_at: 'not-a-date' })).toBe(false);
    // empty provenance passes the contracts guard but fails the spine layer
    expect(validateEnvelope({ ...good, provenance: [] })).toBe(false);
  });
});

describe('withStatus (immutable transition)', () => {
  it('returns a new envelope with the id preserved', () => {
    const draft = createEnvelope(validInput());
    const active = withStatus(draft, 'ACTIVE');
    expect(active.status).toBe('ACTIVE');
    expect(active.id).toBe(draft.id);
    expect(draft.status).toBe('DRAFT'); // original untouched
    const retired = withStatus(active, 'RETIRED');
    expect(retired.status).toBe('RETIRED');
    expect(retired.id).toBe(draft.id);
  });

  it('refuses illegal transitions', () => {
    const draft = createEnvelope(validInput());
    expect(() => withStatus(draft, 'SUPERSEDED')).toThrow(/invalid status transition/);
    const retired = withStatus(draft, 'RETIRED');
    expect(() => withStatus(retired, 'ACTIVE')).toThrow(/invalid status transition/);
  });
});

describe('EnvelopeStore', () => {
  it('stores and retrieves envelopes', () => {
    const store = new EnvelopeStore();
    const envelope = createEnvelope(validInput());
    store.put(envelope);
    expect(store.has(envelope.id)).toBe(true);
    expect(store.get(envelope.id)).toEqual(envelope);
    expect(store.size).toBe(1);
    expect(store.list()).toEqual([envelope]);
  });

  it('rejects invalid envelopes', () => {
    const store = new EnvelopeStore();
    expect(() => store.put({ id: 'x' } as never)).toThrow(LifecycleError);
  });

  it('rejects duplicate ids (envelopes are immutable; supersede instead)', () => {
    const store = new EnvelopeStore();
    const envelope = createEnvelope(validInput());
    store.put(envelope);
    expect(() => store.put(envelope)).toThrow(/already registered/);
    expect(() => store.put({ ...envelope, status: 'ACTIVE' })).toThrow(/already registered/);
  });

  it('enforces: supersedes must reference an existing id', () => {
    const store = new EnvelopeStore();
    const ghost = `sos://Mission/${'c'.repeat(32)}`;
    const envelope = createEnvelope({ ...validInput(), supersedes: ghost });
    expect(() => store.put(envelope)).toThrow(/supersedes target is not registered/);
    // once the target exists, the same envelope is accepted
    const target = createEnvelope({ ...validInput(), id: ghost, provenance: ['w0.5:target'] });
    store.put(target);
    expect(() => store.put(envelope)).not.toThrow();
  });

  it('rejects self-supersession', () => {
    const store = new EnvelopeStore();
    const envelope = createEnvelope(validInput());
    // force a self-supersede via explicit id
    const selfSup = createEnvelope({ ...validInput(), supersedes: envelope.id, id: envelope.id });
    store.put(envelope);
    // remove envelope to isolate the self-check: put a fresh store instead
    const store2 = new EnvelopeStore();
    store2.put(envelope);
    expect(() => store2.put(selfSup)).toThrow(/cannot supersede itself/);
  });

  it('setStatus validates transitions', () => {
    const store = new EnvelopeStore();
    const envelope = createEnvelope(validInput());
    store.put(envelope);
    expect(store.setStatus(envelope.id, 'ACTIVE').status).toBe('ACTIVE');
    expect(() => store.setStatus(envelope.id, 'DRAFT')).toThrow(/invalid status transition/);
    expect(() => store.setStatus(`sos://Mission/${'d'.repeat(32)}`, 'ACTIVE')).toThrow(/unknown artifact id/);
  });

  it('supersede(): old becomes SUPERSEDED, new version is ACTIVE with version bump and inherited authority', () => {
    const store = new EnvelopeStore();
    const v1 = createEnvelope({ ...validInput(), authority_ref: CONSTITUTION });
    store.put(v1);
    store.setStatus(v1.id, 'ACTIVE');
    const { previous, supersededBy } = store.supersede(v1.id, {
      provenance: ['w0.5:v2'],
      created_at: '2025-06-01T00:00:00Z',
    });
    expect(previous.status).toBe('SUPERSEDED');
    expect(supersededBy.status).toBe('ACTIVE');
    expect(supersededBy.kind).toBe('Mission');
    expect(supersededBy.version).toBe(2);
    expect(supersededBy.supersedes).toBe(v1.id);
    expect(supersededBy.authority_ref).toBe(CONSTITUTION); // inherited
    expect(supersededBy.id).not.toBe(v1.id);
    expect(store.get(v1.id)?.status).toBe('SUPERSEDED');
    expect(store.get(supersededBy.id)?.status).toBe('ACTIVE');
  });

  it('supersede(): only ACTIVE artifacts can be superseded', () => {
    const store = new EnvelopeStore();
    const draft = createEnvelope(validInput());
    store.put(draft);
    expect(() => store.supersede(draft.id, { provenance: ['x'], created_at: '2025-01-01T00:00:00Z' })).toThrow(
      /cannot supersede/,
    );
    store.setStatus(draft.id, 'RETIRED');
    expect(() => store.supersede(draft.id, { provenance: ['x'], created_at: '2025-01-01T00:00:00Z' })).toThrow(
      /cannot supersede/,
    );
  });

  it('supersede(): unknown id throws', () => {
    const store = new EnvelopeStore();
    expect(() => store.supersede(`sos://Mission/${'e'.repeat(32)}`, {
      provenance: ['x'],
      created_at: '2025-01-01T00:00:00Z',
    })).toThrow(/unknown artifact id/);
  });
});
