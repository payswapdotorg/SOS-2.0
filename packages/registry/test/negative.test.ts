import { describe, expect, it } from 'vitest';
import { createPackageArtifact } from '@sos-2/packages';
import { createPackageComposition } from '@sos-2/composition';
import type { PackageContent } from '../src/index.js';
import { PackageRegistry } from '../src/index.js';
import {
  T0,
  buildPackage,
  makeEvidence,
  successEvidence,
  comparativeEvidence,
} from './helpers.js';

const baseSpec = (seed: string) => ({
  capability: 'negative-capability',
  family: 'negative-family',
  dimension: 'COST' as const,
  stance: 'cheap',
  evidence: [
    successEvidence('sos://SystemState/' + 'a'.repeat(32)),
    comparativeEvidence('sos://SystemState/' + 'a'.repeat(32)),
  ],
  seed,
});

describe('registry negative discipline', () => {
  it('REJECTS a validated-or-beyond live PACKAGE root without evidence records (promotion without evidence)', () => {
    const registry = new PackageRegistry();
    const discovered = buildPackage(baseSpec('validated-root'));
    const validated: PackageContent = {
      ...discovered.content,
      maturity: 'VALIDATED',
      realizations: [{ ref: 'sos://ImplementationModel/' + '1'.repeat(32), revision: null, note: 'the realization' }],
      changes: 'smuggled maturity',
    };
    const artifact = createPackageArtifact({
      content: validated,
      provenance: ['w6:registry-test:validated-root'],
      created_at: T0,
      status: 'ACTIVE',
    });
    expect(() => registry.putPackage(artifact)).toThrow(/must present its evidence records for gate validation/);
  });

  it('REJECTS a validated PACKAGE root whose evidence fails the entering gates (one lucky success)', () => {
    const registry = new PackageRegistry();
    const single = [makeEvidence('sos://SystemState/' + 'b'.repeat(32))];
    const discovered = buildPackage({ ...baseSpec('lucky-root'), evidence: single });
    const validated: PackageContent = {
      ...discovered.content,
      maturity: 'VALIDATED',
      realizations: [{ ref: 'sos://ImplementationModel/' + '2'.repeat(32), revision: null, note: 'the realization' }],
      changes: 'smuggled maturity',
    };
    const artifact = createPackageArtifact({
      content: validated,
      provenance: ['w6:registry-test:lucky-root'],
      created_at: T0,
      status: 'ACTIVE',
    });
    expect(() => registry.putPackage(artifact, single)).toThrow(/one lucky success/);
  });

  it('accepts a validated PACKAGE root WITH records that pass the gates (honest migration)', () => {
    const registry = new PackageRegistry();
    const evidence = [
      makeEvidence('sos://SystemState/' + 'c'.repeat(32)),
      comparativeEvidence('sos://SystemState/' + 'c'.repeat(32)),
    ];
    const discovered = buildPackage({ ...baseSpec('migration'), evidence });
    const validated: PackageContent = {
      ...discovered.content,
      maturity: 'VALIDATED',
      realizations: [{ ref: 'sos://ImplementationModel/' + 'd'.repeat(32), revision: null, note: 'the realization' }],
      changes: 'migrated validated package',
    };
    const artifact = createPackageArtifact({
      content: validated,
      provenance: ['w6:registry-test:migration'],
      created_at: T0,
      status: 'ACTIVE',
    });
    expect(() => registry.putPackage(artifact, evidence)).not.toThrow();
    expect(registry.get(artifact.envelope.id)!.artifact.content.maturity).toBe('VALIDATED');
  });

  it('REJECTS promote on unknown ids and malformed inputs', () => {
    const registry = new PackageRegistry();
    expect(() =>
      registry.promote({
        id: 'sos://Package/' + 'e'.repeat(32),
        target: 'FORMING',
        provenance: ['t'],
        created_at: T0,
        changes: 'x',
      }),
    ).toThrow(/unknown registry entry/);
    const artifact = buildPackage(baseSpec('promote-negative'));
    registry.putPackage(artifact);
    expect(() =>
      registry.promote({
        id: artifact.envelope.id,
        target: 'FORMING',
        provenance: [],
        created_at: T0,
        changes: 'x',
      }),
    ).toThrow(/provenance/);
    expect(() =>
      registry.promote({
        id: artifact.envelope.id,
        target: 'FORMING',
        provenance: ['t'],
        created_at: T0,
        changes: '',
      }),
    ).toThrow(/changes/);
    expect(() =>
      registry.promote({
        id: 'junk',
        target: 'FORMING',
        provenance: ['t'],
        created_at: T0,
        changes: 'x',
      }),
    ).toThrow(/well-formed spine artifact id/);
  });

  it('REJECTS promoting a superseded (non-head) revision', () => {
    const registry = new PackageRegistry();
    const evidence = [
      makeEvidence('sos://SystemState/' + 'f'.repeat(32)),
      comparativeEvidence('sos://SystemState/' + 'f'.repeat(32)),
    ];
    const root = buildPackage({ ...baseSpec('head-only'), evidence });
    registry.putPackage(root);
    registry.promote({
      id: root.envelope.id,
      target: 'FORMING',
      evidence,
      provenance: ['t'],
      created_at: T0,
      changes: 'forming',
    });
    const head = registry.current(root.envelope.id)!.artifact.envelope.id;
    expect(() =>
      registry.promote({ id: root.envelope.id, target: 'VALIDATED', evidence, provenance: ['t'], created_at: T0, changes: 'x' }),
    ).toThrow(/cannot promote a superseded entry/);
    // The head itself is promotable.
    expect(() =>
      registry.promote({
        id: head,
        target: 'VALIDATED',
        evidence,
        additional_realizations: [{ ref: 'sos://ImplementationModel/' + '0'.repeat(32), revision: null, note: 'r' }],
        provenance: ['t'],
        created_at: T0,
        changes: 'validated',
      }),
    ).not.toThrow();
  });

  it('REJECTS compositions as members at BOTH layers (members are packages)', () => {
    const registry = new PackageRegistry();
    const memberPackage = buildPackage(baseSpec('member-pkg'));
    registry.putPackage(memberPackage);
    const compositionId = 'sos://PackageComposition/' + 'a'.repeat(32);
    const content = {
      semantic_capability: 'nested-composition',
      contracts: ['contract:samples/v1'],
      members: [
        { package_id: memberPackage.envelope.id, role: 'a', bound_contracts: ['contract:samples/v1'] },
        { package_id: compositionId, role: 'b', bound_contracts: ['contract:samples/v1'] }, // a composition as member!
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
      changes: 'nested',
      superseded_by: null,
    };
    // The composition layer rejects compositions as members at CREATION
    // (member ids must be sos://Package ids — members are packages).
    expect(() => createPackageComposition({ content, provenance: ['x'], created_at: T0, id: compositionId })).toThrow(
      /members are packages/,
    );
    // And therefore the registry layer never sees them either.
    expect(() => registry.putComposition(createPackageComposition({ content, provenance: ['x'], created_at: T0, id: compositionId }))).toThrow(
      /members are packages/,
    );
  });

  it('get/history/current answer honestly for unknown ids', () => {
    const registry = new PackageRegistry();
    expect(registry.get('sos://Package/' + 'i'.repeat(32))).toBeUndefined();
    expect(registry.has('sos://Package/' + 'i'.repeat(32))).toBe(false);
    expect(() => registry.history('junk')).toThrow(/well-formed spine artifact id/);
    expect(registry.current('junk' as never)).toBeUndefined();
  });
});
