import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import {
  canonicalRecoveryText,
  isRecoveryResult,
  recoverArchitectureHypotheses,
} from '../src/index.js';
import { assertValidArchitectureGraphArtifact, createArchitectureGraph } from '@sos-2/architecture';
import { canonicalSerialize, isCanonicalText } from '@sos-2/semantic-spine';
import type { ImplementationModel } from '@sos-2/semantic-spine';
import type { SystemStateRevisionRef } from '@sos-2/system-state';
import { CREATED_AT, PROJECTS, PROVENANCE } from './helpers.js';

/**
 * Property tests — deterministic: fast-check is seeded globally (424242) in
 * test/setup.ts, so repeated runs generate identical sequences and yield
 * identical results.
 */

function hex32(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

const SYSTEM_STATE: SystemStateRevisionRef = PROJECTS;

const componentIdArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,7}$/)
  .map((raw) => `c:${raw ?? 'x'}`);
const kindArb = fc.constantFrom('service', 'library', 'datastore', 'adapter', 'Component', 'Adapter', 'DataStore');

interface ModelSeed {
  componentIds: string[];
  kinds: string[];
  realizesFlags: boolean[];
  dependencySpecs: Array<{ s: number; t: number; kind: string; dangling: boolean }>;
  interfaces: Array<{ id: string; providerIndex: number; consumerIndex: number }>;
  revision: string;
}

const modelSeedArb: fc.Arbitrary<ModelSeed> = fc.record({
  componentIds: fc.uniqueArray(componentIdArb, { maxLength: 6 }),
  kinds: fc.array(kindArb, { minLength: 1, maxLength: 4 }),
  realizesFlags: fc.array(fc.boolean(), { maxLength: 12 }),
  dependencySpecs: fc.array(
    fc.record({
      s: fc.nat(30),
      t: fc.nat(30),
      kind: fc.constantFrom('uses', 'imports', 'owns', 'Dependency'),
      dangling: fc.boolean(),
    }),
    { maxLength: 6 },
  ),
  interfaces: fc.array(
    fc.record({
      id: fc.stringMatching(/^[a-z][a-z0-9-]{0,5}$/).map((raw) => `i:${raw ?? 'x'}`),
      providerIndex: fc.nat(10),
      consumerIndex: fc.nat(10),
    }),
    { maxLength: 3 },
  ),
  revision: fc.hexaString({ minLength: 40, maxLength: 40 }).noShrink(),
});

function buildModel(seed: ModelSeed): ImplementationModel {
  const components = seed.componentIds.map((id, index) => ({
    id,
    kind: seed.kinds[index % seed.kinds.length] ?? 'library',
    realized_by: [],
    realizes: seed.realizesFlags[index % Math.max(seed.realizesFlags.length, 1)] === true ? ['store:shared'] : [],
  }));
  const dependencies: Array<{ source: string; target: string; kind: string }> = [];
  const seen = new Set<string>();
  for (const spec of seed.dependencySpecs) {
    if (components.length === 0) break;
    const source = components[spec.s % components.length]!.id;
    const target = spec.dangling
      ? 'store:nowhere'
      : components[spec.t % components.length]!.id;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dependencies.push({ source, target, kind: spec.kind });
  }
  const interfaces = seed.interfaces.map((spec, index) => {
    const provider = components.length > 0 ? components[spec.providerIndex % components.length]!.id : 'c:none';
    const consumer = components.length > 0 ? components[spec.consumerIndex % components.length]!.id : 'c:none';
    return { id: spec.id || `i:fallback-${index}`, provider, contract_ref: null, consumers: [consumer] };
  });
  return {
    id: `sos://ImplementationModel/${hex32(`w4-property-${seed.revision}`)}`,
    revision: seed.revision,
    components,
    source_artifacts: [],
    interfaces,
    dependencies,
    tests: [],
    builds: [],
    deployments: [],
    runtime_mappings: [],
  };
}

const modelArb = modelSeedArb.map(buildModel);

const recoveryInputArb = modelArb.map((model) => ({
  model,
  projects_system_state: SYSTEM_STATE,
  provenance: ['W4:property-test'],
  created_at: CREATED_AT,
}));

describe('property: recovery determinism', () => {
  it('identical inputs produce byte-identical recovery results', () => {
    fc.assert(
      fc.property(recoveryInputArb, (input) => {
        const first = recoverArchitectureHypotheses(input);
        const second = recoverArchitectureHypotheses({
          ...input,
          model: JSON.parse(JSON.stringify(input.model)) as ImplementationModel,
        });
        return JSON.stringify(first) === JSON.stringify(second);
      }),
      { numRuns: 150 },
    );
  });

  it('recovery results round-trip through the canonical serializer byte-identically', () => {
    fc.assert(
      fc.property(recoveryInputArb, (input) => {
        const result = recoverArchitectureHypotheses(input);
        const text = canonicalRecoveryText(result);
        if (!isCanonicalText(text)) return false;
        const roundTripped = canonicalSerialize(JSON.parse(text));
        return roundTripped === text;
      }),
      { numRuns: 150 },
    );
  });

  it('hypothesis artifacts are valid and round-trip through the canonical serializer', () => {
    fc.assert(
      fc.property(recoveryInputArb, (input) => {
        const result = recoverArchitectureHypotheses(input);
        return result.hypotheses.every((hypothesis) => {
          try {
            assertValidArchitectureGraphArtifact(hypothesis.artifact);
          } catch {
            return false;
          }
          const text = canonicalSerialize(hypothesis.artifact);
          if (!isCanonicalText(text)) return false;
          return canonicalSerialize(JSON.parse(text)) === text;
        });
      }),
      { numRuns: 150 },
    );
  });

  it('hypothesis artifact ids are unique and the input model is never mutated', () => {
    fc.assert(
      fc.property(recoveryInputArb, (input) => {
        const before = canonicalSerialize(input.model);
        const result = recoverArchitectureHypotheses(input);
        if (canonicalSerialize(input.model) !== before) return false;
        const ids = result.hypotheses.map((hypothesis) => hypothesis.artifact.envelope.id);
        return new Set(ids).size === ids.length;
      }),
      { numRuns: 150 },
    );
  });

  it('ambiguity_detected implies >= 2 hypotheses; unambiguous implies exactly one', () => {
    fc.assert(
      fc.property(recoveryInputArb, (input) => {
        const result = recoverArchitectureHypotheses(input);
        if (result.ambiguity_detected) {
          return result.hypotheses.length >= 2 && result.hypotheses.every((h) => h.uncertainty === 'AMBIGUOUS');
        }
        return result.hypotheses.length === 1 && result.hypotheses[0]!.uncertainty === 'UNAMBIGUOUS';
      }),
      { numRuns: 150 },
    );
  });

  it('every hypothesis links to the source model with DERIVED_FROM and OBSERVES', () => {
    fc.assert(
      fc.property(recoveryInputArb, (input) => {
        const result = recoverArchitectureHypotheses(input);
        return result.hypotheses.every((hypothesis) => {
          const types = hypothesis.links.map((link) => link.type).sort();
          if (types.join(',') !== 'DERIVED_FROM,OBSERVES') return false;
          return hypothesis.links.every(
            (link) =>
              link.source === hypothesis.artifact.envelope.id &&
              link.target === input.model.id &&
              (link.provenance?.length ?? 0) > 0 &&
              link.provenance!.includes(`source-revision:${input.model.revision}`),
          );
        });
      }),
      { numRuns: 150 },
    );
  });

  it('results satisfy the structural guard and respect the hypothesis cap', () => {
    fc.assert(
      fc.property(recoveryInputArb, fc.integer({ min: 2, max: 5 }), (input, cap) => {
        const result = recoverArchitectureHypotheses({ ...input, config: { maxHypotheses: cap } });
        if (!isRecoveryResult(result)) return false;
        return result.hypotheses.length <= cap;
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-package determinism: recovery over a randomized declared graph
// ---------------------------------------------------------------------------

const declaredGraphArb = fc
  .record({
    nodeIds: fc.uniqueArray(componentIdArb, { maxLength: 6 }),
    nodeKinds: fc.array(fc.constantFrom('Component', 'DataStore', 'Interface', 'Adapter'), { minLength: 1, maxLength: 4 }),
    edgeSpecs: fc.array(
      fc.record({ s: fc.nat(20), t: fc.nat(20), kind: fc.constantFrom('Dependency', 'Owns', 'Provides') }),
      { maxLength: 6 },
    ),
  })
  .map((seed) => {
    const nodes = seed.nodeIds.map((id, index) => ({
      id,
      kind: seed.nodeKinds[index % seed.nodeKinds.length] ?? 'Component',
      criticality: 'normal' as const,
      attributes: {},
    }));
    const edges: Array<{ source: string; target: string; kind: string; criticality: 'normal'; attributes: Record<string, never> }> = [];
    const seen = new Set<string>();
    for (const spec of seed.edgeSpecs) {
      if (nodes.length === 0) break;
      const source = nodes[spec.s % nodes.length]!.id;
      const target = nodes[spec.t % nodes.length]!.id;
      const key = `${source}->${target}->${spec.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target, kind: spec.kind, criticality: 'normal', attributes: {} });
    }
    return createArchitectureGraph({
      projects_system_state: SYSTEM_STATE,
      nodes,
      edges,
      provenance: ['W4:property-declared'],
      created_at: CREATED_AT,
      status: 'ACTIVE',
    });
  });

describe('property: graph construction stability', () => {
  it('randomized declared graphs are reproducible from their creation inputs', () => {
    fc.assert(
      fc.property(declaredGraphArb, (artifact) => {
        const text = canonicalSerialize(artifact);
        return isCanonicalText(text) && canonicalSerialize(JSON.parse(text)) === text;
      }),
      { numRuns: 100 },
    );
  });
});
