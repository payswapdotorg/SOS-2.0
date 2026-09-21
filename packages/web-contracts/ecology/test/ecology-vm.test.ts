/**
 * Ecology projection tests — the packages workspace acceptance:
 * contextual applicability, uncertainty, failures and assurance obligations
 * remain VISIBLE (never collapsed into a single score), and package
 * compositions carry their OWN independent evidence.
 */

import { describe, expect, test } from 'vitest';
import {
  assertValidPackageEcologyVM,
  COMPOSITION_OWN_EVIDENCE_NOTE,
  PACKAGE_APPLICABILITY_NOTE,
  PACKAGES_DIVERSITY_NOTE,
  projectComposition,
  projectPackageEcology,
  projectPackagesWorkspace,
} from '../src/index.js';
import type { PackageEcologyVM } from '../src/index.js';
import { allLinks, chainFor, demoSource, liveRead, world } from './helpers.js';

const w = world();
const source = demoSource();
const missionV2 = w.base.missions[w.base.missions.length - 1]!;
const queueV2 = w.packages.find((artifact) => artifact.envelope.version === 2 && artifact.content.semantic_capability.includes('Durable'))!;
const cacheV2 = w.packages.find((artifact) => artifact.envelope.version === 2 && artifact.content.semantic_capability.includes('Edge-cached'))!;
const compositionV2 = w.compositions[w.compositions.length - 1]!;
const compositionV1 = w.compositions[0]!;

const authority = {
  mode: 'AUTONOMOUS_WITH_ASK' as const,
  required_permission: null,
  grant_ref: null,
  note: 'Package reuse is gated by each package own assurance obligations, not by this view.',
};

function pkgVM(artifact: typeof queueV2): PackageEcologyVM {
  return projectPackageEcology({
    artifact,
    rationale: chainFor(artifact.envelope.id, allLinks(w), artifact.content.evidence_refs),
    data_source: source,
    uncertainty: {
      uncertainty_class: 'MODERATE',
      statement: 'Applicability is context-conditioned; each estimate carries its own uncertainty class.',
    },
    authority,
    next_allowed_action: {
      action_id: `review-${artifact.envelope.id.slice(-6)}`,
      kind: 'REVIEW',
      label: 'Review this package',
      description: 'See the capability, its context-conditioned applicability and its retained limitations.',
      href: '/packages',
      rationale_ref: artifact.envelope.id,
      requires_authority: null,
    },
  });
}

test('the demo world carries two package chains and one composition chain', () => {
  expect(w.packages.map((artifact) => artifact.envelope.version)).toEqual([1, 2, 1, 2]);
  expect(w.packages.map((artifact) => artifact.envelope.status)).toEqual(['SUPERSEDED', 'ACTIVE', 'SUPERSEDED', 'ACTIVE']);
  expect(w.compositions.map((artifact) => artifact.envelope.version)).toEqual([1, 2]);
  expect(compositionV2.envelope.supersedes).toBe(compositionV1.envelope.id);
});

describe('package ecology projections (visibility is structural)', () => {
  const vm = pkgVM(cacheV2);

  test('preserves EVERY context-conditioned applicability estimate verbatim', () => {
    expect(vm.applicability).toHaveLength(cacheV2.content.applicability.length);
    expect(vm.applicability).toEqual(cacheV2.content.applicability);
    expect(vm.applicability_note).toBe(PACKAGE_APPLICABILITY_NOTE);
  });

  test('keeps the retained failure refs visible (negative evidence is retained)', () => {
    expect(vm.failure_refs).toEqual(cacheV2.content.failure_refs);
    expect(vm.failure_refs.length).toBeGreaterThan(0);
  });

  test('keeps the assurance obligations attached to reuse', () => {
    expect(vm.assurance_obligations).toEqual(cacheV2.content.assurance_obligations);
    expect(vm.assurance_obligations.length).toBeGreaterThan(0);
  });

  test('keeps the diversity family and dimension stances verbatim (never collapsed)', () => {
    expect(vm.family).toBe(cacheV2.content.diversity_profile.family);
    expect(vm.dimensions).toEqual(cacheV2.content.diversity_profile.dimensions);
  });

  test('keeps preconditions, postconditions, learned limitations and the composition participation', () => {
    expect(vm.preconditions).toEqual(cacheV2.content.preconditions);
    expect(vm.postconditions).toEqual(cacheV2.content.postconditions);
    expect(vm.learned_limitations).toEqual(cacheV2.content.learned_limitations);
    expect(vm.composition_refs).toEqual([compositionV2.envelope.id]);
    expect(vm.supersedes).toBe(cacheV2.envelope.supersedes);
  });

  test('carries the full P1 product core (what/why/evidence/uncertainty/authority/next)', () => {
    expect(vm.core.subject_id).toBe(cacheV2.envelope.id);
    expect(vm.core.data_source.kind).toBe('DEMO');
    expect(vm.core.next_allowed_action.kind).toBe('REVIEW');
    expect(vm.core.evidence_refs).toEqual([...new Set(cacheV2.content.evidence_refs)].sort());
  });

  test('a projection that drops the applicability estimates is rejected by the validator', () => {
    expect(() => assertValidPackageEcologyVM({ ...vm, applicability: [] })).toThrow(/applicability/);
    expect(() => assertValidPackageEcologyVM({ ...vm, assurance_obligations: [] })).toThrow(/assurance/);
    expect(() => assertValidPackageEcologyVM({ ...vm, failure_refs: undefined })).toThrow(/failure refs/);
    expect(() => assertValidPackageEcologyVM({ ...vm, family: '' })).toThrow(/family/);
  });
});

describe('composition projections (independent evidence is structural)', () => {
  const allEvidence = [...w.base.evidence, ...w.composition_evidence, ...w.evolution_evidence];

  function compositionVM(artifact: typeof compositionV2, chainIds: string[]) {
    return projectComposition({
      artifact,
      chain_ids: chainIds,
      evidence: allEvidence,
      rationale: chainFor(artifact.envelope.id, allLinks(w), artifact.content.evidence_refs),
      data_source: source,
      uncertainty: {
        uncertainty_class: 'MODERATE',
        statement: 'Composed-system evidence covers one shadow window; full-exposure behavior is unproven.',
      },
      authority,
      next_allowed_action: {
        action_id: 'review-composition',
        kind: 'REVIEW',
        label: 'Open the composition detail',
        description: 'See the members, the typed wiring, the independence justification and the OWN evidence.',
        href: '/packages',
        rationale_ref: artifact.envelope.id,
        requires_authority: null,
      },
    });
  }

  test('the VALIDATED composition carries its OWN evidence (about the composition chain, not the members)', () => {
    const vm = compositionVM(compositionV2, [compositionV1.envelope.id]);
    expect(vm.own_evidence.valid).toBe(true);
    expect(vm.own_evidence.unresolved_refs).toEqual([]);
    expect(vm.own_evidence.foreign_refs).toEqual([]);
    expect(vm.core.evidence_refs.length).toBeGreaterThan(0);
    expect(vm.own_evidence.note).toBe(COMPOSITION_OWN_EVIDENCE_NOTE);
  });

  test('the OWN evidence is about the composition chain (its subject is the composition v1 id)', () => {
    for (const record of w.composition_evidence) {
      expect(record.subject_ref).toBe(compositionV1.envelope.id);
    }
  });

  test('member evidence is FOREIGN to the composition — the owning evaluator surfaces it, never folds it in', () => {
    // The queue member's own supporting evidence is about its realization —
    // evidence about the member's world, never about the composition.
    const memberEvidence = allEvidence.filter((record) =>
      w.packages.some((pkg) => pkg.content.evidence_refs.includes(record.id)),
    );
    expect(memberEvidence.length).toBeGreaterThan(0);
    const vm = compositionVM(
      {
        ...compositionV2,
        content: { ...compositionV2.content, evidence_refs: memberEvidence.map((record) => record.id) },
      },
      [compositionV1.envelope.id],
    );
    expect(vm.own_evidence.valid).toBe(false);
    expect(vm.own_evidence.foreign_refs).toEqual(memberEvidence.map((record) => record.id).sort());
    expect(vm.own_evidence.reasons.join(' ')).toContain('independence');
  });

  test('the independence assessment is a JUSTIFIED combined probability (never an unjustified product)', () => {
    const vm = compositionVM(compositionV2, [compositionV1.envelope.id]);
    expect(vm.independence).toHaveLength(1);
    const assessment = vm.independence[0]!;
    expect(assessment.method).toBe('INDEPENDENCE_JUSTIFIED_PRODUCT');
    expect(assessment.justification.basis).toBe('DESIGNED_ISOLATION');
    expect(assessment.members.map((member) => member.package_id).sort()).toEqual(
      w.packages.filter((pkg) => pkg.envelope.version === 1).map((pkg) => pkg.envelope.id).sort(),
    );
  });

  test('members and typed bindings are preserved verbatim', () => {
    const vm = compositionVM(compositionV2, [compositionV1.envelope.id]);
    expect(vm.members).toEqual(compositionV2.content.members);
    expect(vm.bindings).toEqual(compositionV2.content.bindings);
  });
});

describe('the packages workspace projection', () => {
  const workspace = projectPackagesWorkspace({
    packages: w.packages.map((artifact) => pkgVM(artifact)),
    compositions: [
      projectComposition({
        artifact: compositionV2,
        chain_ids: [compositionV1.envelope.id],
        evidence: [...w.base.evidence, ...w.composition_evidence, ...w.evolution_evidence],
        rationale: chainFor(compositionV2.envelope.id, allLinks(w), compositionV2.content.evidence_refs),
        data_source: source,
        uncertainty: {
          uncertainty_class: 'MODERATE',
          statement: 'Composed-system evidence covers one shadow window.',
        },
        authority,
        next_allowed_action: {
          action_id: 'review-composition',
          kind: 'REVIEW',
          label: 'Open the composition detail',
          description: 'See the members, wiring, independence and OWN evidence.',
          href: '/packages',
          rationale_ref: compositionV2.envelope.id,
          requires_authority: null,
        },
      }),
    ],
    rationale: chainFor(missionV2.envelope.id, allLinks(w)),
    data_source: source,
    evidence_refs: [],
    uncertainty: {
      uncertainty_class: 'MODERATE',
      statement: 'Applicability is context-conditioned across the repertoire.',
    },
    authority,
    next_allowed_action: {
      action_id: 'view-packages',
      kind: 'NAVIGATE',
      label: 'Open Packages',
      description: 'The composition workspace.',
      href: '/packages',
      rationale_ref: null,
      requires_authority: null,
    },
  });

  test('lists every diversity family present (diversity preserved, never collapsed)', () => {
    expect(workspace.families.map((entry) => entry.family).sort()).toEqual(
      [...new Set(w.packages.map((pkg) => pkg.content.diversity_profile.family))].sort(),
    );
    expect(workspace.diversity_note).toBe(PACKAGES_DIVERSITY_NOTE);
  });

  test('records composition participation for every member package (the formation-time member revisions)', () => {
    const queueV1 = w.packages.find((artifact) => artifact.envelope.version === 1 && artifact.content.semantic_capability.includes('Durable'))!;
    const participation = workspace.composition_participation.find((entry) => entry.package_id === queueV1.envelope.id);
    expect(participation?.composition_ids).toEqual([compositionV2.envelope.id]);
  });

  test('is deterministic: two projections serialize identically', () => {
    const again = projectPackagesWorkspace({
      packages: w.packages.map((artifact) => pkgVM(artifact)),
      compositions: workspace.compositions.map((composition) => projectComposition({
        artifact: compositionV2,
        chain_ids: [compositionV1.envelope.id],
        evidence: [...w.base.evidence, ...w.composition_evidence, ...w.evolution_evidence],
        rationale: chainFor(compositionV2.envelope.id, allLinks(w), compositionV2.content.evidence_refs),
        data_source: source,
        uncertainty: {
          uncertainty_class: 'MODERATE',
          statement: 'Composed-system evidence covers one shadow window.',
        },
        authority,
        next_allowed_action: {
          action_id: 'review-composition',
          kind: 'REVIEW',
          label: 'Open the composition detail',
          description: 'See the members, wiring, independence and OWN evidence.',
          href: '/packages',
          rationale_ref: compositionV2.envelope.id,
          requires_authority: null,
        },
      })),
      rationale: chainFor(missionV2.envelope.id, allLinks(w)),
      data_source: source,
      evidence_refs: [],
      uncertainty: {
        uncertainty_class: 'MODERATE',
        statement: 'Applicability is context-conditioned across the repertoire.',
      },
      authority,
      next_allowed_action: {
        action_id: 'view-packages',
        kind: 'NAVIGATE',
        label: 'Open Packages',
        description: 'The composition workspace.',
        href: '/packages',
        rationale_ref: null,
        requires_authority: null,
      },
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(workspace));
  });
});

describe('the live-state read behind the workspace', () => {
  test('the packages flow through the live-store repositories (not from fixture objects)', async () => {
    const read = await liveRead(w);
    const readIds = read.packages.map((pkg) => pkg.envelope.id).sort();
    const fixtureIds = [...w.packages, w.meta_strategy_package].map((pkg) => pkg.envelope.id).sort();
    expect(readIds).toEqual(fixtureIds);
    const fromStore = read.packages.find((pkg) => pkg.envelope.id === queueV2.envelope.id);
    expect(fromStore?.content).toEqual(queueV2.content);
  });
});
