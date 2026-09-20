import { describe, expect, it } from 'vitest';
import {
  canonicalCompositionText,
  compositionArtifactId,
  compositionHash,
  createPackageComposition,
  mintRandomArtifactId,
  validateCompositionArtifact,
} from '../src/index.js';
import type { CreateCompositionInput, PackageCompositionArtifact } from '../src/index.js';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  GOLDEN_COMPOSITION,
  T0,
  goldenCompositionInput,
  sampleCompositionArtifact,
  sampleCompositionContent,
} from './helpers.js';

describe('composition creation (positive)', () => {
  it('mints deterministic content-addressed sos://PackageComposition ids', () => {
    const artifact = sampleCompositionArtifact();
    expect(artifact.envelope.id).toMatch(/^sos:\/\/PackageComposition\/[0-9a-f]{32}$/);
    expect(artifact.envelope.id).toBe(
      compositionArtifactId({ content: sampleCompositionContent(), provenance: ['w6:test'], created_at: T0 }),
    );
    expect(sampleCompositionArtifact().envelope.id).toBe(artifact.envelope.id);
    const other = sampleCompositionArtifact({
      content: sampleCompositionContent({ semantic_capability: 'another-composed-capability' }),
    });
    expect(other.envelope.id).not.toBe(artifact.envelope.id);
  });

  it('the envelope kind is always PackageComposition (a frozen core kind — no registration)', () => {
    const artifact = sampleCompositionArtifact();
    expect(artifact.envelope.kind).toBe('PackageComposition');
    expect(artifact.envelope.status).toBe('DRAFT');
    expect(artifact.envelope.version).toBe(1);
    expect(artifact.envelope.supersedes).toBeNull();
  });

  it('validates through the full artifact validator', () => {
    expect(validateCompositionArtifact(sampleCompositionArtifact())).toBe(true);
    expect(validateCompositionArtifact(GOLDEN_COMPOSITION)).toBe(true);
    expect(validateCompositionArtifact(null)).toBe(false);
    expect(validateCompositionArtifact({ envelope: GOLDEN_COMPOSITION.envelope })).toBe(false);
  });

  it('canonical text round trips byte-identically (spine canonical serializer)', () => {
    const artifact = sampleCompositionArtifact();
    const text = canonicalCompositionText(artifact);
    const parsed = JSON.parse(text) as PackageCompositionArtifact;
    expect(canonicalCompositionText(parsed)).toBe(text);
    expect(parsed).toEqual(artifact);
    expect(compositionHash(artifact)).toBe(compositionHash(parsed));
    expect(canonicalSerialize(artifact)).toBe(canonicalSerialize(parsed));
  });

  it('explicit ids are accepted only as well-formed PackageComposition ids (random minting flow)', () => {
    const explicit = mintRandomArtifactId('PackageComposition');
    const artifact = createPackageComposition({
      ...goldenCompositionInput(),
      id: explicit,
    });
    expect(artifact.envelope.id).toBe(explicit);
    expect(() =>
      createPackageComposition({ ...goldenCompositionInput(), id: 'sos://Package/' + '9'.repeat(32) }),
    ).toThrow(/PackageComposition id/);
    expect(() => createPackageComposition({ ...goldenCompositionInput(), id: 'junk' })).toThrow(/well-formed/);
  });

  it('creation input discipline (provenance, RFC3339, object shape)', () => {
    const base: CreateCompositionInput = {
      content: sampleCompositionContent(),
      provenance: ['w6:test'],
      created_at: T0,
    };
    expect(() => createPackageComposition(null as never)).toThrow(/must be an object/);
    expect(() => createPackageComposition({ ...base, provenance: [] })).toThrow(/provenance/);
    expect(() => createPackageComposition({ ...base, created_at: 'soon' })).toThrow(/RFC3339/);
  });
});

describe('golden fixture reproduction (bit-exact)', () => {
  it('reproduces the golden composition bit-exactly (content addressing)', () => {
    const artifact = createPackageComposition(goldenCompositionInput());
    expect(artifact).toEqual(GOLDEN_COMPOSITION);
    expect(canonicalCompositionText(artifact)).toBe(canonicalCompositionText(GOLDEN_COMPOSITION));
    expect(artifact.envelope.id).toBe(GOLDEN_COMPOSITION.envelope.id);
    expect(compositionArtifactId(goldenCompositionInput())).toBe(GOLDEN_COMPOSITION.envelope.id);
  });

  it('the golden composition references the golden fixture packages as members', () => {
    const memberIds = GOLDEN_COMPOSITION.content.members.map((member) => member.package_id);
    expect(memberIds).toHaveLength(2);
    expect(new Set(memberIds).size).toBe(2);
    for (const memberId of memberIds) {
      expect(memberId).toMatch(/^sos:\/\/Package\/[0-9a-f]{32}$/);
    }
  });
});

describe('members and bindings (the wiring model)', () => {
  it('allows the same package in two distinct roles (two instances)', () => {
    const artifact = sampleCompositionArtifact({
      content: sampleCompositionContent({
        members: [
          { package_id: GOLDEN_COMPOSITION.content.members[0]!.package_id, role: 'cache-a', bound_contracts: ['sos://schema/trace-link'] },
          { package_id: GOLDEN_COMPOSITION.content.members[0]!.package_id, role: 'cache-b', bound_contracts: ['sos://schema/trace-link'] },
        ],
        bindings: [
          { kind: 'DATA_FLOW', source_role: 'cache-a', target_role: 'cache-b', contract: 'contract:sample-composed/v1', wiring: {} },
        ],
      }),
    });
    expect(artifact.content.members).toHaveLength(2);
    expect(new Set(artifact.content.members.map((member) => member.role))).toEqual(new Set(['cache-a', 'cache-b']));
  });

  it('carries preconditions, postconditions, applicability, obligations and diversity profile', () => {
    const artifact = sampleCompositionArtifact();
    expect(artifact.content.preconditions).toEqual(['members are registered']);
    expect(artifact.content.postconditions).toEqual(['the composed capability is realized']);
    expect(artifact.content.applicability).toHaveLength(1);
    expect(artifact.content.assurance_obligations).toHaveLength(1);
    expect(artifact.content.diversity_profile.family).toBe('write-through-store');
    expect(artifact.content.changes).toBe('initial composition hypothesis');
  });
});
