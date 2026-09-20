import { describe, expect, it } from 'vitest';
import { createPackageComposition, evaluateOwnEvidence, assertOwnEvidence } from '../src/index.js';
import type { OwnEvidenceVerdict, PackageCompositionContent } from '../src/index.js';
import { mintRandomArtifactId } from '@sos-2/semantic-spine';
import {
  DURABLE_STORE_PACKAGE,
  GOLDEN_PACKAGE,
  T0,
  memberEvidence,
  ownFailureEvidence,
  ownInterventionalEvidence,
  ownSuccessEvidence,
  sampleCompositionArtifact,
} from './helpers.js';

/**
 * THE locked-invariant tests: composition evidence is INDEPENDENT of member
 * evidence; composition validity does NOT derive from member validity.
 */
describe('composition own-evidence discipline (independence of member evidence)', () => {
  it('accepts own evidence (subject = the composition id)', () => {
    const composition = sampleCompositionArtifact();
    const records = [ownSuccessEvidence(composition.envelope.id), ownComparativeFixture(composition)];
    const verdict = evaluateOwnEvidence(
      records.map((record) => record.id),
      records,
      composition.envelope.id,
    );
    expect(verdict.valid).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.summary.total).toBe(2);
    expect(() =>
      assertOwnEvidence(
        records.map((record) => record.id),
        records,
        composition.envelope.id,
      ),
    ).not.toThrow();
  });

  it('accepts own evidence about a CHAIN ANCESTOR (the form-then-promote flow)', () => {
    const v1 = sampleCompositionArtifact();
    // Evidence observed the v1 composition; a later revision v2 cites it.
    const records = [ownSuccessEvidence(v1.envelope.id), ownComparativeFixture(v1)];
    const verdict = evaluateOwnEvidence(
      records.map((record) => record.id),
      records,
      'sos://PackageComposition/' + '1'.repeat(32), // v2's minted id (not yet known to the records
      [v1.envelope.id], // ...but v1 IS in v2's chain)
    );
    expect(verdict.valid).toBe(true);
  });

  it('REJECTS member evidence as composition evidence (member success never implies composition success)', () => {
    const composition = sampleCompositionArtifact();
    const memberIds = composition.content.members.map((member) => member.package_id);
    // Rich evidence about BOTH members — exactly what a member-validated
    // composition would cite if it were deriving validity from members.
    const memberRecords = [
      memberEvidence(memberIds[0]!),
      memberEvidence(memberIds[1]!),
      ownSuccessEvidence(memberIds[0]!), // also about member 1, not the composition
    ];
    const refs = memberRecords.map((record) => record.id);
    const verdict = evaluateOwnEvidence(refs, memberRecords, composition.envelope.id);
    expect(verdict.valid).toBe(false);
    expect(verdict.foreign_refs).toEqual(refs);
    expect(verdict.reasons.join(' ')).toMatch(/not composition evidence/);
    expect(verdict.reasons.join(' ')).toMatch(/independence is a locked invariant/);
    expect(() => assertOwnEvidence(refs, memberRecords, composition.envelope.id)).toThrow(
      /member success never implies composition success/,
    );
  });

  it('REJECTS dangling refs and the empty evidence set', () => {
    const composition = sampleCompositionArtifact();
    const verdict = evaluateOwnEvidence(
      ['sos://Evidence/' + '0'.repeat(32)],
      [],
      composition.envelope.id,
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/dangling evidence refs/);
    const empty: OwnEvidenceVerdict = evaluateOwnEvidence([], [], composition.envelope.id);
    expect(empty.valid).toBe(false);
    expect(empty.reasons.join(' ')).toMatch(/empty evidence set/);
  });

  it('the verdict is a pure deterministic function of its input', () => {
    const composition = sampleCompositionArtifact();
    const records = [ownSuccessEvidence(composition.envelope.id)];
    const a = evaluateOwnEvidence(records.map((r) => r.id), records, composition.envelope.id);
    const b = evaluateOwnEvidence(records.map((r) => r.id), records, composition.envelope.id);
    expect(a).toEqual(b);
  });

  it('a VALIDATED composition can be created with own evidence through the explicit-id flow', () => {
    // Members: golden packages. One member is richly validated, the other
    // merely DISCOVERED — composition validity does not derive from member
    // validity in EITHER direction.
    const id = mintRandomArtifactId('PackageComposition');
    const records = [ownSuccessEvidence(id), ownInterventionalEvidence(id)];
    const composition = createPackageComposition({
      content: {
        semantic_capability: 'explicitly-validated-composition',
        contracts: ['contract:explicit/v1'],
        members: [
          { package_id: GOLDEN_PACKAGE.envelope.id, role: 'spine', bound_contracts: ['sos://schema/trace-link'] },
          { package_id: DURABLE_STORE_PACKAGE.envelope.id, role: 'store', bound_contracts: ['contract:durable-store/v1'] },
        ],
        bindings: [
          {
            kind: 'PROVIDES_TO',
            source_role: 'spine',
            target_role: 'store',
            contract: 'contract:explicit/v1',
            wiring: {},
          },
        ],
        preconditions: ['members exist'],
        postconditions: ['composed capability realized'],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'UNQUANTIFIED',
            context: { environment: 'test' },
            sample_size: 0,
            window: null,
          },
        ],
        evidence_refs: records.map((record) => record.id),
        failure_refs: [],
        compatibility_refs: [],
        assurance_obligations: [{ kind: 'TEST', obligation: 'composed tests pass' }],
        context: { environment: 'test' },
        learned_limitations: [],
        diversity_profile: {
          family: 'write-through-store',
          dimensions: [{ dimension: 'RESILIENCE', stance: 'strong durability' }],
        },
        maturity: 'VALIDATED',
        independence: [],
        changes: 'created validated with own evidence',
        superseded_by: null,
      },
      provenance: ['w6:test'],
      created_at: T0,
      id,
    });
    expect(composition.envelope.id).toBe(id);
    expect(composition.content.maturity).toBe('VALIDATED');
    expect(() =>
      assertOwnEvidence(
        composition.content.evidence_refs,
        records,
        composition.envelope.id,
      ),
    ).not.toThrow();
  });

  it('a VALIDATED composition WITHOUT own evidence refs is rejected at creation (content discipline)', () => {
    expect(() =>
      createPackageComposition({
        content: {
          ...sampleArtifactContentValidated(),
          evidence_refs: [],
        },
        provenance: ['w6:test'],
        created_at: T0,
      }),
    ).toThrow(/must carry its own evidence/);
  });
});

function ownComparativeFixture(composition: { envelope: { id: string } }): ReturnType<typeof ownSuccessEvidence> {
  return ownSuccessEvidence(composition.envelope.id, 1);
}

function sampleArtifactContentValidated(): PackageCompositionContent {
  const artifact = sampleCompositionArtifact();
  return { ...artifact.content, maturity: 'VALIDATED', evidence_refs: ['sos://Evidence/' + 'a'.repeat(32)] };
}
