/**
 * Negative tests — the W11 rejection disciplines:
 *
 *   1. view-model projections that drop truth states, uncertainty or
 *      provenance are REJECTED;
 *   2. rationale chains without trace links are REJECTED;
 *   3. view-models with missing mandatory display fields (verdicts without
 *      invalidations, asks without trade-offs, repertoires with collapsed
 *      families, ...) are REJECTED.
 */

import { describe, expect, test } from 'vitest';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import {
  assertValidAskVM,
  assertValidEvidenceVM,
  assertValidMissionVM,
  assertValidRationaleChain,
  buildRationaleChain,
  projectEvidenceSet,
  projectMission,
  validateRationaleChain,
} from '../src/index.js';
import { CONSTITUTION_ID, evidenceId, fixtureMission, link, NOW, systemStateId } from './helpers.js';

describe('rationale chain without trace links is REJECTED', () => {
  test('empty upstream + empty downstream throws', () => {
    const subject = systemStateId('subject');
    expect(() =>
      buildRationaleChain({ subject_id: subject, links: [], evidence_refs: [evidenceId('e')] }),
    ).toThrowError(/no typed trace links/);
  });

  test('assertValidRationaleChain rejects a link-less chain object', () => {
    const subject = systemStateId('subject');
    const chain = {
      subject_id: subject,
      upstream: [],
      downstream: [],
      evidence_refs: [],
    };
    expect(() => assertValidRationaleChain(chain)).toThrowError(/no typed trace links/);
    expect(validateRationaleChain(chain)).toBe(false);
  });

  test('links that do not mention the subject produce a link-less chain (rejected)', () => {
    const subject = systemStateId('subject');
    const unrelated = systemStateId('unrelated');
    expect(() =>
      buildRationaleChain({
        subject_id: subject,
        // These links neither target nor source the subject.
        links: [link(unrelated, CONSTITUTION_ID, 'DERIVED_FROM')],
        evidence_refs: [],
      }),
    ).toThrowError(/no typed trace links/);
  });

  test('a chain with one valid link is accepted', () => {
    const subject = systemStateId('subject');
    const chain = buildRationaleChain({
      subject_id: subject,
      links: [link(CONSTITUTION_ID, subject, 'DERIVED_FROM')],
      evidence_refs: [evidenceId('e')],
    });
    expect(validateRationaleChain(chain)).toBe(true);
  });
});

describe('view-models that drop truth states, uncertainty or provenance are REJECTED', () => {
  const subject = systemStateId('negative-subject');

  function record(availability: EvidenceRecordW3['availability']): EvidenceRecordW3 {
    return createEvidence({
      kind: 'telemetry',
      subject_ref: subject,
      availability,
      evidence_class: 'OBSERVATIONAL',
      method: 'telemetry:capture-availability',
      provenance: ['W11:ui-contracts:negative'],
      confidence: { kind: 'QUALITATIVE', uncertainty_class: 'WEAK' },
      producer: { tool: 'otel-collector', tool_version: '1.0.0', model: null, model_version: null, command: null, environment: 'production' },
    });
  }

  function vm() {
    return projectEvidenceSet({
      records: [record('UNKNOWN')],
      query: {},
      now: NOW,
      rationale: buildRationaleChain({
        subject_id: subject,
        links: [link(record('UNKNOWN').id, subject, 'OBSERVES')],
        evidence_refs: [record('UNKNOWN').id],
      }),
    });
  }

  test('dropping the truth state from a row is rejected', () => {
    const model = vm();
    const dropped = { ...model, rows: [{ ...model.rows[0]! }] } as Record<string, unknown>;
    const row = (dropped['rows'] as Record<string, unknown>[])[0]!;
    delete row['availability'];
    expect(() => assertValidEvidenceVM(dropped)).toThrowError(/truth state|availability/);
  });

  test('conflating two distinct truth states in a row is rejected', () => {
    const model = vm();
    const conflated = {
      ...model,
      rows: [{ ...model.rows[0]!, availability: 'MAYBE' }],
    };
    expect(() => assertValidEvidenceVM(conflated)).toThrowError(/truth states/);
  });

  test('dropping a truth-state key from the set-level counts is rejected', () => {
    const model = vm();
    const counts = { ...model.counts_by_truth_state };
    delete (counts as Record<string, number>)['UNAVAILABLE'];
    expect(() => assertValidEvidenceVM({ ...model, counts_by_truth_state: counts })).toThrowError(/ALL 6 frozen truth-state keys/);
  });

  test('dropping provenance from a row is rejected', () => {
    const model = vm();
    const dropped = {
      ...model,
      rows: [{ ...model.rows[0]!, provenance: [] }],
    };
    expect(() => assertValidEvidenceVM(dropped)).toThrowError(/provenance/);
  });

  test('dropping the uncertainty (confidence) from a row is rejected', () => {
    const model = vm();
    const dropped = {
      ...model,
      rows: [{ ...model.rows[0]!, confidence: undefined as never }],
    };
    expect(() => assertValidEvidenceVM(dropped)).toThrowError(/confidence|uncertainty/);
  });

  test('the honest projection keeps all of them (control)', () => {
    expect(() => assertValidEvidenceVM(vm())).not.toThrow();
  });
});

describe('other mandatory display fields are REJECTED when dropped', () => {
  test('a mission VM without rationale is rejected', () => {
    const mission = fixtureMission('Negative mission');
    const chain = buildRationaleChain({
      subject_id: mission.envelope.id,
      links: [link(CONSTITUTION_ID, mission.envelope.id, 'DERIVED_FROM')],
    });
    const model = projectMission(mission, chain);
    const dropped = { ...model } as Record<string, unknown>;
    delete dropped['rationale'];
    expect(() => assertValidMissionVM(dropped)).toThrowError(/rationale/);
  });

  test('an ask VM without trade-offs is rejected', () => {
    const askId = systemStateId('ask-negative');
    const ask = {
      ask_id: askId,
      decision_record_ref: systemStateId('decision'),
      priority: 'HIGH',
      decision: 'Decide X',
      alternatives: [{ id: 'a1', action: 'ACT', description: 'Proceed' }],
      evidence_quality: { quality: 'WEAK', summary: 'weak' },
      uncertainty: { uncertainty_class: 'HIGH', basis: 'partial canary' },
      trade_offs: [],
      risk: { description: 'bad', severity: 'HIGH' },
      authority_insufficiency: 'no grant covers this',
      evidence_summary: [],
      rule_trace: [{ rule: 'R1', order: 1, outcome: 'ASK', code: 'NO_GRANT', reason: 'no grant' }],
      rationale: buildRationaleChain({
        subject_id: askId,
        links: [link(CONSTITUTION_ID, askId, 'DERIVED_FROM')],
        evidence_refs: [evidenceId('ask-neg')],
      }),
    };
    expect(() => assertValidAskVM(ask)).toThrowError(/trade-offs/);
  });
});

describe('projections reject mismatched or invalid inputs loudly', () => {
  test('projectMission rejects a rationale bound to another subject', () => {
    const mission = fixtureMission('Mission A');
    const other = fixtureMission('Mission B');
    const wrongChain = buildRationaleChain({
      subject_id: other.envelope.id,
      links: [link(CONSTITUTION_ID, other.envelope.id, 'DERIVED_FROM')],
    });
    expect(() => projectMission(mission, wrongChain)).toThrowError(/does not match/);
  });

  test('projectEvidenceSet rejects a query with a non-frozen truth state', () => {
    const subject = systemStateId('query-negative');
    expect(() =>
      projectEvidenceSet({
        records: [],
        query: { truth_states: ['MAYBE' as never] },
        rationale: buildRationaleChain({
          subject_id: subject,
          links: [link(CONSTITUTION_ID, subject, 'DERIVED_FROM')],
        }),
      }),
    ).toThrowError(/frozen truth states/);
  });

  test('buildRationaleChain rejects evidence refs that are not spine ids', () => {
    const subject = systemStateId('evidence-negative');
    expect(() =>
      buildRationaleChain({
        subject_id: subject,
        links: [link(CONSTITUTION_ID, subject, 'DERIVED_FROM')],
        evidence_refs: ['not-a-spine-id'],
      }),
    ).toThrowError(/well-formed spine artifact ids/);
  });
});
