/**
 * Unit tests: specialization/generalization lineage operations (Work Order
 * W13).
 */

import { describe, expect, it } from 'vitest';
import { generalizePackage, specializePackage, LineageStore } from '../src/index.js';
import type { LineageOperationInput } from '../src/index.js';
import { assertValidPackageArtifact } from '@sos-2/packages';
import {
  basePackageArtifact,
  interventionalEvidence,
  observationalEvidence,
  packageId,
  T1,
} from './helpers.js';

const BASE_CTX = { region: 'eu', tier: 'prod' };
const NARROW_CTX = { region: 'eu', tier: 'prod', scale: 'large' };
const BROAD_CTX = { region: 'eu' };

function operationInput(overrides: Partial<LineageOperationInput> = {}): LineageOperationInput {
  const base = basePackageArtifact();
  return {
    base,
    context: NARROW_CTX,
    evidence_refs: [observationalEvidence(base.envelope.id, 7).id],
    provenance: ['agent:architect', 'review:wo13'],
    created_at: T1,
    changes: 'specialized for large-scale eu prod deployments',
    ...overrides,
  };
}

describe('specializePackage — the SPECIALIZES lineage operation', () => {
  it('creates a new DISCOVERED package with a SPECIALIZES trace link and lineage provenance', () => {
    const input = operationInput();
    const { artifact, lineage } = specializePackage(input);
    assertValidPackageArtifact(artifact);
    expect(artifact.content.context).toEqual(NARROW_CTX);
    expect(artifact.content.maturity).toBe('DISCOVERED'); // promotion stays governed
    expect(lineage.operation).toBe('SPECIALIZE');
    expect(lineage.base_id).toBe(input.base.envelope.id);
    expect(lineage.derived_id).toBe(artifact.envelope.id);
    expect(lineage.link.type).toBe('SPECIALIZES');
    expect(lineage.link.source).toBe(artifact.envelope.id);
    expect(lineage.link.target).toBe(input.base.envelope.id);
    expect(lineage.evidence_refs.length).toBeGreaterThan(0); // which evidence
    expect(lineage.provenance).toEqual(['agent:architect', 'review:wo13']); // who/what
    expect(lineage.created_at).toBe(T1);
  });

  it('copies forward evidence, failures, learned limitations, obligations and contracts (supersets)', () => {
    const base = basePackageArtifact();
    const input = operationInput({
      base,
      added_limitations: ['needs larger quorum at scale'],
      added_failure_refs: [failureRef()],
      added_contracts: ['contract:durable-store/large-scale/v1'],
      added_evidence_refs: [interventionalEvidence(base.envelope.id).id],
    });
    const { artifact } = specializePackage(input);
    const baseContent = base.content;
    expect(artifact.content.evidence_refs.length).toBeGreaterThan(baseContent.evidence_refs.length);
    for (const ref of baseContent.evidence_refs) {
      expect(artifact.content.evidence_refs).toContain(ref);
    }
    for (const ref of baseContent.failure_refs) {
      expect(artifact.content.failure_refs).toContain(ref);
    }
    expect(artifact.content.failure_refs).toContain(failureRef());
    for (const limitation of baseContent.learned_limitations) {
      expect(artifact.content.learned_limitations).toContain(limitation);
    }
    expect(artifact.content.learned_limitations).toContain('needs larger quorum at scale');
    for (const contract of baseContent.contracts) {
      expect(artifact.content.contracts).toContain(contract);
    }
    expect(artifact.content.assurance_obligations.length).toBe(baseContent.assurance_obligations.length);
    expect(artifact.content.realizations.length).toBe(baseContent.realizations.length);
    expect(artifact.content.diversity_profile.family).toBe(baseContent.diversity_profile.family);
  });

  it('keeps the base\'s applicable estimates in the narrowed context (they remain valid)', () => {
    const { artifact } = specializePackage(operationInput());
    expect(artifact.content.applicability).toHaveLength(1);
    expect(artifact.content.applicability[0]!.context).toEqual(BASE_CTX);
  });

  it('does NOT supersede the base — the variant joins the repertoire (diversity is intentional)', () => {
    const { artifact } = specializePackage(operationInput());
    expect(artifact.content.superseded_by).toBeNull();
    expect(artifact.envelope.supersedes).toBeNull();
    expect(artifact.envelope.id).not.toBe(operationInput().base.envelope.id);
  });

  it('is deterministic: identical input reproduces the identical derived artifact id', () => {
    const one = specializePackage(operationInput());
    const two = specializePackage(operationInput());
    expect(one.artifact.envelope.id).toBe(two.artifact.envelope.id);
    expect(one.lineage.id).toBe(two.lineage.id);
  });
});

describe('generalizePackage — the GENERALIZES lineage operation', () => {
  it('creates a new package for a strictly broader context with a GENERALIZES link', () => {
    const input = operationInput({ context: BROAD_CTX, changes: 'generalized to all eu tiers' });
    const { artifact, lineage } = generalizePackage(input);
    expect(artifact.content.context).toEqual(BROAD_CTX);
    expect(lineage.operation).toBe('GENERALIZE');
    expect(lineage.link.type).toBe('GENERALIZES');
    expect(artifact.content.maturity).toBe('DISCOVERED');
  });

  it('supplies no default estimate when every base estimate conflicts with the broadening — caller must declare one', () => {
    // base estimates condition on {region: eu, tier: prod}; broadening to {region: eu} keeps them
    const ok = generalizePackage(operationInput({ context: BROAD_CTX, changes: 'generalized to all eu tiers' }));
    expect(ok.artifact.content.applicability).toHaveLength(1);
    // but a base whose estimates all conflict with the broadened context survives nothing
    const base = basePackageArtifact({
      applicability: [
        {
          kind: 'QUALITATIVE',
          uncertainty_class: 'MODERATE',
          context: { region: 'us' }, // conflicts with every eu context
          sample_size: 2,
          window: null,
        },
      ],
    });
    expect(() =>
      generalizePackage(
        operationInput({ base, context: BROAD_CTX, changes: 'generalized to all eu tiers' }),
      ),
    ).toThrow(/supply the derived package's applicability explicitly/);
  });
});

describe('LineageStore', () => {
  it('accumulates lineage records and answers ancestry queries', () => {
    const store = new LineageStore();
    const first = specializePackage(operationInput());
    store.add(first.lineage);
    // specialize the derived package further
    const second = specializePackage(
      operationInput({
        base: first.artifact,
        context: { region: 'eu', tier: 'prod', scale: 'large', tenant: 'acme' },
        changes: 'tenant-specific variant',
      }),
    );
    store.add(second.lineage);
    expect(store.size).toBe(2);
    const ancestry = store.ancestryOf(second.artifact.envelope.id);
    expect(ancestry).toHaveLength(2);
    expect(ancestry.map((record) => record.operation)).toEqual(['SPECIALIZE', 'SPECIALIZE']);
    // derivationsOf(X) = the records that DERIVED X (how X came to be)
    const firstDerivation = store.derivationsOf(first.artifact.envelope.id);
    expect(firstDerivation).toHaveLength(1);
    expect(firstDerivation[0]!.derived_id).toBe(first.artifact.envelope.id);
    expect(firstDerivation[0]!.base_id).toBe(operationInput().base.envelope.id);
    const secondDerivation = store.derivationsOf(second.artifact.envelope.id);
    expect(secondDerivation).toHaveLength(1);
    expect(secondDerivation[0]!.base_id).toBe(first.artifact.envelope.id);
    expect(secondDerivation[0]!.derived_id).toBe(second.artifact.envelope.id);
  });

  it('supports mixed SPECIALIZES/GENERALIZES ancestry', () => {
    const store = new LineageStore();
    const specialized = specializePackage(operationInput());
    store.add(specialized.lineage);
    const generalized = generalizePackage(
      operationInput({ base: specialized.artifact, context: BROAD_CTX, changes: 'generalized to all eu tiers' }),
    );
    store.add(generalized.lineage);
    const ancestry = store.ancestryOf(generalized.artifact.envelope.id);
    expect(ancestry).toHaveLength(2);
    expect(ancestry.some((record) => record.operation === 'SPECIALIZE')).toBe(true);
    expect(ancestry.some((record) => record.operation === 'GENERALIZE')).toBe(true);
  });

  it('snapshots and restores canonically (round trip)', () => {
    const store = new LineageStore();
    const result = specializePackage(operationInput());
    store.add(result.lineage);
    const snapshot = store.snapshot();
    const restored = LineageStore.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.ancestryOf(result.artifact.envelope.id)).toEqual(
      store.ancestryOf(result.artifact.envelope.id),
    );
  });
});

/** A deterministic extra failure-evidence ref for superset checks. */
function failureRef(): string {
  return observationalEvidence(packageId('lineage-failure-ref'), 42).id;
}
