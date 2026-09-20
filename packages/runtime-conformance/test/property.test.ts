import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import {
  RUNTIME_VERDICTS,
  VERDICT_AVAILABILITY,
  evaluateRuntimeConformance,
  isRuntimeConformanceRecord,
  isRuntimeConformanceResult,
  structuralRuntimeAdapter,
} from '../src/index.js';
import { createArchitectureGraph } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { createSystemState } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { CORE_EDGE_KINDS, CORE_NODE_KINDS } from '@sos-2/architecture';
import type { Invariant } from '@sos-2/conformance';
import type { EvidenceTruthState, RawObservation } from '../src/index.js';
import type { JsonValue } from '@sos-2/semantic-spine';
import { EVALUATED_AT, PRODUCER, WINDOW } from './helpers.js';

/**
 * Property tests — deterministic: fast-check is seeded globally (424242) in
 * test/setup.ts, so repeated runs generate identical sequences and yield
 * identical results.
 */

function hex32(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

const nodeIdArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/).map((raw) => `n:${raw ?? 'x'}`);
const criticalityArb = fc.constantFrom('critical' as const, 'normal' as const);

interface GraphSeed {
  nodes: Array<{ id: string; kind: string; criticality: 'critical' | 'normal' }>;
  edgeSpecs: Array<{ s: number; t: number; kind: string }>;
}

const graphSeedArb: fc.Arbitrary<GraphSeed> = fc.record({
  nodes: fc.uniqueArray(
    fc.record({
      id: nodeIdArb,
      kind: fc.constantFrom(...CORE_NODE_KINDS),
      criticality: criticalityArb,
    }),
    { maxLength: 6, selector: (n) => n.id },
  ),
  edgeSpecs: fc.array(
    fc.record({
      s: fc.nat(20),
      t: fc.nat(20),
      kind: fc.constantFrom(...CORE_EDGE_KINDS),
    }),
    { maxLength: 6 },
  ),
});

function buildGraph(seed: GraphSeed): ArchitectureGraphArtifact {
  const nodes = seed.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    criticality: node.criticality,
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
    projects_system_state: {
      system_state_id: `sos://SystemState/${hex32('w4-rc-property-anchor')}`,
      version: 1,
    },
    nodes,
    edges,
    provenance: ['W4:runtime-conformance-property'],
    created_at: '2025-06-01T00:00:00.000Z',
    status: 'ACTIVE',
  });
}

const declaredArb = graphSeedArb.map(buildGraph);

const invariantArb: fc.Arbitrary<Invariant> = fc.oneof(
  fc.record({
    kind: fc.constant('REQUIRED_INTERFACE' as const),
    componentKind: fc.constantFrom(...CORE_NODE_KINDS),
    interfaceId: nodeIdArb,
  }),
  fc.record({
    kind: fc.constant('FORBIDDEN_DEPENDENCY' as const),
    fromKind: fc.constantFrom(...CORE_NODE_KINDS),
    toKind: fc.constantFrom(...CORE_NODE_KINDS),
  }),
  fc
    .record({
      kind: fc.constant('LAYERING' as const),
      layers: fc.uniqueArray(fc.constantFrom(...CORE_NODE_KINDS), { minLength: 2, maxLength: 4 }),
    })
    .filter((invariant) => invariant.layers.length >= 2),
  fc.record({
    kind: fc.constant('DATA_OWNERSHIP' as const),
  }),
);

const truthStateArb = fc.constantFrom<EvidenceTruthState>(
  'SUCCESS',
  'FAILURE',
  'UNKNOWN',
  'UNAVAILABLE',
  'UNSUPPORTED',
  'PARTIAL',
);

interface ObservationSeed {
  subject: string;
  availability: EvidenceTruthState;
  nodeKind: string | undefined;
  edges: Array<{ target: string; kind: string }>;
}

const observationSeedArb: fc.Arbitrary<ObservationSeed> = fc.record({
  subject: nodeIdArb,
  availability: truthStateArb,
  nodeKind: fc.option(fc.constantFrom(...CORE_NODE_KINDS), { nil: undefined }),
  edges: fc.array(
    fc.record({
      target: nodeIdArb,
      kind: fc.constantFrom(...CORE_EDGE_KINDS),
    }),
    { maxLength: 3 },
  ),
});

function buildObservation(seed: ObservationSeed): RawObservation {
  const attributes: Record<string, JsonValue> = {};
  if (seed.nodeKind !== undefined && seed.nodeKind !== null) {
    attributes['runtime.node_kind'] = seed.nodeKind;
  }
  if (seed.edges.length > 0) {
    attributes['runtime.edges'] = seed.edges.map((edge) => ({ target: edge.target, kind: edge.kind }));
  }
  return {
    subject_ref: seed.subject,
    availability: seed.availability,
    window: WINDOW,
    observed: null,
    attributes,
    producer: PRODUCER,
  };
}

const observationsArb = fc.array(observationSeedArb.map(buildObservation), { maxLength: 8 });

interface EvaluationSeed {
  graph: GraphSeed;
  invariants: Invariant[];
  observations: RawObservation[];
  revision: string;
}

const evaluationSeedArb: fc.Arbitrary<EvaluationSeed> = fc.record({
  graph: graphSeedArb,
  invariants: fc.uniqueArray(invariantArb, { maxLength: 4, selector: (invariant) => JSON.stringify(invariant) }),
  observations: observationsArb,
  revision: fc.hexaString({ minLength: 40, maxLength: 40 }).noShrink(),
});

function buildEvaluation(seed: EvaluationSeed) {
  const declared = buildGraph(seed.graph);
  const systemState: SystemStateArtifact = createSystemState({
    content: {
      architecture_ref: { artifact_id: declared.envelope.id, version: declared.envelope.version },
      implementation: [
        { artifact_id: `sos://ImplementationModel/${hex32(`w4-rc-${seed.revision}`)}`, revision: { kind: 'git-sha', value: seed.revision } },
      ],
      configuration: [],
      deployment: [],
      policy: [],
      environment_relationships: [],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: ['W4:runtime-conformance-property'],
    created_at: '2025-06-01T00:00:00.000Z',
    status: 'ACTIVE',
  });
  return {
    system_state: systemState,
    declared_architecture: declared,
    invariants: seed.invariants,
    observations: seed.observations,
    adapter: structuralRuntimeAdapter,
    producer: PRODUCER,
    evaluated_at: EVALUATED_AT,
  };
}

const evaluationInputArb = evaluationSeedArb.map(buildEvaluation);

describe('property: runtime conformance evaluation', () => {
  it('is deterministic: identical inputs produce byte-identical results', () => {
    fc.assert(
      fc.property(evaluationInputArb, (input) => {
        const first = evaluateRuntimeConformance(input);
        const clone = JSON.parse(JSON.stringify(input)) as Omit<typeof input, 'adapter'> & { adapter: unknown };
        clone.adapter = structuralRuntimeAdapter;
        const second = evaluateRuntimeConformance(clone as typeof input);
        return JSON.stringify(first) === JSON.stringify(second);
      }),
      { numRuns: 120 },
    );
  });

  it('every record satisfies the frozen verdict/availability consistency (never conflated)', () => {
    fc.assert(
      fc.property(evaluationInputArb, (input) => {
        const result = evaluateRuntimeConformance(input);
        return result.records.every((record) => {
          if (!RUNTIME_VERDICTS.includes(record.verdict)) return false;
          if (!VERDICT_AVAILABILITY[record.verdict].includes(record.evidence.availability)) return false;
          return isRuntimeConformanceRecord(record);
        });
      }),
      { numRuns: 120 },
    );
  });

  it('records follow input invariant order with unique deterministic evidence ids', () => {
    fc.assert(
      fc.property(evaluationInputArb, (input) => {
        const result = evaluateRuntimeConformance(input);
        if (result.records.length !== input.invariants.length) return false;
        const sameOrder = result.records.every((record, index) => record.invariant === input.invariants[index]);
        if (!sameOrder) return false;
        const ids = result.records.map((record) => record.evidence.id);
        if (new Set(ids).size !== ids.length) return false;
        return ids.every((id) => id.startsWith('sos://Evidence/'));
      }),
      { numRuns: 120 },
    );
  });

  it('evidence is bound to the exact SystemState revision and re-evaluation reproduces ids', () => {
    fc.assert(
      fc.property(evaluationInputArb, (input) => {
        const result = evaluateRuntimeConformance(input);
        const again = evaluateRuntimeConformance(input);
        return result.records.every((record, index) => {
          if (record.evidence.subject_ref !== input.system_state.envelope.id) return false;
          if (record.evidence.subject_revision !== `${input.system_state.envelope.id}@v${input.system_state.envelope.version}`) {
            return false;
          }
          const observes = record.links.find((link) => link.type === 'OBSERVES');
          const verifies = record.links.find((link) => link.type === 'VERIFIES');
          if (observes?.target !== input.system_state.envelope.id) return false;
          if (verifies?.target !== input.declared_architecture.envelope.id) return false;
          return record.evidence.id === again.records[index]!.evidence.id;
        });
      }),
      { numRuns: 120 },
    );
  });

  it('results satisfy the structural guard and round-trip through the canonical serializer', () => {
    fc.assert(
      fc.property(evaluationInputArb, (input) => {
        const result = evaluateRuntimeConformance(input);
        if (!isRuntimeConformanceResult(result)) return false;
        const text = JSON.stringify(result);
        const roundTripped = JSON.parse(text);
        return JSON.stringify(roundTripped) === text;
      }),
      { numRuns: 120 },
    );
  });

  it('absence of observations never yields PASS (never conflated with absence-of-violation)', () => {
    fc.assert(
      fc.property(evaluationInputArb, (input) => {
        const result = evaluateRuntimeConformance({
          ...input,
          observations: [],
        });
        return result.records.every((record) => {
          if (record.verdict === 'PASS') return false;
          return record.evidence.availability === 'UNAVAILABLE' || record.evidence.availability === 'UNSUPPORTED';
        });
      }),
      { numRuns: 120 },
    );
  });
});
