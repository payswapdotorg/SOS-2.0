import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalCompositionText,
  combineMemberProbabilities,
  compositionArtifactId,
  compositionHash,
  createPackageComposition,
  evaluateOwnEvidence,
  validateCompositionArtifact,
} from '../src/index.js';
import type {
  CreateCompositionInput,
  IndependenceJustification,
  MemberProbability,
  PackageCompositionContent,
} from '../src/index.js';
import {
  DURABLE_STORE_PACKAGE,
  GOLDEN_PACKAGE,
  T0,
  ownSuccessEvidence,
} from './helpers.js';

const fcRole = fc.stringMatching(/^[a-z][a-z0-9-]{1,14}$/);

const fcContext = fc
  .uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{1,18}$/), { minLength: 1, maxLength: 3 })
  .map((keys) => {
    const context: Record<string, string> = {};
    for (const key of keys) {
      context[key] = 'v';
    }
    return context;
  });

const fcContent: fc.Arbitrary<PackageCompositionContent> = fc
  .record({
    semantic_capability: fc.stringMatching(/^[a-z][a-z0-9-]{2,30}$/),
    contracts: fc.uniqueArray(fc.stringMatching(/^contract:[a-z0-9-]+\/v[0-9]$/), { minLength: 1, maxLength: 3 }),
    roleA: fcRole,
    roleB: fcRole,
    bindingKind: fc.constantFrom('PROVIDES_TO', 'CONSUMES_FROM', 'CONFIGURES', 'DATA_FLOW', 'CONTROL_FLOW') as fc.Arbitrary<
      'PROVIDES_TO' | 'CONSUMES_FROM' | 'CONFIGURES' | 'DATA_FLOW' | 'CONTROL_FLOW'
    >,
    contract: fc.stringMatching(/^contract:[a-z0-9-]+\/v[0-9]$/),
    maturity: fc.constantFrom('DISCOVERED', 'FORMING') as fc.Arbitrary<'DISCOVERED' | 'FORMING'>,
    changes: fc.stringMatching(/^[a-z ]{4,40}$/),
    applicability: fc.record({
      kind: fc.constant('QUALITATIVE' as const),
      uncertainty_class: fc.constantFrom('STRONG', 'MODERATE', 'WEAK', 'UNQUANTIFIED') as fc.Arbitrary<
        'STRONG' | 'MODERATE' | 'WEAK' | 'UNQUANTIFIED'
      >,
      context: fcContext,
      sample_size: fc.nat(20),
      window: fc.constant<null>(null),
    }),
  })
  .filter((partial) => partial.roleA !== partial.roleB)
  .map((partial) => {
    const content: PackageCompositionContent = {
      semantic_capability: partial.semantic_capability,
      contracts: partial.contracts,
      members: [
        { package_id: GOLDEN_PACKAGE.envelope.id, role: partial.roleA, bound_contracts: ['sos://schema/trace-link'] },
        { package_id: DURABLE_STORE_PACKAGE.envelope.id, role: partial.roleB, bound_contracts: ['contract:durable-store/v1'] },
      ],
      bindings: [
        {
          kind: partial.bindingKind,
          source_role: partial.roleA,
          target_role: partial.roleB,
          contract: partial.contract,
          wiring: { generated: true },
        },
      ],
      preconditions: ['members are registered'],
      postconditions: ['the composed capability is realized'],
      applicability: [partial.applicability],
      evidence_refs: [],
      failure_refs: [],
      compatibility_refs: [],
      assurance_obligations: [{ kind: 'REPLAY', obligation: 'replay preserves the composed chain' }],
      context: { env: 'test' },
      learned_limitations: [],
      diversity_profile: {
        family: 'generated-family',
        dimensions: [{ dimension: 'RESILIENCE', stance: 'generated stance' }],
      },
      maturity: partial.maturity,
      independence: [],
      changes: partial.changes,
      superseded_by: null,
    };
    return content;
  });

const fcInput: fc.Arbitrary<CreateCompositionInput> = fc
  .record({
    content: fcContent,
    provenance: fc.array(fc.stringMatching(/^w6:[a-z-]{2,20}$/), { minLength: 1, maxLength: 2 }),
    created_at: fc.constant(T0),
  })
  .map((partial) => partial as CreateCompositionInput);

describe('composition artifact properties (deterministic, contract-conformant)', () => {
  it('always mints valid artifacts with spine PackageComposition ids', () => {
    fc.assert(
      fc.property(fcInput, (input) => {
        const artifact = createPackageComposition(input);
        expect(validateCompositionArtifact(artifact)).toBe(true);
        expect(artifact.envelope.id).toMatch(/^sos:\/\/PackageComposition\/[0-9a-f]{32}$/);
        expect(artifact.envelope.kind).toBe('PackageComposition');
        return true;
      }),
    );
  });

  it('is deterministic: identical inputs yield identical artifacts, ids and hashes', () => {
    fc.assert(
      fc.property(fcInput, (input) => {
        const a = createPackageComposition(input);
        const b = createPackageComposition(input);
        expect(a).toEqual(b);
        expect(a.envelope.id).toBe(b.envelope.id);
        expect(compositionHash(a)).toBe(compositionHash(b));
        expect(compositionArtifactId(input)).toBe(a.envelope.id);
        return true;
      }),
    );
  });

  it('canonical round trips are byte-identical', () => {
    fc.assert(
      fc.property(fcInput, (input) => {
        const artifact = createPackageComposition(input);
        const text = canonicalCompositionText(artifact);
        const parsed = JSON.parse(text);
        expect(canonicalCompositionText(parsed)).toBe(text);
        expect(parsed).toEqual(artifact);
        return true;
      }),
    );
  });
});

describe('independence discipline properties', () => {
  const fcJustification: fc.Arbitrary<IndependenceJustification> = fc.record({
    basis: fc.constantFrom(...( ['DESIGNED_ISOLATION', 'MEASURED_NON_CORRELATION', 'DISJOINT_FAILURE_MODES', 'ARCHITECTURAL_PARTITION'] as const )),
    justification: fc.stringMatching(/^[a-z ]{8,60}$/),
  });
  const fcMemberProbabilities: fc.Arbitrary<MemberProbability[]> = fc
    .tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }))
    .map(([pA, pB]) => [
      { package_id: GOLDEN_PACKAGE.envelope.id, probability: pA },
      { package_id: DURABLE_STORE_PACKAGE.envelope.id, probability: pB },
    ]);

  it('justified combinations always carry the exact product and the justification', () => {
    fc.assert(
      fc.property(fcMemberProbabilities, fcJustification, (members, justification) => {
        const combined = combineMemberProbabilities(members, justification);
        expect(combined.value).toBeCloseTo(members[0]!.probability * members[1]!.probability, 15);
        expect(combined.method).toBe('INDEPENDENCE_JUSTIFIED_PRODUCT');
        expect(combined.justification).toEqual(justification);
        return true;
      }),
    );
  });

  it('the unjustified path ALWAYS throws, for every generated input', () => {
    fc.assert(
      fc.property(fcMemberProbabilities, (members) => {
        expect(() => combineMemberProbabilities(members)).toThrow(/unjustified probability multiplication rejected/);
        return true;
      }),
    );
  });
});

describe('own-evidence discipline properties', () => {
  it('own evidence acceptance depends ONLY on subject membership in the chain (never on member evidence)', () => {
    fc.assert(
      fc.property(fcContent, (content) => {
        const composition = createPackageComposition({ content, provenance: ['w6:test'], created_at: T0 });
        const own = [ownSuccessEvidence(composition.envelope.id)];
        const memberEvidence = ownSuccessEvidence(composition.content.members[0]!.package_id);
        const refs = [...own.map((record) => record.id), memberEvidence.id];
        const records = [...own, memberEvidence];
        const verdict = evaluateOwnEvidence(refs, records, composition.envelope.id);
        expect(verdict.valid).toBe(false);
        expect(verdict.foreign_refs).toEqual([memberEvidence.id]);
        return true;
      }),
    );
  });
});
