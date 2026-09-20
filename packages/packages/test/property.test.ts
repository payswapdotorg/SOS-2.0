import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bestEstimateForContext,
  canonicalPackageText,
  classifyPackageEvidence,
  createPackageArtifact,
  evaluateMaturityPromotion,
  packageArtifactId,
  packageHash,
  toPackageRecord,
  validatePackageArtifact,
} from '../src/index.js';
import type { ApplicabilityEstimate, CreatePackageInput, PackageContent, PromotionGateInput } from '../src/index.js';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { isPackageRecord } from '@sos-2/semantic-spine';
import { CALIBRATION, SUBJECT_R1, T0, T1, T2, W0, W1, toolProducer } from './helpers.js';

// ---------------------------------------------------------------------------
// Generators (constrained to the VALID input space; negative space is
// covered by the dedicated negative tests).
// ---------------------------------------------------------------------------

const fcContext = fc
  .uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{1,18}$/), { minLength: 1, maxLength: 3 })
  .map((keys) => {
    const context: Record<string, string> = {};
    for (const key of keys) {
      context[key] = 'v';
    }
    return context;
  });

const fcUncertainty = fc.constantFrom('STRONG', 'MODERATE', 'WEAK', 'UNQUANTIFIED') as fc.Arbitrary<
  'STRONG' | 'MODERATE' | 'WEAK' | 'UNQUANTIFIED'
>;

const fcQualitative: fc.Arbitrary<ApplicabilityEstimate> = fc.record({
  kind: fc.constant('QUALITATIVE' as const),
  uncertainty_class: fcUncertainty,
  context: fcContext,
  sample_size: fc.nat(50),
  window: fc.constantFrom<null | { start: string; end: string }>(null, W0, W1),
});

const fcCalibrated: fc.Arbitrary<ApplicabilityEstimate> = fc.record({
  kind: fc.constant('CALIBRATED' as const),
  probability: fc.double({ min: 0, max: 1, noNaN: true }),
  calibration_ref: fc.constant(CALIBRATION),
  uncertainty_class: fcUncertainty,
  context: fcContext,
  sample_size: fc.integer({ min: 1, max: 500 }),
  window: fc.constant(W0),
});

// Distinct contexts enforced (no two estimates for the same condition).
const fcApplicability = fc
  .uniqueArray(fc.oneof(fcQualitative, fcCalibrated), { minLength: 1, maxLength: 4, selector: (e) => JSON.stringify((e as { context: unknown }).context) });

const fcContent: fc.Arbitrary<PackageContent> = fc
  .record({
    semantic_capability: fc.stringMatching(/^[a-z][a-z0-9-]{2,30}$/),
    contracts: fc.uniqueArray(fc.stringMatching(/^contract:[a-z0-9-]+\/v[0-9]$/), { minLength: 1, maxLength: 3 }),
    preconditions: fc.array(fc.stringMatching(/^[a-z ]{4,40}$/), { maxLength: 2 }),
    postconditions: fc.array(fc.stringMatching(/^[a-z ]{4,40}$/), { maxLength: 2 }),
    realizations: fc.array(
      fc.record({ ref: fc.constant(CALIBRATION), revision: fc.option(fc.stringMatching(/^git:[a-f0-9]{6}$/), { nil: null }), note: fc.stringMatching(/^[a-z ]{4,40}$/) }),
      { maxLength: 2 },
    ),
    applicability: fcApplicability,
    maturity: fc.constantFrom('DISCOVERED', 'FORMING') as fc.Arbitrary<'DISCOVERED' | 'FORMING'>,
    changes: fc.stringMatching(/^[a-z ]{4,40}$/),
  })
  .map((partial) => {
    const evidenceId = deriveSyntheticEvidenceId(partial.semantic_capability);
    const content: PackageContent = {
      semantic_capability: partial.semantic_capability,
      contracts: partial.contracts,
      preconditions: partial.preconditions,
      postconditions: partial.postconditions,
      realizations: partial.realizations,
      applicability: partial.applicability,
      evidence_refs: [evidenceId],
      failure_refs: [],
      compatibility_refs: [],
      composition_refs: [],
      assurance_obligations: [{ kind: 'TEST', obligation: 'generated package passes its tests' }],
      context: Object.keys(partial.applicability[0]!.context).length > 0 ? partial.applicability[0]!.context : { env: 'test' },
      learned_limitations: [],
      diversity_profile: {
        family: 'generated-family',
        dimensions: [{ dimension: 'COST', stance: 'generated stance' }],
      },
      maturity: partial.maturity,
      changes: partial.changes,
      superseded_by: null,
    };
    return content;
  });

function deriveSyntheticEvidenceId(seed: string): string {
  // A well-formed (possibly dangling) Evidence id — content validation only
  // checks structural well-formedness; resolution discipline is exercised
  // by the maturity/registry tests with REAL records.
  const record = createEvidence({
    kind: 'telemetry',
    subject_ref: SUBJECT_R1,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: [`observation:sha256:${seed}`.padEnd(80, '0')],
    window: W0,
    subject_revision: 'r1',
    producer: toolProducer(),
  });
  return record.id;
}

const fcInput: fc.Arbitrary<CreatePackageInput> = fc
  .record({
    content: fcContent,
    provenance: fc.array(fc.stringMatching(/^w6:[a-z-]{2,20}$/), { minLength: 1, maxLength: 2 }),
    created_at: fc.constantFrom(T0, T1, T2),
  })
  .map((partial) => partial as CreatePackageInput);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('package artifact properties (deterministic, contract-conformant)', () => {
  it('always mints valid artifacts with spine Package ids', () => {
    fc.assert(
      fc.property(fcInput, (input) => {
        const artifact = createPackageArtifact(input);
        expect(validatePackageArtifact(artifact)).toBe(true);
        expect(artifact.envelope.id).toMatch(/^sos:\/\/Package\/[0-9a-f]{32}$/);
        expect(artifact.envelope.kind).toBe('Package');
        return true;
      }),
    );
  });

  it('is deterministic: identical inputs yield identical artifacts, ids and hashes', () => {
    fc.assert(
      fc.property(fcInput, (input) => {
        const a = createPackageArtifact(input);
        const b = createPackageArtifact(input);
        expect(a).toEqual(b);
        expect(a.envelope.id).toBe(b.envelope.id);
        expect(packageHash(a)).toBe(packageHash(b));
        expect(packageArtifactId(input)).toBe(a.envelope.id);
        return true;
      }),
    );
  });

  it('canonical round trips are byte-identical (parse -> serialize -> serialize)', () => {
    fc.assert(
      fc.property(fcInput, (input) => {
        const artifact = createPackageArtifact(input);
        const text = canonicalPackageText(artifact);
        const parsed = JSON.parse(text);
        expect(canonicalPackageText(parsed)).toBe(text);
        expect(parsed).toEqual(artifact);
        return true;
      }),
    );
  });

  it('the normative projection is always schema-guard-valid (contracts layer)', () => {
    fc.assert(
      fc.property(fcInput, (input) => {
        const record = toPackageRecord(createPackageArtifact(input));
        expect(isPackageRecord(record)).toBe(true);
        expect(record.id).toMatch(/^sos:\/\/Package\/[0-9a-f]{32}$/);
        return true;
      }),
    );
  });

  it('distinct semantic capabilities (usually) yield distinct ids — no silent collisions', () => {
    fc.assert(
      fc.property(fcInput, fcInput, (a, b) => {
        if (a.content.semantic_capability !== b.content.semantic_capability) {
          const idA = createPackageArtifact(a).envelope.id;
          const idB = createPackageArtifact(b).envelope.id;
          // Same capability -> same id is legal (content addressing); different
          // capability with identical everything else must differ.
          expect(idA === idB).toBe(a.content.semantic_capability === b.content.semantic_capability);
        }
        return true;
      }),
    );
  });
});

describe('promotion gate properties', () => {
  const fcAvailability = fc.constantFrom('SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL') as fc.Arbitrary<
    'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL'
  >;
  const fcEvidenceClass = fc.constantFrom('OBSERVATIONAL', 'INTERVENTIONAL') as fc.Arbitrary<'OBSERVATIONAL' | 'INTERVENTIONAL'>;
  const fcKind = fc.constantFrom('telemetry', 'benchmark-comparison', 'fault-injection', 'incident-report', 'transfer-study');
  const fcEvidence = fc.record({
    kind: fcKind,
    availability: fcAvailability,
    evidence_class: fcEvidenceClass,
    seed: fc.stringMatching(/^[a-z0-9]{4,12}$/),
  });

  it('the verdict is a pure deterministic function of the gate input', () => {
    fc.assert(
      fc.property(fc.array(fcEvidence, { maxLength: 6 }), (specs) => {
        const records: EvidenceRecordW3[] = specs.map((spec) =>
          createEvidence({
            kind: spec.kind,
            subject_ref: SUBJECT_R1,
            availability: spec.availability,
            evidence_class: spec.evidence_class,
            method: 'telemetry:capture-availability',
            provenance: [`observation:sha256:${spec.seed}`.padEnd(80, '0')],
            window: W0,
            producer: toolProducer(),
          }),
        );
        const input: PromotionGateInput = {
          from: 'FORMING',
          to: 'VALIDATED',
          evidence_refs: records.map((record) => record.id),
          evidence: records,
          hasRealizations: true,
          hasCalibratedApplicability: false,
          superseded_by: null,
        };
        expect(evaluateMaturityPromotion(input)).toEqual(evaluateMaturityPromotion(input));
        return true;
      }),
    );
  });

  it('classification is deterministic and the summary is order-independent', () => {
    fc.assert(
      fc.property(fc.array(fcEvidence, { minLength: 0, maxLength: 8 }), (specs) => {
        const records: EvidenceRecordW3[] = specs.map((spec) =>
          createEvidence({
            kind: spec.kind,
            subject_ref: SUBJECT_R1,
            availability: spec.availability,
            evidence_class: spec.evidence_class,
            method: 'telemetry:capture-availability',
            provenance: [`observation:sha256:${spec.seed}`.padEnd(80, '0')],
            window: W0,
            producer: toolProducer(),
          }),
        );
        const classes = records.map((record) => classifyPackageEvidence(record));
        const reversed = [...records].reverse();
        const reversedClasses = reversed.map((record) => classifyPackageEvidence(record));
        expect([...classes].sort()).toEqual([...reversedClasses].sort());
        return true;
      }),
    );
  });
});

describe('applicability selection properties', () => {
  it('bestEstimateForContext always returns a matching estimate or null (never a non-match)', () => {
    fc.assert(
      fc.property(fcApplicability, fcContext, (estimates, query) => {
        const best = bestEstimateForContext(estimates, query);
        if (best === null) {
          expect(estimates.every((estimate) => !Object.entries(estimate.context).every(([key, value]) => query[key] === value))).toBe(
            true,
          );
        } else {
          expect(Object.entries(best.context).every(([key, value]) => query[key] === value)).toBe(true);
          expect(estimates).toContainEqual(best);
        }
        return true;
      }),
    );
  });
});
