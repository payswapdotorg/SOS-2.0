/**
 * Property tests — the W11 determinism disciplines:
 *
 *   - randomized domain fixtures -> projection DETERMINISM (projecting the
 *     same input twice yields canonically IDENTICAL view-models);
 *   - canonical ROUND TRIPS (serialize -> parse -> serialize is stable);
 *   - rationale chains built from randomized link pools are deterministic
 *     and order-insensitive (link pool order never leaks into the chain).
 */

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { TRACE_LINK_TYPES } from '@sos-2/semantic-spine';
import type { EvidenceTruthState, TraceLinkType } from '@sos-2/semantic-spine';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { createTraceLink, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import {
  buildRationaleChain,
  canonicalRoundTripStable,
  canonicalVMJson,
  projectEvidenceSet,
  projectMission,
} from '../src/index.js';
import { CONSTITUTION_ID, NOW } from './helpers.js';

const TRUTH_STATES: readonly EvidenceTruthState[] = [
  'SUCCESS',
  'FAILURE',
  'UNKNOWN',
  'UNAVAILABLE',
  'UNSUPPORTED',
  'PARTIAL',
];

const NON_EMPTY_TEXT = fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0);

const slugArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,20}$/)
  .filter((s) => s.length > 0);

const truthStateArb = fc.constantFrom(...TRUTH_STATES);
const traceTypeArb = fc.constantFrom(...TRACE_LINK_TYPES);

function spineIdArb(kind: string) {
  return fc.integer({ min: 0, max: 2 ** 31 - 1 }).map((seed) => deriveDeterministicArtifactId(kind, { seed }));
}

const producerArb = fc.record({
  tool: NON_EMPTY_TEXT,
  tool_version: fc.option(NON_EMPTY_TEXT, { nil: null }),
  model: fc.constant(null),
  model_version: fc.constant(null),
  command: fc.option(NON_EMPTY_TEXT, { nil: null }),
  environment: fc.option(NON_EMPTY_TEXT, { nil: null }),
});

const evidenceArb = fc
  .record({
    seed: NON_EMPTY_TEXT,
    subject: spineIdArb('SystemState'),
    availability: truthStateArb,
    evidenceClass: fc.constantFrom<'OBSERVATIONAL' | 'INTERVENTIONAL'>('OBSERVATIONAL', 'INTERVENTIONAL'),
    uncertainty: fc.constantFrom<'STRONG' | 'MODERATE' | 'WEAK' | 'UNQUANTIFIED'>('STRONG', 'MODERATE', 'WEAK', 'UNQUANTIFIED'),
    producer: producerArb,
  })
  .map((fields) =>
    createEvidence({
      kind: 'telemetry',
      subject_ref: fields.subject,
      availability: fields.availability,
      evidence_class: fields.evidenceClass,
      method: 'telemetry:capture-availability',
      provenance: [`W11:property:${fields.seed}`],
      confidence: { kind: 'QUALITATIVE', uncertainty_class: fields.uncertainty },
      producer: fields.producer,
    }),
  );

const missionArb = fc
  .record({
    purpose: fc.string({ minLength: 12, maxLength: 64 }),
    goalStatement: fc.string({ minLength: 8, maxLength: 64 }),
    limit: fc.integer({ min: 1, max: 100000 }),
  })
  .map(
    (fields): MissionArtifact =>
      createMission({
        content: {
          purpose: fields.purpose,
          goals: [
            { id: 'goal-main', statement: fields.goalStatement, status: 'MEASURABLE', measures: ['measure-main'] },
          ],
          outcomes: [],
          stakeholders: [{ id: 'stakeholder-users', name: 'Users', interest: null }],
          measures: [{ id: 'measure-main', description: 'Primary measure', target: null, unit: null }],
          assumptions: [],
          ambiguities: [],
          constraints: [
            { id: 'constraint-budget', statement: 'Stay within budget', hard: true, bound: { axis: 'monthly-cost', direction: 'MAX', limit: fields.limit } },
          ],
        },
        provenance: ['W11:property:mission'],
        created_at: NOW,
        authority_ref: CONSTITUTION_ID,
        status: 'ACTIVE',
      }),
  );

describe('rationale chain properties', () => {
  test('deterministic and order-insensitive over randomized link pools', () => {
    const linkArb = fc
      .record({
        source: spineIdArb('Mission'),
        target: spineIdArb('SystemState'),
        type: traceTypeArb,
      })
      .map((fields) =>
        createTraceLink({
          source: fields.source,
          target: fields.target,
          type: fields.type,
          provenance: ['W11:property:link'],
        }),
      );

    fc.assert(
      fc.property(fc.array(linkArb, { minLength: 1, maxLength: 20 }), spineIdArb('SystemState'), (links, subject) => {
        // Force at least one link to mention the subject so a chain exists.
        const withSubject: typeof links = [
          createTraceLink({ source: subject, target: CONSTITUTION_ID, type: 'DERIVED_FROM', provenance: ['W11:property:link'] }),
          ...links,
        ];
        const shuffled = [...withSubject].reverse();
        const a = buildRationaleChain({ subject_id: subject, links: withSubject, evidence_refs: [] });
        const b = buildRationaleChain({ subject_id: subject, links: shuffled, evidence_refs: [] });
        expect(canonicalVMJson(a)).toBe(canonicalVMJson(b));
        expect(canonicalRoundTripStable(a)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});

describe('mission projection properties', () => {
  test('randomized missions project deterministically with stable canonical round trips', () => {
    fc.assert(
      fc.property(missionArb, (mission) => {
        const chain = buildRationaleChain({
          subject_id: mission.envelope.id,
          links: [
            createTraceLink({
              source: mission.envelope.id,
              target: CONSTITUTION_ID,
              type: 'DERIVED_FROM',
              provenance: ['W11:property:link'],
            }),
          ],
          evidence_refs: [],
        });
        const first = projectMission(mission, chain);
        const second = projectMission(mission, chain);
        expect(canonicalVMJson(first)).toBe(canonicalVMJson(second));
        expect(canonicalRoundTripStable(first)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});

describe('evidence projection properties', () => {
  test('randomized evidence pools project deterministically and keep every distinct truth state', () => {
    fc.assert(
      fc.property(
        fc.array(evidenceArb, { minLength: 1, maxLength: 12 }),
        fc.option(spineIdArb('SystemState'), { nil: null }),
        (records, maybeSubject) => {
          const subject = records[0]!.subject_ref;
          const chain = buildRationaleChain({
            subject_id: subject,
            links: [
              createTraceLink({
                source: records[0]!.id,
                target: subject,
                type: 'OBSERVES',
                provenance: ['W11:property:link'],
              }),
            ],
            evidence_refs: records.map((record) => record.id),
          });
          const query = maybeSubject === null ? {} : { subject: maybeSubject };
          const first = projectEvidenceSet({ records, query, now: NOW, rationale: chain });
          const second = projectEvidenceSet({ records, query, now: NOW, rationale: chain });
          expect(canonicalVMJson(first)).toBe(canonicalVMJson(second));
          expect(canonicalRoundTripStable(first)).toBe(true);
          // The counts always carry ALL 6 keys and sum to the pool size.
          const keys = Object.keys(first.counts_by_truth_state);
          expect(keys).toHaveLength(6);
          const total = Object.values(first.counts_by_truth_state).reduce((sum, count) => sum + count, 0);
          expect(total).toBe(records.length);
          // Row truth states are exactly the source records' truth states.
          for (const row of first.rows) {
            const source = records.find((record) => record.id === row.id);
            expect(source).toBeDefined();
            expect(row.availability).toBe(source!.availability);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
