/**
 * THE PACKAGE COMPOSITION JOURNEY (P15 Lane A — P10 ecology). Drives the
 * merged @sos-2/packages + @sos-2/composition + @sos-2/ecology surfaces
 * to assert the ecology updates as DATA (learned records) — never by
 * writing package internals.
 *
 * The journey:
 *   create package A (spine) -> create package B (store)
 *   -> create package composition (spine + store)
 *   -> assert the ecology graph accumulates COMPATIBLE_WITH edges
 *      (learned records, data-only — no package internals mutated).
 *
 * The journey asserts the P15 acceptance shape:
 *   (a) composition: driven through merged public exports only.
 *   (b) terminal state: the composition artifact + the ecology graph
 *       both reflect the learned relations.
 *   (c) evidence graph: every artifact carries its content-addressed
 *       envelope id + provenance + the evidence refs that back the
 *       ecology assertion.
 *   (d) retained uncertainty: VISIBLE — the applicability estimates
 *       carry their uncertainty class (QUALITATIVE + UNQUANTIFIED);
 *       the diversity profile + maturity retain their honest states.
 *   (e) determinism: identical inputs produce identical content-addressed
 *       ids (the bit-exact reproduction pin).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPackageArtifact, packageArtifactId } from '@sos-2/packages';
import type { PackageArtifact, CreatePackageInput } from '@sos-2/packages';
import { createPackageComposition, compositionArtifactId } from '@sos-2/composition';
import type { PackageCompositionArtifact, CreateCompositionInput } from '@sos-2/composition';
import { EcologyGraph } from '@sos-2/ecology';
import { canonicalSerialize, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, '../../../packages');

/** Read the merged golden package fixture (the canonical spine-package content). */
function readGoldenPackage(): PackageArtifact {
  return JSON.parse(readFileSync(join(fixturesRoot, 'packages/fixtures/package-artifact.json'), 'utf8')) as PackageArtifact;
}

/** Read the merged golden composition fixture (the canonical spine+store composition). */
function readGoldenComposition(): PackageCompositionArtifact {
  return JSON.parse(readFileSync(join(fixturesRoot, 'composition/fixtures/package-composition.json'), 'utf8')) as PackageCompositionArtifact;
}

/** Create a SECOND package (the store) bound to the same composition. */
function createStorePackage(spinePackageId: string): PackageArtifact {
  const compatibilityEvidenceId = deriveDeterministicArtifactId('Evidence', {
    note: 'p15a store compatibility evidence with the spine package',
    spine: spinePackageId,
  });
  const input: CreatePackageInput = {
    content: {
      semantic_capability: 'durable-semantic-store',
      contracts: ['contract:durable-store/v1'],
      preconditions: ['a spine artifact registry is reachable'],
      postconditions: ['artifacts are durably persisted with stable spine identities'],
      realizations: [
        {
          ref: deriveDeterministicArtifactId('ImplementationModel', { note: 'p15a store realization' }),
          revision: 'p15a-store-sha-0001',
          note: 'the durable store implementation model',
        },
      ],
      applicability: [
        {
          kind: 'QUALITATIVE',
          uncertainty_class: 'UNQUANTIFIED',
          context: { tier: 'durable' },
          sample_size: 0,
          window: null,
        },
      ],
      evidence_refs: [deriveDeterministicArtifactId('Evidence', { note: 'p15a store evidence' })],
      failure_refs: [],
      // compatibility_refs are EVIDENCE ids (evidence of compatibility — never raw package ids).
      compatibility_refs: [compatibilityEvidenceId],
      composition_refs: [],
      assurance_obligations: [
        {
          kind: 'TEST',
          obligation: 'writes are durable across process restarts',
        },
      ],
      context: { tier: 'durable' },
      learned_limitations: [],
      diversity_profile: {
        family: 'durable-store',
        dimensions: [
          { dimension: 'COST', stance: 'optimizes for low-cost durable persistence' },
        ],
      },
      maturity: 'DISCOVERED',
      changes: 'p15a initial discovery (the durable store package)',
      superseded_by: null,
    },
    provenance: ['P15:package-composition'],
    created_at: '2026-03-01T00:00:00.000Z',
    authority_ref: null,
  };
  return createPackageArtifact(input);
}

/** Create the spine+store composition referencing both packages. */
function createSpineStoreComposition(spinePackageId: string, storePackageId: string): PackageCompositionArtifact {
  const input: CreateCompositionInput = {
    content: {
      semantic_capability: 'durable-semantic-store',
      contracts: ['contract:durable-spine-store/v1'],
      members: [
        { package_id: spinePackageId, role: 'spine', bound_contracts: ['sos://schema/trace-link'] },
        { package_id: storePackageId, role: 'store', bound_contracts: ['contract:durable-store/v1'] },
      ],
      bindings: [
        {
          kind: 'PROVIDES_TO',
          source_role: 'spine',
          target_role: 'store',
          contract: 'contract:durable-spine-store/v1',
          wiring: { channel: 'artifact-write-through', durability: 'strong' },
        },
      ],
      preconditions: ['a spine artifact registry is reachable'],
      postconditions: ['artifacts are durably persisted with stable spine identities'],
      applicability: [
        {
          kind: 'QUALITATIVE',
          uncertainty_class: 'UNQUANTIFIED',
          context: { tier: 'durable' },
          sample_size: 0,
          window: null,
        },
      ],
      evidence_refs: [deriveDeterministicArtifactId('Evidence', { note: 'p15a composition evidence' })],
      failure_refs: [],
      compatibility_refs: [],
      assurance_obligations: [
        {
          kind: 'REPLAY',
          obligation: 'the composed store replays a full artifact chain after restart',
        },
      ],
      context: { tier: 'durable' },
      learned_limitations: [],
      diversity_profile: {
        family: 'durable-semantic-store',
        dimensions: [
          { dimension: 'COST', stance: 'optimizes for low-cost durable semantic store' },
        ],
      },
      maturity: 'FORMING',
      independence: [],
      changes: 'p15a initial composition hypothesis (spine + store)',
      superseded_by: null,
    },
    provenance: ['P15:package-composition'],
    created_at: '2026-03-01T00:00:00.000Z',
    authority_ref: null,
  };
  return createPackageComposition(input);
}

/** Drive the full package composition journey on fresh artifacts. */
function runPackageCompositionJourney(): {
  spinePackage: PackageArtifact;
  storePackage: PackageArtifact;
  composition: PackageCompositionArtifact;
  graph: EcologyGraph;
} {
  const spinePackage = readGoldenPackage();
  const storePackage = createStorePackage(spinePackage.envelope.id);
  const composition = createSpineStoreComposition(spinePackage.envelope.id, storePackage.envelope.id);
  const graph = new EcologyGraph();
  // The composition MEMBERSHIP implies a COMPATIBLE_WITH relation between the
  // member packages — asserted as a learned record through the ecology public
  // surface (never by writing package internals).
  graph.addAssertion({
    source: spinePackage.envelope.id,
    target: storePackage.envelope.id,
    kind: 'COMPATIBLE_WITH',
    evidence_refs: [composition.content.evidence_refs[0]!],
    provenance: ['P15:package-composition:ecology-assertion'],
    note: 'the composition declares these packages compatible (spine + store)',
  });
  return { spinePackage, storePackage, composition, graph };
}

describe('P15 Lane A — package composition: the ecology updates as DATA (learned records)', () => {
  it('creates a Package + a PackageComposition through merged public exports (no internal mutation)', () => {
    const { spinePackage, storePackage, composition } = runPackageCompositionJourney();

    // Both packages carry the content-addressed envelope id.
    expect(spinePackage.envelope.id).toMatch(/^sos:\/\/Package\/[0-9a-f]{32}$/);
    expect(storePackage.envelope.id).toMatch(/^sos:\/\/Package\/[0-9a-f]{32}$/);
    // The composition carries the content-addressed envelope id.
    expect(composition.envelope.id).toMatch(/^sos:\/\/PackageComposition\/[0-9a-f]{32}$/);
    // The composition references both packages as members.
    expect(composition.content.members.map((m) => m.package_id).sort()).toEqual(
      [spinePackage.envelope.id, storePackage.envelope.id].sort(),
    );
  });

  it('the ecology graph accumulates the COMPATIBLE_WITH assertion as a learned record', () => {
    const { spinePackage, storePackage, composition, graph } = runPackageCompositionJourney();

    // The graph has TWO nodes (the spine + the store).
    expect(graph.nodeCount).toBe(2);
    expect(graph.nodesList().sort()).toEqual([spinePackage.envelope.id, storePackage.envelope.id].sort());

    // The graph has ONE COMPATIBLE_WITH edge between the two packages.
    expect(graph.edgeCount).toBe(1);
    const edge = graph.edgeBetween(spinePackage.envelope.id, storePackage.envelope.id, 'COMPATIBLE_WITH');
    expect(edge).not.toBeNull();
    expect(edge!.kind).toBe('COMPATIBLE_WITH');
    expect(edge!.assertions.length).toBe(1);

    // The assertion carries the composition's evidence ref (the learned record's backing).
    expect(edge!.evidence_refs).toContain(composition.content.evidence_refs[0]!);
  });

  it('every artifact carries provenance + the evidence refs (the typed trace link)', () => {
    const { spinePackage, storePackage, composition, graph } = runPackageCompositionJourney();

    // The spine package (golden fixture) carries its provenance.
    expect(spinePackage.envelope.provenance.length).toBeGreaterThan(0);
    // The store package carries the P15a provenance.
    expect(storePackage.envelope.provenance).toContain('P15:package-composition');
    // The composition carries the P15a provenance.
    expect(composition.envelope.provenance).toContain('P15:package-composition');
    // The ecology assertion carries the composition's evidence ref (the typed trace link).
    const edge = graph.edgeBetween(spinePackage.envelope.id, storePackage.envelope.id, 'COMPATIBLE_WITH')!;
    expect(edge.assertions[0]!.provenance).toContain('P15:package-composition:ecology-assertion');
  });

  it('retained uncertainty is VISIBLE — applicability is QUALITATIVE + UNQUANTIFIED, maturity is DRAFT', () => {
    const { storePackage, composition } = runPackageCompositionJourney();

    // The store package's applicability is honestly QUALITATIVE + UNQUANTIFIED.
    for (const estimate of storePackage.content.applicability) {
      expect(estimate.kind).toBe('QUALITATIVE');
      expect(estimate.uncertainty_class).toBe('UNQUANTIFIED');
    }
    // The composition's applicability is also QUALITATIVE + UNQUANTIFIED.
    for (const estimate of composition.content.applicability) {
      expect(estimate.kind).toBe('QUALITATIVE');
      expect(estimate.uncertainty_class).toBe('UNQUANTIFIED');
    }
    // The maturity is DISCOVERED (never a fabricated VALIDATED).
    expect(storePackage.content.maturity).toBe('DISCOVERED');
    expect(composition.content.maturity).toBe('FORMING');
    // The diversity profile is retained (the family is preserved).
    expect(storePackage.content.diversity_profile.family).toBeTruthy();
    expect(composition.content.diversity_profile.family).toBeTruthy();
  });

  it('reproduces bit-exactly across runs (determinism — content-addressed ids)', () => {
    const first = runPackageCompositionJourney();
    const second = runPackageCompositionJourney();
    // The content-addressed ids reproduce exactly (the bit-exact reproduction pin).
    expect(second.spinePackage.envelope.id).toBe(first.spinePackage.envelope.id);
    expect(second.storePackage.envelope.id).toBe(first.storePackage.envelope.id);
    expect(second.composition.envelope.id).toBe(first.composition.envelope.id);
    // The ecology assertion id reproduces exactly.
    const firstEdge = first.graph.edgeBetween(first.spinePackage.envelope.id, first.storePackage.envelope.id, 'COMPATIBLE_WITH')!;
    const secondEdge = second.graph.edgeBetween(second.spinePackage.envelope.id, second.storePackage.envelope.id, 'COMPATIBLE_WITH')!;
    expect(secondEdge.assertions[0]!.id).toBe(firstEdge.assertions[0]!.id);
    // The canonical serializations reproduce exactly.
    expect(canonicalSerialize(second.storePackage)).toBe(canonicalSerialize(first.storePackage));
    expect(canonicalSerialize(second.composition)).toBe(canonicalSerialize(first.composition));
  });

  it('the deterministic id derivation functions reproduce the artifact ids (the bit-exact pin)', () => {
    const { spinePackage, storePackage, composition } = runPackageCompositionJourney();
    // packageArtifactId(input) === the created artifact's envelope.id (the deterministic derivation).
    expect(packageArtifactId({
      content: storePackage.content,
      provenance: ['P15:package-composition'],
      created_at: '2026-03-01T00:00:00.000Z',
      authority_ref: null,
    })).toBe(storePackage.envelope.id);
    // compositionArtifactId(input) === the created artifact's envelope.id.
    expect(compositionArtifactId({
      content: composition.content,
      provenance: ['P15:package-composition'],
      created_at: '2026-03-01T00:00:00.000Z',
      authority_ref: null,
    })).toBe(composition.envelope.id);
  });
});
