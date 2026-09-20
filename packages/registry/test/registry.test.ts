import { describe, expect, it } from 'vitest';
import { createPackageComposition } from '@sos-2/composition';
import { createPackageArtifact } from '@sos-2/packages';
import type { PackageArtifact } from '@sos-2/packages';
import { PackageRegistry } from '../src/index.js';
import {
  T0,
  T1,
  T2,
  T3,
  buildPackage,
  failureEvidence,
  registerAndPromotePackage,
  successEvidence,
  comparativeEvidence,
  makeEvidence,
} from './helpers.js';

function spec(seed: string, overrides: Partial<Parameters<typeof buildPackage>[0]> = {}) {
  return {
    capability: 'test-capability',
    family: 'test-family',
    dimension: 'COST' as const,
    stance: 'cheap',
    evidence: [successEvidence('sos://SystemState/' + '1'.repeat(32)), comparativeEvidence('sos://SystemState/' + '1'.repeat(32))],
    seed,
    ...overrides,
  };
}

describe('registry registration (put, chain discipline)', () => {
  it('registers roots and answers get/has/list deterministically', () => {
    const registry = new PackageRegistry();
    const artifact = buildPackage(spec('root'));
    registry.putPackage(artifact);
    expect(registry.has(artifact.envelope.id)).toBe(true);
    expect(registry.get(artifact.envelope.id)!.artifact).toEqual(artifact);
    expect(registry.size).toBe(1);
    expect(registry.list().map((entry) => entry.artifact.envelope.id)).toEqual([artifact.envelope.id]);
  });

  it('re-put of identical content is idempotent; different content under the same id is a collision', () => {
    const registry = new PackageRegistry();
    const artifact = buildPackage(spec('idem'));
    expect(() => registry.putPackage(artifact)).not.toThrow();
    expect(registry.size).toBe(1);
    expect(() => registry.putPackage(artifact)).not.toThrow();
    expect(registry.size).toBe(1);
    const mutated = structuredClone(artifact) as PackageArtifact;
    mutated.content.learned_limitations = ['changed'];
    expect(() => registry.putPackage(mutated)).toThrow(/collision/);
  });

  it('REJECTS branching chains, non-contiguous versions and cross-kind supersession', () => {
    const registry = new PackageRegistry();
    const v1 = buildPackage(spec('chain'));
    registry.putPackage(v1);
    const v2content = { ...structuredClone(v1.content), changes: 'revision', evidence_refs: v1.content.evidence_refs };
    const v2 = createPackageArtifact({
      content: v2content,
      provenance: ['w6:registry-test:chain:v2'],
      created_at: T1,
      status: 'ACTIVE',
      version: 2,
      supersedes: v1.envelope.id,
    });
    registry.putPackage(v2);
    expect(registry.current(v1.envelope.id)!.artifact.envelope.id).toBe(v2.envelope.id);

    // Branching: another artifact also superseding v1.
    const branch = createPackageArtifact({
      content: { ...structuredClone(v1.content), changes: 'branch' },
      provenance: ['w6:registry-test:chain:branch'],
      created_at: T1,
      status: 'ACTIVE',
      version: 2,
      supersedes: v1.envelope.id,
    });
    expect(() => registry.putPackage(branch)).toThrow(/branching chain rejected/);

    // Non-contiguous: version 4 superseding v2.
    const gap = createPackageArtifact({
      content: { ...structuredClone(v2.content), changes: 'gap' },
      provenance: ['w6:registry-test:chain:gap'],
      created_at: T2,
      status: 'ACTIVE',
      version: 4,
      supersedes: v2.envelope.id,
    });
    expect(() => registry.putPackage(gap)).toThrow(/non-contiguous revision/);

    // Cross-kind: a composition cannot supersede a package chain.
    const crossKind = createPackageComposition({
      content: {
        semantic_capability: 'test-capability',
        contracts: ['contract:samples/v1'],
        members: [
          { package_id: v1.envelope.id, role: 'a', bound_contracts: ['contract:samples/v1'] },
          { package_id: v2.envelope.id, role: 'b', bound_contracts: ['contract:samples/v1'] },
        ],
        bindings: [
          { kind: 'DATA_FLOW', source_role: 'a', target_role: 'b', contract: 'contract:samples/v1', wiring: {} },
        ],
        preconditions: [],
        postconditions: [],
        applicability: [
          { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED', context: { x: '1' }, sample_size: 0, window: null },
        ],
        evidence_refs: [],
        failure_refs: [],
        compatibility_refs: [],
        assurance_obligations: [{ kind: 'TEST', obligation: 'x' }],
        context: { x: '1' },
        learned_limitations: [],
        diversity_profile: { family: 'f', dimensions: [{ dimension: 'COST', stance: 's' }] },
        maturity: 'FORMING',
        independence: [],
        changes: 'cross-kind attempt',
        superseded_by: null,
      },
      provenance: ['w6:registry-test:cross-kind'],
      created_at: T1,
      status: 'ACTIVE',
      version: 3,
      supersedes: v2.envelope.id,
    });
    expect(() => registry.putComposition(crossKind)).toThrow(/kind-homogeneous/);
  });

  it('REJECTS superseding revisions that drop failure refs (failure memory is monotonic)', () => {
    const registry = new PackageRegistry();
    const withFailure = buildPackage(spec('failures', { failures: [failureEvidence('sos://SystemState/' + '2'.repeat(32))] }));
    registry.putPackage(withFailure);
    const dropped = createPackageArtifact({
      content: { ...structuredClone(withFailure.content), changes: 'drops failures', failure_refs: [] },
      provenance: ['w6:registry-test:failures:v2'],
      created_at: T1,
      status: 'ACTIVE',
      version: 2,
      supersedes: withFailure.envelope.id,
    });
    expect(() => registry.putPackage(dropped)).toThrow(/failure-memory violation/);
    // Growing failures is fine.
    const grown = createPackageArtifact({
      content: {
        ...structuredClone(withFailure.content),
        changes: 'grows failures',
        failure_refs: [...withFailure.content.failure_refs, failureEvidence('sos://SystemState/' + '3'.repeat(32)).id],
      },
      provenance: ['w6:registry-test:failures:v3'],
      created_at: T1,
      status: 'ACTIVE',
      version: 2,
      supersedes: withFailure.envelope.id,
    });
    expect(() => registry.putPackage(grown)).not.toThrow();
  });

  it('REJECTS same-chain capability changes (a different capability is a different package)', () => {
    const registry = new PackageRegistry();
    const v1 = buildPackage(spec('capability'));
    registry.putPackage(v1);
    const v2 = createPackageArtifact({
      content: { ...structuredClone(v1.content), semantic_capability: 'another-capability', changes: 'renamed' },
      provenance: ['w6:registry-test:capability:v2'],
      created_at: T1,
      status: 'ACTIVE',
      version: 2,
      supersedes: v1.envelope.id,
    });
    expect(() => registry.putPackage(v2)).toThrow(/semantic_capability is invariant/);
  });

  it('REJECTS maturity-changing direct puts (maturity changes go through promote)', () => {
    const registry = new PackageRegistry();
    const v1 = buildPackage(spec('maturity-put'));
    registry.putPackage(v1);
    const v2 = createPackageArtifact({
      content: { ...structuredClone(v1.content), maturity: 'FORMING', changes: 'sneaky maturity' },
      provenance: ['w6:registry-test:maturity:v2'],
      created_at: T1,
      status: 'ACTIVE',
      version: 2,
      supersedes: v1.envelope.id,
    });
    expect(() => registry.putPackage(v2)).toThrow(/maturity changes go through promote/);
  });
});

describe('maturity promotion (the only maturity-changing path)', () => {
  it('promotes DISCOVERED -> FORMING -> VALIDATED with version bumps and history', () => {
    const registry = new PackageRegistry();
    const evidence = [
      successEvidence('sos://SystemState/' + '4'.repeat(32)),
      comparativeEvidence('sos://SystemState/' + '4'.repeat(32)),
    ];
    const artifact = registerAndPromotePackage(registry, spec('promote', { evidence }), 'VALIDATED');
    expect(artifact.content.maturity).toBe('VALIDATED');
    expect(artifact.envelope.version).toBe(3);
    const history = registry.history(artifact.envelope.id);
    expect(history).toHaveLength(3);
    expect(history.map((entry) => entry.artifact.envelope.version)).toEqual([1, 2, 3]);
    expect(history.map((entry) => entry.artifact.content.maturity)).toEqual(['DISCOVERED', 'FORMING', 'VALIDATED']);
    // All non-head revisions are envelope-SUPERSEDED; the head is ACTIVE.
    for (const entry of history.slice(0, -1)) {
      expect(entry.artifact.envelope.status).toBe('SUPERSEDED');
    }
    expect(history[history.length - 1]!.artifact.envelope.status).toBe('ACTIVE');
    expect(registry.current(history[0]!.artifact.envelope.id)!.artifact.envelope.id).toBe(artifact.envelope.id);
  });

  it('REJECTS promotion after one lucky success (end-to-end through the registry)', () => {
    const registry = new PackageRegistry();
    const single = [successEvidence('sos://SystemState/' + '5'.repeat(32))];
    const artifact = buildPackage(spec('lucky', { evidence: single }));
    registry.putPackage(artifact);
    expect(() =>
      registry.promote({
        id: artifact.envelope.id,
        target: 'FORMING',
        evidence: single,
        provenance: ['t'],
        created_at: T1,
        changes: 'forming',
      }),
    ).not.toThrow();
    const head = registry.current(artifact.envelope.id)!.artifact.envelope.id;
    expect(() =>
      registry.promote({
        id: head,
        target: 'VALIDATED',
        evidence: single,
        additional_realizations: [{ ref: 'sos://ImplementationModel/' + '6'.repeat(32), revision: null, note: 'r' }],
        provenance: ['t'],
        created_at: T2,
        changes: 'validated?',
      }),
    ).toThrow(/one lucky success/);
    // The failed promotion left the chain untouched.
    expect(registry.current(artifact.envelope.id)!.artifact.envelope.id).toBe(head);
    expect(registry.history(head)).toHaveLength(2);
  });

  it('REJECTS promoting a DRAFT head or a superseded revision; activate() is the DRAFT gate', () => {
    const registry = new PackageRegistry();
    const draft = buildPackage(spec('draft'));
    const asDraft = createPackageArtifact({
      content: draft.content,
      provenance: ['w6:registry-test:draft'],
      created_at: T0,
      status: 'DRAFT',
    });
    registry.putPackage(asDraft);
    expect(() =>
      registry.promote({
        id: asDraft.envelope.id,
        target: 'FORMING',
        evidence: [makeEvidence('sos://SystemState/' + '7'.repeat(32))],
        provenance: ['t'],
        created_at: T1,
        changes: 'x',
      }),
    ).toThrow(/only an ACTIVE head can be promoted/);
    registry.activate(asDraft.envelope.id);
    expect(registry.get(asDraft.envelope.id)!.artifact.envelope.status).toBe('ACTIVE');
  });

  it('supersede + retire: terminal maturity, replacement links, current() honesty', () => {
    const registry = new PackageRegistry();
    const evidence = [
      successEvidence('sos://SystemState/' + '8'.repeat(32), 0),
      successEvidence('sos://SystemState/' + '8'.repeat(32), 1),
      comparativeEvidence('sos://SystemState/' + '8'.repeat(32)),
    ];
    const validated = registerAndPromotePackage(registry, spec('supersede', { evidence }), 'VALIDATED');
    const replacement = buildPackage(spec('replacement', { evidence }));
    registry.putPackage(replacement);
    const result = registry.promote({
      id: validated.envelope.id,
      target: 'SUPERSEDED',
      superseded_by: replacement.envelope.id,
      provenance: ['t'],
      created_at: T3,
      changes: 'replaced by the replacement package',
    });
    expect(result.promoted.artifact.content.maturity).toBe('SUPERSEDED');
    expect(result.promoted.artifact.content.superseded_by).toBe(replacement.envelope.id);
    // current() is honest: the head carries SUPERSEDED maturity + the replacement.
    const head = registry.current(validated.envelope.id)!;
    expect(head.artifact.content.maturity).toBe('SUPERSEDED');
    expect(registry.replacementOf(validated.envelope.id)).toBe(replacement.envelope.id);
    // The chain cannot be promoted further.
    expect(() =>
      registry.promote({ id: head.artifact.envelope.id, target: 'RETIRED', provenance: ['t'], created_at: T3, changes: 'x' }),
    ).toThrow(/terminal|strict/);
  });

  it('retire() is the administrative terminal path', () => {
    const registry = new PackageRegistry();
    const artifact = buildPackage(spec('retire'));
    registry.putPackage(artifact);
    const result = registry.retire({
      id: artifact.envelope.id,
      provenance: ['t'],
      created_at: T1,
      changes: 'abandoned',
    });
    expect(result.promoted.artifact.content.maturity).toBe('RETIRED');
    expect(registry.current(artifact.envelope.id)!.artifact.content.maturity).toBe('RETIRED');
  });
});

describe('composition registration (members, compatibility, COMPOSES links)', () => {
  it('REJECTS compositions with unregistered members', () => {
    const registry = new PackageRegistry();
    const ghost = 'sos://Package/' + '9'.repeat(32);
    expect(() =>
      registry.putComposition(
        createPackageComposition({
          content: {
            semantic_capability: 'ghost-composition',
            contracts: ['contract:samples/v1'],
            members: [
              { package_id: ghost, role: 'a', bound_contracts: ['contract:samples/v1'] },
              { package_id: 'sos://Package/' + '8'.repeat(32), role: 'b', bound_contracts: ['contract:samples/v1'] },
            ],
            bindings: [
              { kind: 'DATA_FLOW', source_role: 'a', target_role: 'b', contract: 'contract:samples/v1', wiring: {} },
            ],
            preconditions: [],
            postconditions: [],
            applicability: [
              { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED', context: { x: '1' }, sample_size: 0, window: null },
            ],
            evidence_refs: [],
            failure_refs: [],
            compatibility_refs: [],
            assurance_obligations: [{ kind: 'TEST', obligation: 'x' }],
            context: { x: '1' },
            learned_limitations: [],
            diversity_profile: { family: 'f', dimensions: [{ dimension: 'COST', stance: 's' }] },
            maturity: 'FORMING',
            independence: [],
            changes: 'ghost members',
            superseded_by: null,
          },
          provenance: ['w6:registry-test:ghost'],
          created_at: T0,
        }),
      ),
    ).toThrow(/member is not registered/);
  });

  it('REJECTS compositions binding contracts the member does not declare (compatibility)', () => {
    const registry = new PackageRegistry();
    const memberA = buildPackage(spec('compat-a'));
    const memberB = buildPackage(spec('compat-b'));
    registry.putPackage(memberA);
    registry.putPackage(memberB);
    const composition = createPackageComposition({
      content: {
        semantic_capability: 'compat-composition',
        contracts: ['contract:samples/v1'],
        members: [
          { package_id: memberA.envelope.id, role: 'a', bound_contracts: ['contract:not-declared/v9'] },
          { package_id: memberB.envelope.id, role: 'b', bound_contracts: ['contract:samples/v1'] },
        ],
        bindings: [
          { kind: 'DATA_FLOW', source_role: 'a', target_role: 'b', contract: 'contract:samples/v1', wiring: {} },
        ],
        preconditions: [],
        postconditions: [],
        applicability: [
          { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED', context: { x: '1' }, sample_size: 0, window: null },
        ],
        evidence_refs: [],
        failure_refs: [],
        compatibility_refs: [],
        assurance_obligations: [{ kind: 'TEST', obligation: 'x' }],
        context: { x: '1' },
        learned_limitations: [],
        diversity_profile: { family: 'f', dimensions: [{ dimension: 'COST', stance: 's' }] },
        maturity: 'FORMING',
        independence: [],
        changes: 'compat check',
        superseded_by: null,
      },
      provenance: ['w6:registry-test:compat'],
      created_at: T0,
    });
    expect(() => registry.putComposition(composition)).toThrow(
      /which the member does not declare \(reuse never bypasses compatibility\)/,
    );
  });

  it('mints the spine COMPOSES links and answers compositionsFor', () => {
    const registry = new PackageRegistry();
    const memberA = buildPackage(spec('links-a'));
    const memberB = buildPackage(spec('links-b'));
    registry.putPackage(memberA);
    registry.putPackage(memberB);
    const composition = createPackageComposition({
      content: {
        semantic_capability: 'links-composition',
        contracts: ['contract:samples/v1'],
        members: [
          { package_id: memberA.envelope.id, role: 'a', bound_contracts: ['contract:samples/v1'] },
          { package_id: memberB.envelope.id, role: 'b', bound_contracts: ['contract:samples/v1'] },
        ],
        bindings: [
          { kind: 'DATA_FLOW', source_role: 'a', target_role: 'b', contract: 'contract:samples/v1', wiring: {} },
        ],
        preconditions: [],
        postconditions: [],
        applicability: [
          { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED', context: { x: '1' }, sample_size: 0, window: null },
        ],
        evidence_refs: [],
        failure_refs: [],
        compatibility_refs: [],
        assurance_obligations: [{ kind: 'TEST', obligation: 'x' }],
        context: { x: '1' },
        learned_limitations: [],
        diversity_profile: { family: 'f', dimensions: [{ dimension: 'COST', stance: 's' }] },
        maturity: 'FORMING',
        independence: [],
        changes: 'links',
        superseded_by: null,
      },
      provenance: ['w6:registry-test:links'],
      created_at: T0,
    });
    registry.putComposition(composition);
    expect(registry.linkCount).toBe(2);
    const links = registry.linksTo(memberA.envelope.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.type).toBe('COMPOSES');
    expect(links[0]!.source).toBe(composition.envelope.id);
    expect(registry.compositionsFor(memberB.envelope.id).map((entry) => entry.artifact.envelope.id)).toEqual([
      composition.envelope.id,
    ]);
    // Idempotent re-put does not duplicate links.
    registry.putComposition(composition);
    expect(registry.linkCount).toBe(2);
  });

  it('REJECTS validated composition roots without their own evidence records', () => {
    const registry = new PackageRegistry();
    const memberA = buildPackage(spec('own-a'));
    const memberB = buildPackage(spec('own-b'));
    registry.putPackage(memberA);
    registry.putPackage(memberB);
    const composition = createPackageComposition({
      content: {
        semantic_capability: 'own-composition',
        contracts: ['contract:samples/v1'],
        members: [
          { package_id: memberA.envelope.id, role: 'a', bound_contracts: ['contract:samples/v1'] },
          { package_id: memberB.envelope.id, role: 'b', bound_contracts: ['contract:samples/v1'] },
        ],
        bindings: [
          { kind: 'DATA_FLOW', source_role: 'a', target_role: 'b', contract: 'contract:samples/v1', wiring: {} },
        ],
        preconditions: [],
        postconditions: [],
        applicability: [
          { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED', context: { x: '1' }, sample_size: 0, window: null },
        ],
        // Member evidence cited as composition evidence — REJECTED.
        evidence_refs: memberA.content.evidence_refs,
        failure_refs: [],
        compatibility_refs: [],
        assurance_obligations: [{ kind: 'TEST', obligation: 'x' }],
        context: { x: '1' },
        learned_limitations: [],
        diversity_profile: { family: 'f', dimensions: [{ dimension: 'COST', stance: 's' }] },
        maturity: 'VALIDATED',
        independence: [],
        changes: 'validated without own evidence',
        superseded_by: null,
      },
      provenance: ['w6:registry-test:own'],
      created_at: T0,
    });
    expect(() => registry.putComposition(composition)).toThrow(
      /must present its evidence records for gate validation/,
    );
  });
});
