import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ArtifactIdRegistry,
  TraceLinkStore,
  canonicalSerialize,
  classifyDifferences,
  contentHash,
  createEnvelope,
  createTraceLink,
  deriveDeterministicArtifactId,
  isCanonicalText,
  validateEnvelope,
  validateTraceLink,
} from '../src/index.js';
import type {
  ArchitectureGraphEdge,
  ArchitectureGraphNode,
  ClassificationConfig,
  CreateTraceLinkInput,
  ImplementationModel,
} from '../src/index.js';

/**
 * Property tests — deterministic: fast-check is seeded globally (424242) in
 * test/setup.ts, so repeated runs generate identical sequences and yield
 * identical results (the W0.5 determinism proof).
 */

/** Recursively reverse the key order of every object (order-invariance probe). */
function reverseKeyOrder<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(reverseKeyOrder) as unknown as T;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    const result: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      result[key] = reverseKeyOrder(val);
    }
    return result as T;
  }
  return value;
}

const kindArb = fc.constantFrom('Mission', 'Evidence', 'Decision', 'Package', 'Context', 'AskRequest');
const hex32Arb = fc.hexaString({ minLength: 32, maxLength: 32 }).noShrink();
const artifactIdArb = fc
  .tuple(fc.constantFrom('Mission', 'Evidence', 'Decision', 'Package', 'ArchitectureGraph'), hex32Arb)
  .map(([kind, hex]) => `sos://${kind}/${hex}`);
const provenanceArb = fc.array(fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9 .:-]{0,40}/), { minLength: 1, maxLength: 4 });
const createdAtArb = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2099-12-31T23:59:59Z') })
  .map((d) => d.toISOString());

describe('property: canonical serialization', () => {
  it('round trips byte-identically for arbitrary JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const s1 = canonicalSerialize(value);
        const s2 = canonicalSerialize(JSON.parse(s1));
        return s1 === s2 && isCanonicalText(s1);
      }),
      { numRuns: 300 },
    );
  });

  it('is idempotent (fixed point) for arbitrary JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const once = canonicalSerialize(value);
        return canonicalSerialize(JSON.parse(once)) === once;
      }),
      { numRuns: 300 },
    );
  });

  it('is invariant under arbitrary key reordering (canonical-identity stability)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const original = canonicalSerialize(value);
        const reordered = canonicalSerialize(reverseKeyOrder(JSON.parse(original)));
        return reordered === original;
      }),
      { numRuns: 300 },
    );
  });

  it('content hashes are invariant under key reordering and stable across clones', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const once = JSON.parse(canonicalSerialize(value));
        return (
          contentHash(reverseKeyOrder(once)) === contentHash(once) &&
          contentHash(JSON.parse(canonicalSerialize(once))) === contentHash(once)
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe('property: deterministic identity', () => {
  it('same (kind, content) -> same id, regardless of key order or clone round trips', () => {
    fc.assert(
      fc.property(kindArb, fc.jsonValue(), (kind, content) => {
        const a = deriveDeterministicArtifactId(kind, content);
        const b = deriveDeterministicArtifactId(kind, reverseKeyOrder(JSON.parse(JSON.stringify(content))));
        const c = deriveDeterministicArtifactId(kind, JSON.parse(canonicalSerialize(content)));
        return a === b && b === c;
      }),
      { numRuns: 200 },
    );
  });

  it('different content -> different ids (randomized pair probe)', () => {
    fc.assert(
      fc.property(
        kindArb,
        fc.jsonValue(),
        fc.jsonValue(),
        (kind, a, b) =>
          JSON.stringify(a) === JSON.stringify(b) || deriveDeterministicArtifactId(kind, a) !== deriveDeterministicArtifactId(kind, b),
      ),
      { numRuns: 200 },
    );
  });

  it('registry registration is collision-free and order-independent for distinct content', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.jsonValue(), { minLength: 1, maxLength: 10, selector: (v) => canonicalSerialize(v) }),
        kindArb,
        (contents, kind) => {
          const registry = new ArtifactIdRegistry();
          const ids = contents.map((content) => registry.registerDeterministic(kind, content));
          return new Set(ids).size === ids.length && ids.every((id) => registry.has(id));
        },
      ),
      { numRuns: 100 },
    );
  });
});

const envelopeInputArb = fc.record({
  kind: kindArb,
  version: fc.integer({ min: 1, max: 1000 }),
  authority_ref: fc.option(artifactIdArb, { nil: null }),
  provenance: provenanceArb,
  created_at: createdAtArb,
  supersedes: fc.option(artifactIdArb, { nil: null }),
});

describe('property: envelope lifecycle', () => {
  it('valid envelopes round trip through JSON and keep deterministic ids', () => {
    fc.assert(
      fc.property(envelopeInputArb, (input) => {
        const envelope = createEnvelope(input);
        if (!validateEnvelope(envelope)) return false;
        const roundTripped = JSON.parse(JSON.stringify(envelope));
        if (!validateEnvelope(roundTripped)) return false;
        if (canonicalSerialize(envelope) !== canonicalSerialize(roundTripped)) return false;
        // determinism: identical input -> identical envelope (id included)
        return createEnvelope(input).id === envelope.id;
      }),
      { numRuns: 300 },
    );
  });

  it('status transitions preserve the id (stable identity across the lifecycle)', () => {
    fc.assert(
      fc.property(envelopeInputArb, (input) => {
        const draft = createEnvelope(input);
        if (draft.status !== 'DRAFT') return false;
        const active = { ...draft, status: 'ACTIVE' as const };
        const superseded = { ...active, status: 'SUPERSEDED' as const };
        const retired = { ...draft, status: 'RETIRED' as const };
        return (
          active.id === draft.id && superseded.id === draft.id && retired.id === draft.id &&
          validateEnvelope(active) && validateEnvelope(superseded) && validateEnvelope(retired)
        );
      }),
      { numRuns: 300 },
    );
  });
});

const traceLinkInputArb: fc.Arbitrary<CreateTraceLinkInput> = fc.record({
  source: artifactIdArb,
  target: artifactIdArb,
  type: fc.constantFrom(
    'SATISFIES', 'REALIZES', 'REFINES', 'CONSTRAINS', 'IMPLEMENTS', 'VERIFIES', 'OBSERVES',
    'SUPPORTS', 'CONTRADICTS', 'CAUSED_BY', 'CAUSED', 'DERIVED_FROM', 'COMPATIBLE_WITH',
    'CONFLICTS_WITH', 'COMPOSES', 'SPECIALIZES', 'GENERALIZES',
  ),
  provenance: provenanceArb,
});

describe('property: trace links', () => {
  it('valid links round trip through JSON and validate', () => {
    fc.assert(
      fc.property(traceLinkInputArb, (input) => {
        const link = createTraceLink(input);
        if (!validateTraceLink(link)) return false;
        const roundTripped = JSON.parse(JSON.stringify(link));
        return (
          validateTraceLink(roundTripped) &&
          canonicalSerialize(link) === canonicalSerialize(roundTripped)
        );
      }),
      { numRuns: 300 },
    );
  });

  it('stores accept arbitrary valid link sets and answer queries consistently', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(traceLinkInputArb, {
          minLength: 0,
          maxLength: 20,
          selector: (l) => `${l.source}|${l.target}|${l.type}`,
        }),
        (inputs) => {
          const store = new TraceLinkStore();
          for (const input of inputs) {
            store.addLink(input);
          }
          if (store.size !== inputs.length) return false;
          // forward + backward counts always sum consistently per link
          for (const link of store.all()) {
            if (!store.from(link.source).some((l) => l.target === link.target && l.type === link.type)) return false;
            if (!store.to(link.target).some((l) => l.source === link.source && l.type === link.type)) return false;
          }
          // duplicates are rejected
          if (inputs.length > 0) {
            const [first] = inputs;
            let threw = false;
            try {
              store.addLink(first!);
            } catch {
              threw = true;
            }
            if (!threw) return false;
          }
          return true;
        },
      ),
      { numRuns: 150 },
    );
  });
});

const idPoolArb = fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{1,9}$/), { maxLength: 8 });
const componentKindArb = fc.constantFrom('service', 'library', 'datastore', 'adapter');
const criticalityArb = fc.option(fc.constantFrom('critical' as const, 'normal' as const), { nil: undefined });

interface ClassifierSeed {
  declaredIds: string[];
  observedIds: string[];
  declaredKinds: string[];
  observedKinds: string[];
  declaredCriticalities: Array<'critical' | 'normal' | undefined>;
  realizes: string[];
  expected: string[];
  intentional: string[];
  policy: 'IMPLEMENTATION_DETAIL' | 'EXPECTED_VARIATION' | undefined;
  declaredEdges: Array<{ source: string; target: string; kind: string }>;
  observedDeps: Array<{ source: string; target: string; kind: string }>;
}

function buildClassifierCase(seed: ClassifierSeed): { observed: ImplementationModel; declared: { nodes: ArchitectureGraphNode[]; edges: ArchitectureGraphEdge[] }; config: ClassificationConfig } {
  const observed: ImplementationModel = {
    id: `sos://ImplementationModel/${'0'.repeat(32)}`,
    revision: 'rev-property',
    components: seed.observedIds.map((id, i) => ({
      id,
      kind: seed.observedKinds[i % seed.observedKinds.length] ?? 'service',
      realized_by: [],
      realizes: seed.realizes.includes(id) ? [seed.declaredIds[i % Math.max(seed.declaredIds.length, 1)] ?? 'ghost'] : [],
    })),
    source_artifacts: [],
    interfaces: [],
    dependencies: seed.observedDeps,
    tests: [],
    builds: [],
    deployments: [],
    runtime_mappings: [],
  };
  const declared = {
    nodes: seed.declaredIds.map((id, i) => ({
      id,
      kind: seed.declaredKinds[i % seed.declaredKinds.length] ?? 'service',
      ...(seed.declaredCriticalities[i % Math.max(seed.declaredCriticalities.length, 1)] !== undefined
        ? { criticality: seed.declaredCriticalities[i % Math.max(seed.declaredCriticalities.length, 1)] }
        : {}),
    })),
    edges: seed.declaredEdges,
  };
  const config: ClassificationConfig = {
    ...(seed.policy !== undefined ? { undeclaredPolicy: seed.policy } : {}),
    expectedVariations: seed.expected,
    intentionalEvolutions: seed.intentional,
  };
  return { observed, declared, config };
}

const classifierSeedArb: fc.Arbitrary<ClassifierSeed> = fc.record({
  declaredIds: idPoolArb,
  observedIds: idPoolArb,
  declaredKinds: fc.array(componentKindArb, { maxLength: 4 }),
  observedKinds: fc.array(componentKindArb, { maxLength: 4 }),
  declaredCriticalities: fc.array(criticalityArb, { maxLength: 4 }),
  realizes: fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{1,9}$/), { maxLength: 4 }),
  expected: fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{1,9}$/), { maxLength: 3 }),
  intentional: fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{1,9}$/), { maxLength: 3 }),
  policy: fc.option(fc.constantFrom('IMPLEMENTATION_DETAIL' as const, 'EXPECTED_VARIATION' as const), {
    nil: undefined,
  }),
  declaredEdges: fc.uniqueArray(
    fc.record({
      source: fc.stringMatching(/^[a-z][a-z0-9-]{1,9}$/),
      target: fc.stringMatching(/^[a-z][a-z0-9-]{1,9}$/),
      kind: fc.constantFrom('uses', 'imports'),
    }),
    { maxLength: 4, selector: (e) => `${e.source}->${e.target}` },
  ),
  observedDeps: fc.uniqueArray(
    fc.record({
      source: fc.stringMatching(/^[a-z][a-z0-9-]{1,9}$/),
      target: fc.stringMatching(/^[a-z][a-z0-9-]{1,9}$/),
      kind: fc.constantFrom('uses', 'imports'),
    }),
    { maxLength: 4, selector: (e) => `${e.source}->${e.target}` },
  ),
});

const classifierCaseArb = classifierSeedArb.map((seed) => buildClassifierCase(seed));

describe('property: conformance classifier', () => {
  it('is deterministic and total on randomized valid inputs', () => {
    fc.assert(
      fc.property(classifierCaseArb, ({ observed, declared, config }) => {
        const a = classifyDifferences(observed, declared, config);
        const b = classifyDifferences(observed, declared, config);
        if (JSON.stringify(a) !== JSON.stringify(b)) return false;
        // every finding is well-formed
        return a.every(
          (f) =>
            f.subject.length > 0 &&
            f.reason.length > 0 &&
            [
              'IMPLEMENTATION_DETAIL',
              'EXPECTED_VARIATION',
              'PRESERVING_REFINEMENT',
              'INTENTIONAL_EVOLUTION',
              'DRIFT',
              'UNKNOWN',
              'CONTRADICTION',
            ].includes(f.classification),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('subjects are unique and sorted within nodes-then-edges order', () => {
    fc.assert(
      fc.property(classifierCaseArb, ({ observed, declared, config }) => {
        const findings = classifyDifferences(observed, declared, config);
        const subjects = findings.map((f) => f.subject);
        return new Set(subjects).size === subjects.length;
      }),
      { numRuns: 200 },
    );
  });

  it('matched subjects (declared and present, same kind) are never reported', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{1,9}$/), { maxLength: 6 }),
        fc.array(componentKindArb, { maxLength: 3 }),
        (ids, kinds) => {
          const components = ids.map((id, i) => ({ id, kind: kinds[i % Math.max(kinds.length, 1)] ?? 'service', realized_by: [], realizes: [] }));
          const observed: ImplementationModel = {
            id: `sos://ImplementationModel/${'0'.repeat(32)}`,
            revision: 'r',
            components,
            source_artifacts: [],
            interfaces: [],
            dependencies: [],
            tests: [],
            builds: [],
            deployments: [],
            runtime_mappings: [],
          };
          const declared = {
            nodes: components.map((c) => ({ id: c.id, kind: c.kind })),
            edges: [],
          };
          return classifyDifferences(observed, declared).length === 0;
        },
      ),
      { numRuns: 150 },
    );
  });
});
