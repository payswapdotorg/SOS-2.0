import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateArchitectureDelta } from '@sos-2/semantic-spine';
import {
  canonicalSystemStateText,
  createSystemState,
  createSystemStateStore,
  listEnvRelationshipKinds,
  registerEnvRelationshipKind,
  systemStateArtifactId,
  systemStateCreationAddress,
  systemStateHash,
  validateSystemStateArtifact,
  validateSystemStateContent,
  SystemStateStore,
  REVISION_KINDS,
  isExactRevision,
} from '../src/index.js';
import type { ArtifactEnvelope } from '@sos-2/semantic-spine';
import { isCanonicalText } from '@sos-2/semantic-spine';
import {
  AUTHORITY_ID,
  CREATED_AT,
  PROVENANCE,
  emptySectionsContent,
  hex32,
  validContent,
} from './helpers.js';

describe('W2 architecture delta record', () => {
  it('is a valid Architecture Delta per the spine validator', async () => {
    const deltaPath = fileURLToPath(new URL('../W2.architecture-delta.json', import.meta.url));
    const delta = JSON.parse(await readFile(deltaPath, 'utf8'));
    expect(validateArchitectureDelta(delta)).toBe(true);
    expect(delta.work_order).toBe('W2');
    expect(delta.affected_artifacts).toEqual([
      'packages/system-state',
      'packages/architecture',
      'packages/conformance',
    ]);
    expect(delta.preserved_invariants.length).toBeGreaterThan(0);
    expect(delta.added.length).toBeGreaterThan(0);
  });
});

describe('system state creation', () => {
  it('creates a valid artifact with a SystemState envelope', () => {
    const artifact = createSystemState({
      content: validContent(),
      provenance: PROVENANCE,
      created_at: CREATED_AT,
      authority_ref: AUTHORITY_ID,
    });
    expect(artifact.envelope.kind).toBe('SystemState');
    expect(artifact.envelope.version).toBe(1);
    expect(artifact.envelope.status).toBe('DRAFT');
    expect(artifact.envelope.provenance).toEqual(PROVENANCE);
    expect(validateSystemStateArtifact(artifact)).toBe(true);
  });

  it('identity is deterministic and content-addressed over the creation address', () => {
    const input = {
      content: validContent(),
      provenance: PROVENANCE,
      created_at: CREATED_AT,
    };
    const a = createSystemState(input);
    const b = createSystemState({ ...input, content: validContent() });
    expect(a.envelope.id).toBe(b.envelope.id);
    expect(a.envelope.id).toBe(systemStateArtifactId(input));
    expect(a.envelope.id).toMatch(/^sos:\/\/SystemState\/[0-9a-f]{32}$/);

    const address = systemStateCreationAddress(input);
    expect(address.kind).toBe('SystemState');
    expect(address.content).toEqual(validContent());
  });

  it('different content produces a different id', () => {
    const a = createSystemState({ content: validContent(), provenance: PROVENANCE, created_at: CREATED_AT });
    const b = createSystemState({ content: emptySectionsContent(), provenance: PROVENANCE, created_at: CREATED_AT });
    expect(a.envelope.id).not.toBe(b.envelope.id);
  });

  it('canonical serialization round trips and is canonical', () => {
    const artifact = createSystemState({ content: validContent(), provenance: PROVENANCE, created_at: CREATED_AT });
    const text = canonicalSystemStateText(artifact);
    expect(isCanonicalText(text)).toBe(true);
    const roundTripped = JSON.parse(text) as { envelope: ArtifactEnvelope };
    expect(roundTripped.envelope.id).toBe(artifact.envelope.id);
    expect(systemStateHash(artifact)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts fully empty sections (progressive system state)', () => {
    const artifact = createSystemState({
      content: emptySectionsContent(),
      provenance: PROVENANCE,
      created_at: CREATED_AT,
    });
    expect(validateSystemStateArtifact(artifact)).toBe(true);
    expect(validateSystemStateContent(emptySectionsContent())).toBe(true);
  });
});

describe('exact revisions', () => {
  it('exposes the frozen revision kind vocabulary', () => {
    expect(REVISION_KINDS).toEqual(['git-sha', 'deployment-id', 'config-version']);
    expect(isExactRevision({ kind: 'git-sha', value: 'abc' })).toBe(true);
    expect(isExactRevision({ kind: 'nope', value: 'abc' })).toBe(false);
    expect(isExactRevision({ kind: 'git-sha', value: '' })).toBe(false);
    expect(isExactRevision({ kind: 'git-sha' })).toBe(false);
  });

  it('a full SystemState passes content validation with exact revisions present', () => {
    expect(validateSystemStateContent(validContent())).toBe(true);
  });
});

describe('environment relationship registry', () => {
  it('seeds the four canonical kinds (sorted, deterministic)', () => {
    expect(listEnvRelationshipKinds()).toEqual(['depends-on', 'isolated-from', 'mirrors', 'promotes-to']);
  });

  it('supports explicit extension and rejects duplicates/bad formats', () => {
    registerEnvRelationshipKind('canary-from');
    expect(listEnvRelationshipKinds()).toContain('canary-from');
    expect(() => registerEnvRelationshipKind('canary-from')).toThrow(/already registered/);
    expect(() => registerEnvRelationshipKind('Bad_Kind')).toThrow(/kebab-case/);
    expect(() => registerEnvRelationshipKind('')).toThrow(/kebab-case/);
  });
});

describe('system state store history', () => {
  it('registers roots and rejects unknown ids on query', () => {
    const root = createSystemState({
      content: emptySectionsContent(),
      provenance: PROVENANCE,
      created_at: CREATED_AT,
      status: 'ACTIVE',
    });
    const store = createSystemStateStore([root]);
    expect(store.size).toBe(1);
    expect(store.has(root.envelope.id)).toBe(true);
    expect(store.history(root.envelope.id)).toHaveLength(1);
    expect(() => store.history(`sos://SystemState/${hex32('missing')}`)).toThrow(/unknown system state id/);
  });

  it('supersede builds a contiguous, linear, queryable chain', () => {
    const rootContent = emptySectionsContent();
    const root = createSystemState({
      content: rootContent,
      provenance: PROVENANCE,
      created_at: '2025-06-01T00:00:00.000Z',
      status: 'ACTIVE',
    });
    const store = new SystemStateStore();
    store.put(root);

    const first = store.supersede(root.envelope.id, {
      content: { ...rootContent, policy: [{ policy_id: 'deployment-policy', version: 1 }] },
      provenance: ['W2:policy-activated'],
      created_at: '2025-06-02T00:00:00.000Z',
    });
    expect(first.previous.envelope.status).toBe('SUPERSEDED');
    expect(first.supersededBy.envelope.version).toBe(2);
    expect(first.supersededBy.envelope.supersedes).toBe(root.envelope.id);
    expect(first.supersededBy.envelope.status).toBe('ACTIVE');
    expect(first.supersededBy.envelope.authority_ref).toBe(root.envelope.authority_ref);

    const second = store.supersede(first.supersededBy.envelope.id, {
      content: validContent(),
      provenance: ['W2:full-state'],
      created_at: '2025-06-03T00:00:00.000Z',
    });

    const chain = store.history(root.envelope.id);
    expect(chain.map((a) => a.envelope.version)).toEqual([1, 2, 3]);
    expect(chain[0]!.envelope.id).toBe(root.envelope.id);
    expect(chain[2]!.envelope.id).toBe(second.supersededBy.envelope.id);
    expect(store.history(second.supersededBy.envelope.id)).toEqual(chain);
    expect(store.latest(root.envelope.id).envelope.id).toBe(second.supersededBy.envelope.id);
    expect(store.isLatest(root.envelope.id)).toBe(false);
    expect(store.isLatest(second.supersededBy.envelope.id)).toBe(true);
    expect(store.size).toBe(3);

    // the previous revision is now SUPERSEDED in the store
    expect(store.get(root.envelope.id)!.envelope.status).toBe('SUPERSEDED');
  });

  it('setStatus performs validated lifecycle transitions and preserves identity', () => {
    const root = createSystemState({
      content: emptySectionsContent(),
      provenance: PROVENANCE,
      created_at: CREATED_AT,
    });
    const store = createSystemStateStore([root]);
    const active = store.setStatus(root.envelope.id, 'ACTIVE');
    expect(active.envelope.status).toBe('ACTIVE');
    expect(active.envelope.id).toBe(root.envelope.id);
    expect(() => store.setStatus(root.envelope.id, 'DRAFT')).toThrow(/invalid status transition/);
  });
});
