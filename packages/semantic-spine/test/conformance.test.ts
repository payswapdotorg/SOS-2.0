import { describe, expect, it } from 'vitest';
import {
  CONFORMANCE_CLASSES,
  ConformanceError,
  classifyDifferences,
  isConformanceFinding,
} from '../src/index.js';
import type { ImplementationModel, ArchitectureGraphRef, ClassificationConfig } from '../src/index.js';

function model(components: ImplementationModel['components'], dependencies: ImplementationModel['dependencies'] = []): ImplementationModel {
  return {
    id: `sos://ImplementationModel/${'0'.repeat(32)}`,
    revision: 'rev-test',
    components,
    source_artifacts: [],
    interfaces: [],
    dependencies,
    tests: [],
    builds: [],
    deployments: [],
    runtime_mappings: [],
  };
}

function component(id: string, kind: string, realizes: string[] = []) {
  return { id, kind, realized_by: [], realizes };
}

function findingsBySubject(list: ReturnType<typeof classifyDifferences>) {
  return Object.fromEntries(list.map((f) => [f.subject, f.classification])) as Record<string, string>;
}

describe('conformance classifier — node rules', () => {
  it('N2: declared-and-present with equal kinds is a match and is NOT reported', () => {
    const observed = model([component('auth', 'service')]);
    const declared: ArchitectureGraphRef = { nodes: [{ id: 'auth', kind: 'service' }], edges: [] };
    expect(classifyDifferences(observed, declared)).toEqual([]);
  });

  it('N1: kind mismatch with same id is UNKNOWN (ambiguous correspondence)', () => {
    const observed = model([component('auth', 'service')]);
    const declared: ArchitectureGraphRef = { nodes: [{ id: 'auth', kind: 'datastore' }], edges: [] };
    const [finding] = classifyDifferences(observed, declared);
    expect(finding?.classification).toBe('UNKNOWN');
    expect(finding?.subject).toBe('auth');
    expect(finding?.reason).toContain('ambiguous');
    expect(isConformanceFinding(finding)).toBe(true);
  });

  it('N1: kind mismatch pre-authorized by configuration is INTENTIONAL_EVOLUTION', () => {
    const observed = model([component('auth', 'service')]);
    const declared: ArchitectureGraphRef = { nodes: [{ id: 'auth', kind: 'datastore' }], edges: [] };
    const config: ClassificationConfig = { intentionalEvolutions: ['auth'] };
    const [finding] = classifyDifferences(observed, declared, config);
    expect(finding?.classification).toBe('INTENTIONAL_EVOLUTION');
  });

  it('N3: declared node missing, criticality normal -> DRIFT', () => {
    const observed = model([]);
    const declared: ArchitectureGraphRef = { nodes: [{ id: 'auth', kind: 'service' }], edges: [] };
    const [finding] = classifyDifferences(observed, declared);
    expect(finding).toMatchObject({ classification: 'DRIFT', subject: 'auth' });
  });

  it('N3: declared critical node missing -> CONTRADICTION', () => {
    const observed = model([]);
    const declared: ArchitectureGraphRef = {
      nodes: [{ id: 'auth', kind: 'service', criticality: 'critical' }],
      edges: [],
    };
    const [finding] = classifyDifferences(observed, declared);
    expect(finding).toMatchObject({ classification: 'CONTRADICTION', subject: 'auth' });
    expect(finding?.reason).toContain('critical');
  });

  it('N3: declared node missing but realized by refinement components -> PRESERVING_REFINEMENT', () => {
    const observed = model([
      component('auth-reader', 'library', ['auth']),
      component('auth-writer', 'library', ['auth']),
    ]);
    const declared: ArchitectureGraphRef = { nodes: [{ id: 'auth', kind: 'service' }], edges: [] };
    const [finding] = classifyDifferences(observed, declared);
    expect(finding).toMatchObject({ classification: 'PRESERVING_REFINEMENT', subject: 'auth' });
    expect(finding?.reason).toContain('auth-reader');
    expect(finding?.reason).toContain('auth-writer');
  });

  it('N3: declared node missing but pre-authorized -> INTENTIONAL_EVOLUTION', () => {
    const observed = model([]);
    const declared: ArchitectureGraphRef = { nodes: [{ id: 'auth', kind: 'service' }], edges: [] };
    const config: ClassificationConfig = { intentionalEvolutions: ['auth'] };
    const [finding] = classifyDifferences(observed, declared, config);
    expect(finding).toMatchObject({ classification: 'INTENTIONAL_EVOLUTION', subject: 'auth' });
  });

  it('N3 precedence: intentional evolution outranks criticality', () => {
    const observed = model([]);
    const declared: ArchitectureGraphRef = {
      nodes: [{ id: 'auth', kind: 'service', criticality: 'critical' }],
      edges: [],
    };
    const config: ClassificationConfig = { intentionalEvolutions: ['auth'] };
    const [finding] = classifyDifferences(observed, declared, config);
    expect(finding?.classification).toBe('INTENTIONAL_EVOLUTION');
  });

  it('N4: undeclared observed component -> IMPLEMENTATION_DETAIL by default', () => {
    const observed = model([component('cache', 'datastore')]);
    const declared: ArchitectureGraphRef = { nodes: [], edges: [] };
    const [finding] = classifyDifferences(observed, declared);
    expect(finding).toMatchObject({ classification: 'IMPLEMENTATION_DETAIL', subject: 'cache' });
  });

  it('N4: undeclared observed component in expectedVariations -> EXPECTED_VARIATION', () => {
    const observed = model([component('cache', 'datastore')]);
    const declared: ArchitectureGraphRef = { nodes: [], edges: [] };
    const config: ClassificationConfig = { expectedVariations: ['cache'] };
    const [finding] = classifyDifferences(observed, declared, config);
    expect(finding).toMatchObject({ classification: 'EXPECTED_VARIATION', subject: 'cache' });
  });

  it('N4: undeclaredPolicy=EXPECTED_VARIATION classifies all undeclared subjects as expected variation', () => {
    const observed = model([component('cache', 'datastore'), component('sidecar', 'adapter')]);
    const declared: ArchitectureGraphRef = { nodes: [], edges: [] };
    const config: ClassificationConfig = { undeclaredPolicy: 'EXPECTED_VARIATION' };
    const map = findingsBySubject(classifyDifferences(observed, declared, config));
    expect(map).toEqual({ cache: 'EXPECTED_VARIATION', sidecar: 'EXPECTED_VARIATION' });
  });
});

describe('conformance classifier — edge rules', () => {
  it('X2: declared-and-present dependency with equal kinds is NOT reported', () => {
    const observed = model(
      [component('a', 'service'), component('b', 'service')],
      [{ source: 'a', target: 'b', kind: 'uses' }],
    );
    const declared: ArchitectureGraphRef = {
      nodes: [
        { id: 'a', kind: 'service' },
        { id: 'b', kind: 'service' },
      ],
      edges: [{ source: 'a', target: 'b', kind: 'uses' }],
    };
    expect(classifyDifferences(observed, declared)).toEqual([]);
  });

  it('X1: dependency kind mismatch -> UNKNOWN; pre-authorized -> INTENTIONAL_EVOLUTION', () => {
    const observed = model(
      [component('a', 'service'), component('b', 'service')],
      [{ source: 'a', target: 'b', kind: 'imports' }],
    );
    const declared: ArchitectureGraphRef = {
      nodes: [
        { id: 'a', kind: 'service' },
        { id: 'b', kind: 'service' },
      ],
      edges: [{ source: 'a', target: 'b', kind: 'uses' }],
    };
    const [finding] = classifyDifferences(observed, declared);
    expect(finding?.classification).toBe('UNKNOWN');
    expect(finding?.subject).toBe('a->b');

    const [authorized] = classifyDifferences(observed, declared, { intentionalEvolutions: ['a->b'] });
    expect(authorized?.classification).toBe('INTENTIONAL_EVOLUTION');
  });

  it('X3: declared dependency missing -> DRIFT; critical -> CONTRADICTION; authorized -> INTENTIONAL_EVOLUTION', () => {
    const observed = model([]);
    const declared: ArchitectureGraphRef = { nodes: [], edges: [{ source: 'a', target: 'b', kind: 'uses' }] };
    expect(classifyDifferences(observed, declared)[0]?.classification).toBe('DRIFT');
    const critical: ArchitectureGraphRef = {
      nodes: [],
      edges: [{ source: 'a', target: 'b', kind: 'uses', criticality: 'critical' }],
    };
    expect(classifyDifferences(observed, critical)[0]?.classification).toBe('CONTRADICTION');
    expect(
      classifyDifferences(observed, declared, { intentionalEvolutions: ['a->b'] })[0]?.classification,
    ).toBe('INTENTIONAL_EVOLUTION');
  });

  it('X4: undeclared observed dependency -> IMPLEMENTATION_DETAIL / EXPECTED_VARIATION by configuration', () => {
    const observed = model(
      [component('a', 'service'), component('b', 'service')],
      [{ source: 'a', target: 'b', kind: 'uses' }],
    );
    const declared: ArchitectureGraphRef = { nodes: [], edges: [] };
    const bySubject = (findings: ReturnType<typeof classifyDifferences>) =>
      findings.find((f) => f.subject === 'a->b')?.classification;
    expect(bySubject(classifyDifferences(observed, declared))).toBe('IMPLEMENTATION_DETAIL');
    expect(
      bySubject(classifyDifferences(observed, declared, { expectedVariations: ['a->b'] })),
    ).toBe('EXPECTED_VARIATION');
    expect(
      bySubject(classifyDifferences(observed, declared, { undeclaredPolicy: 'EXPECTED_VARIATION' })),
    ).toBe('EXPECTED_VARIATION');
  });

  it('reversed direction is a different edge (a->b is not b->a)', () => {
    const observed = model(
      [component('a', 'service'), component('b', 'service')],
      [{ source: 'b', target: 'a', kind: 'uses' }],
    );
    const declared: ArchitectureGraphRef = {
      nodes: [
        { id: 'a', kind: 'service' },
        { id: 'b', kind: 'service' },
      ],
      edges: [{ source: 'a', target: 'b', kind: 'uses' }],
    };
    const map = findingsBySubject(classifyDifferences(observed, declared));
    expect(map).toEqual({ 'a->b': 'DRIFT', 'b->a': 'IMPLEMENTATION_DETAIL' });
  });
});

describe('conformance classifier — composition, ordering, determinism', () => {
  it('produces exactly one finding per non-matching subject, nodes before edges, subjects ascending', () => {
    const observed = model(
      [component('zeta', 'service'), component('alpha', 'service'), component('extra', 'adapter')],
      [
        { source: 'zeta', target: 'alpha', kind: 'uses' },
        { source: 'alpha', target: 'extra', kind: 'calls' },
      ],
    );
    const declared: ArchitectureGraphRef = {
      nodes: [
        { id: 'alpha', kind: 'service' },
        { id: 'missing', kind: 'service' },
        { id: 'zeta', kind: 'service' },
      ],
      edges: [{ source: 'zeta', target: 'alpha', kind: 'uses' }],
    };
    const findings = classifyDifferences(observed, declared);
    expect(findings.map((f) => f.subject)).toEqual(['extra', 'missing', 'alpha->extra']);
    const subjects = new Set(findings.map((f) => f.subject));
    expect(subjects.size).toBe(findings.length);
  });

  it('is deterministic: identical inputs produce identical outputs across repeated calls', () => {
    const observed = model(
      [component('a', 'service'), component('b', 'adapter', ['c'])],
      [{ source: 'a', target: 'b', kind: 'uses' }],
    );
    const declared: ArchitectureGraphRef = {
      nodes: [{ id: 'a', kind: 'service' }, { id: 'c', kind: 'datastore', criticality: 'critical' }],
      edges: [{ source: 'a', target: 'c', kind: 'uses' }],
    };
    const config: ClassificationConfig = { expectedVariations: ['b'], intentionalEvolutions: ['a->c'] };
    const first = classifyDifferences(observed, declared, config);
    const second = classifyDifferences(observed, declared, config);
    expect(first).toEqual(second);
    // deep-clone inputs to prove no hidden mutable state
    const cloned = classifyDifferences(
      JSON.parse(JSON.stringify(observed)),
      JSON.parse(JSON.stringify(declared)),
      JSON.parse(JSON.stringify(config)),
    );
    expect(cloned).toEqual(first);
  });

  it('every finding carries a valid classification, a subject and a non-empty reason', () => {
    const observed = model([component('x', 'service'), component('y', 'service')]);
    const declared: ArchitectureGraphRef = {
      nodes: [{ id: 'x', kind: 'service' }, { id: 'gone', kind: 'service' }],
      edges: [{ source: 'x', target: 'y', kind: 'uses' }],
    };
    for (const finding of classifyDifferences(observed, declared)) {
      expect(CONFORMANCE_CLASSES).toContain(finding.classification);
      expect(typeof finding.subject).toBe('string');
      expect(finding.subject.length).toBeGreaterThan(0);
      expect(typeof finding.reason).toBe('string');
      expect(finding.reason.length).toBeGreaterThan(0);
      expect(isConformanceFinding(finding)).toBe(true);
    }
  });

  it('validates inputs: duplicates and malformed structures throw', () => {
    const observed = model([component('a', 'service')]);
    expect(() =>
      classifyDifferences(observed, {
        nodes: [{ id: 'a', kind: 'x' }, { id: 'a', kind: 'y' }],
        edges: [],
      }),
    ).toThrow(ConformanceError);
    expect(() =>
      classifyDifferences(observed, {
        nodes: [],
        edges: [
          { source: 'a', target: 'b', kind: 'x' },
          { source: 'a', target: 'b', kind: 'y' },
        ],
      }),
    ).toThrow(/duplicate declared edge/);
    expect(() =>
      classifyDifferences(model([component('a', 's'), component('a', 's2')]), { nodes: [], edges: [] }),
    ).toThrow(/duplicate observed component/);
    expect(() =>
      classifyDifferences(
        model([component('a', 's')], [
          { source: 'a', target: 'b', kind: 'x' },
          { source: 'a', target: 'b', kind: 'y' },
        ]),
        { nodes: [], edges: [] },
      ),
    ).toThrow(/duplicate observed dependency/);
    expect(() =>
      classifyDifferences(observed, { nodes: [{ id: 'a', kind: 'x', criticality: 'ultra' as never }], edges: [] }),
    ).toThrow(/criticality/);
    expect(() =>
      classifyDifferences(observed, { nodes: [], edges: [] }, { undeclaredPolicy: 'WHATEVER' as never }),
    ).toThrow(/undeclaredPolicy/);
    expect(() => classifyDifferences({ bad: true } as never, { nodes: [], edges: [] })).toThrow(
      /ImplementationModel/,
    );
  });
});
