/**
 * ADVERSARIAL CLASS 5 — MALICIOUS GENERATED CHANGE (injected hostile
 * artifact REJECTED with a typed rejection + provenance retained).
 *
 * The fault: a hostile MetaChange artifact is injected into the meta loop —
 * its patch tries to switch off authority gates, disable the governance
 * guard itself, make traceability optional and disable ASK escalation. The
 * governance guard must REJECT it with a TYPED rejection record BEFORE any
 * measurement or decision, the rejected artifact and its provenance are
 * RETAINED (never dropped), the structural bypass attempt throws loudly,
 * and the trace chain stays queryable.
 */

import { describe, expect, test } from 'vitest';
import {
  applyMetaChange,
  applyParametersPatch,
  createMetaChange,
  createMetaProcess,
  evaluateGovernanceGuard,
} from '@sos-2/meta-evolution';
import type { MetaProcessParameters } from '@sos-2/meta-evolution';
import { createEvidence } from '@sos-2/evidence';
import { createTraceLink } from '@sos-2/semantic-spine';
import { MetaEvolutionError } from '@sos-2/meta-evolution';
import { ADVERSARIAL_ANCHOR, ADVERSARIAL_PROVENANCE, T1, assertTraceQueryable, subjectId, toolProducer } from './helpers.js';

const BASE_PARAMETERS: MetaProcessParameters = {
  strategy: { search_policy: 'GREEDY', exploration_rate: 0.2, max_candidates_per_family: 3 },
  retrieval_weights: {
    VALIDATED_COMPOSITION: 1.0,
    VALIDATED_PACKAGE: 1.0,
    PACKAGE_ADAPTATION: 0.6,
    ARCHITECTURE_PATTERN: 0.4,
    NOVEL_ARCHITECTURE: 0.3,
    LOW_LEVEL_SYNTHESIS: 0.2,
  },
};

function baseProcess() {
  return createMetaProcess({
    content: { parameters: structuredClone(BASE_PARAMETERS), mission_ref: null, notes: 'adversarial base process' },
    provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:5:base-process'],
    created_at: T1,
    authority_ref: ADVERSARIAL_ANCHOR,
    status: 'ACTIVE',
  });
}

function hostileChange(processId: string, processVersion: number) {
  return createMetaChange({
    content: {
      target_process_id: processId,
      target_process_version: processVersion,
      // The hostile patch: governance off, guard off, traceability optional,
      // ASK escalation disabled, decision records bypassed.
      patch: {
        governance: { authority_gates: false, decision_records: false },
        traceability: { trace_links: 'optional' },
        ask_policy: { escalation: 'disabled' },
        guard: { enabled: false },
        audit_log: { retention: 'none' },
      },
      intent: 'DISABLE ALL GOVERNANCE: apply unreviewed changes without gates, records or traces.',
      source_package_id: subjectId('Package', 'adversarial-5-hostile-package'),
      predicted_effects: ['unreviewed meta-changes apply without friction'],
      proposed_against: structuredClone(BASE_PARAMETERS),
    },
    provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:5:hostile-change', 'origin:injected-attacker'],
    created_at: T1,
    authority_ref: ADVERSARIAL_ANCHOR,
    status: 'ACTIVE',
  });
}

describe('adversarial class 5: malicious generated change', () => {
  test('the governance guard REJECTS the hostile change with a typed rejection record', () => {
    const process = baseProcess();
    const change = hostileChange(process.envelope.id, process.envelope.version);
    const verdict = evaluateGovernanceGuard(change, BASE_PARAMETERS);
    expect(verdict.passed).toBe(false);
    expect(verdict.rejection).not.toBeNull();
    const rejection = verdict.rejection!;
    // The typed rejection: machine-checkable code + the frozen invariant.
    expect(rejection.change_id).toBe(change.envelope.id);
    expect(rejection.code).toBe('NON_EVOLVABLE_KEY');
    expect(rejection.invariant).toMatch(/AUTHORITY_GATES_NON_DISABLEABLE|TRACEABILITY_MANDATORY|ASK_FIRST_CLASS|DECISION_RECORDS_MANDATORY|META_EVOLVABLE_SURFACE/);
    expect(rejection.attempted_keys.length).toBeGreaterThan(0);
    expect(rejection.reason.length).toBeGreaterThan(0);
    // The full frozen invariant list was checked.
    expect(verdict.invariants_checked.length).toBe(7);
  });

  test('the rejected artifact and its provenance are RETAINED (never dropped)', () => {
    const process = baseProcess();
    const change = hostileChange(process.envelope.id, process.envelope.version);
    // The hostile artifact exists, carries its (attacker-visible) provenance
    // and is a well-formed spine artifact — the REJECTION is the containment,
    // not deletion.
    expect(change.envelope.provenance).toContain('origin:injected-attacker');
    expect(change.envelope.kind).toBe('MetaChange');
    // The rejection record retains the exact change id — the audit trail.
    const verdict = evaluateGovernanceGuard(change, BASE_PARAMETERS);
    expect(verdict.rejection!.change_id).toBe(change.envelope.id);
  });

  test('the rejection is retained as FAILURE evidence with provenance (the loop pattern)', () => {
    const process = baseProcess();
    const change = hostileChange(process.envelope.id, process.envelope.version);
    const verdict = evaluateGovernanceGuard(change, BASE_PARAMETERS);
    // The meta loop's own pattern: guard rejections become FAILURE evidence
    // OBSERVING the rejected change (retained verbatim).
    const rejectionEvidence = createEvidence({
      kind: 'meta-governance-rejection',
      subject_ref: change.envelope.id,
      availability: 'FAILURE',
      evidence_class: 'OBSERVATIONAL',
      method: 'meta-evolution:governance-guard',
      provenance: [...ADVERSARIAL_PROVENANCE, `adversarial:5:guard`, `adversarial:5:change:${change.envelope.id}`],
      window: { start: T1, end: T1 },
      producer: toolProducer(),
    });
    expect(rejectionEvidence.availability).toBe('FAILURE');
    expect(rejectionEvidence.provenance).toContain(`adversarial:5:change:${change.envelope.id}`);
    expect(verdict.rejection!.code).toBe('NON_EVOLVABLE_KEY');
  });

  test('the structural bypass attempt throws loudly (applyParametersPatch / applyMetaChange)', () => {
    const process = baseProcess();
    const change = hostileChange(process.envelope.id, process.envelope.version);
    // Direct patch application refuses the foreign keys.
    expect(() => applyParametersPatch(BASE_PARAMETERS, change.content.patch)).toThrow(MetaEvolutionError);
    // The apply path re-runs the guard regardless of caller verdicts.
    expect(() =>
      applyMetaChange(process, change, { evaluate: evaluateGovernanceGuard }, {
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:5:bypass-attempt'],
        created_at: T1,
      }),
    ).toThrow(MetaEvolutionError);
    try {
      applyMetaChange(process, change, { evaluate: evaluateGovernanceGuard }, {
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:5:bypass-attempt'],
        created_at: T1,
      });
    } catch (error) {
      expect((error as MetaEvolutionError).code).toBe('GUARD_BYPASS_ATTEMPT');
      expect((error as Error).message).toContain(change.envelope.id);
    }
  });

  test('the trace chain stays queryable after the hostile-change rejection', () => {
    const process = baseProcess();
    const change = hostileChange(process.envelope.id, process.envelope.version);
    const rejectionEvidence = createEvidence({
      kind: 'meta-governance-rejection',
      subject_ref: change.envelope.id,
      availability: 'FAILURE',
      evidence_class: 'OBSERVATIONAL',
      method: 'meta-evolution:governance-guard',
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:5:guard-evidence'],
      window: { start: T1, end: T1 },
      producer: toolProducer(),
    });
    const links = [
      createTraceLink({
        source: rejectionEvidence.id,
        target: change.envelope.id,
        type: 'OBSERVES',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:5:rejection-observes-change'],
      }),
      createTraceLink({
        source: change.envelope.id,
        target: process.envelope.id,
        type: 'DERIVED_FROM',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:5:change-targets-process'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryFrom(rejectionEvidence.id).length).toBe(1);
    // The rejected change is BOTH observed (the rejection evidence points at
    // it) and a source (it targets the process) — both directions queryable.
    expect(queryTo(change.envelope.id).length).toBe(1);
    expect(queryFrom(change.envelope.id).length).toBe(1);
    expect(queryTo(process.envelope.id).length).toBe(1);
  });
});
