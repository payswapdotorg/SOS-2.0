/**
 * ADVERSARIAL CLASS 13 — GOVERNANCE-WEAKENING SELF-EVOLUTION (the W16 guard
 * holds under accumulation).
 *
 * The fault: an attacker accumulates legitimate-looking meta-changes and
 * interleaves governance-weakening attempts at every step, plus attempts
 * value-level weakening (zeroing validated-altitude floors, collapsing the
 * per-family diversity floor). The governance guard is a PURE function of
 * (patch, parameters) with the guard OUTSIDE the evolvable surface — so
 * accumulated applied changes can never vote it away. Every weakening
 * attempt must be rejected with a typed record, and the trace chain stays
 * queryable.
 */

import { describe, expect, test } from 'vitest';
import {
  MetaEvolutionError,
  applyMetaChange,
  applyParametersPatch,
  createMetaChange,
  createMetaProcess,
  evaluateGovernanceGuard,
  parametersEqual,
} from '@sos-2/meta-evolution';
import type { MetaChangeArtifact, MetaProcessArtifact, MetaProcessParameters, MetaProcessPatch } from '@sos-2/meta-evolution';
import { createTraceLink } from '@sos-2/semantic-spine';
import { ADVERSARIAL_ANCHOR, ADVERSARIAL_PROVENANCE, T1, assertTraceQueryable, subjectId } from './helpers.js';

const INITIAL: MetaProcessParameters = {
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

const WEAKENING_PATCHES: Array<{ key: string; patch: MetaProcessPatch; expectedInvariant: string }> = [
  {
    key: 'governance-off',
    patch: { governance: { authority_gates: false } },
    expectedInvariant: 'AUTHORITY_GATES_NON_DISABLEABLE',
  },
  {
    key: 'guard-off',
    patch: { guard: { enabled: false } },
    expectedInvariant: 'AUTHORITY_GATES_NON_DISABLEABLE',
  },
  {
    key: 'traceability-optional',
    patch: { traceability: { trace_links: 'optional' } },
    expectedInvariant: 'TRACEABILITY_MANDATORY',
  },
  {
    key: 'ask-disabled',
    patch: { ask_policy: { escalation: 'disabled' } },
    expectedInvariant: 'ASK_FIRST_CLASS',
  },
  {
    key: 'decision-records-off',
    patch: { decision_records: { mandatory: false } },
    expectedInvariant: 'DECISION_RECORDS_MANDATORY',
  },
  {
    key: 'audit-none',
    patch: { audit_log: { retention: 'none' } },
    expectedInvariant: 'DECISION_RECORDS_MANDATORY',
  },
];

function healthyPatch(step: number): MetaProcessPatch {
  // Legitimate tuning inside the evolvable surface.
  return {
    strategy: { exploration_rate: Math.min(0.2 + step * 0.05, 0.8), max_candidates_per_family: 3 + (step % 3) },
    retrieval_weights: { VALIDATED_PACKAGE: 1.0 + step * 0.05 },
  };
}

function changeFor(process: MetaProcessArtifact, patch: MetaProcessPatch, key: string): MetaChangeArtifact {
  return createMetaChange({
    content: {
      target_process_id: process.envelope.id,
      target_process_version: process.envelope.version,
      patch,
      intent: `adversarial accumulation step: ${key}`,
      source_package_id: subjectId('Package', `adversarial-13-package-${key}`),
      predicted_effects: ['process parameters evolve'],
      proposed_against: structuredClone(process.content.parameters),
    },
    provenance: [...ADVERSARIAL_PROVENANCE, `adversarial:13:${key}`],
    created_at: T1,
    authority_ref: ADVERSARIAL_ANCHOR,
    status: 'ACTIVE',
  });
}

describe('adversarial class 13: governance-weakening self-evolution', () => {
  test('EVERY weakening patch is rejected with a typed record (the full attack surface)', () => {
    const process = createMetaProcess({
      content: { parameters: structuredClone(INITIAL), mission_ref: null, notes: 'adversarial base' },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:13:process'],
      created_at: T1,
      authority_ref: ADVERSARIAL_ANCHOR,
      status: 'ACTIVE',
    });
    for (const attack of WEAKENING_PATCHES) {
      const change = changeFor(process, attack.patch, attack.key);
      const verdict = evaluateGovernanceGuard(change, process.content.parameters);
      expect(verdict.passed, `weakening patch "${attack.key}" unexpectedly passed`).toBe(false);
      expect(verdict.rejection, `weakening patch "${attack.key}" produced no typed rejection`).not.toBeNull();
      expect(verdict.rejection!.code).toBe('NON_EVOLVABLE_KEY');
      expect(verdict.rejection!.invariant).toBe(attack.expectedInvariant);
      expect(verdict.rejection!.attempted_keys.length).toBeGreaterThan(0);
    }
  });

  test('the guard HOLDS UNDER ACCUMULATION (interleaved healthy + weakening steps)', () => {
    let process = createMetaProcess({
      content: { parameters: structuredClone(INITIAL), mission_ref: null, notes: 'adversarial accumulation base' },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:13:accumulation-root'],
      created_at: T1,
      authority_ref: ADVERSARIAL_ANCHOR,
      status: 'ACTIVE',
    });
    let applied = 0;
    for (let step = 1; step <= 6; step += 1) {
      // (a) A healthy change applies and advances the process revision.
      const healthy = changeFor(process, healthyPatch(step), `healthy-${step}`);
      const healthyVerdict = evaluateGovernanceGuard(healthy, process.content.parameters);
      expect(healthyVerdict.passed).toBe(true);
      const { trial } = applyMetaChange(process, healthy, { evaluate: evaluateGovernanceGuard }, {
        provenance: [...ADVERSARIAL_PROVENANCE, `adversarial:13:apply-healthy-${step}`],
        created_at: T1,
      });
      process = trial;
      applied += 1;

      // (b) A weakening attempt against the ACCUMULATED state is still rejected.
      const attack = WEAKENING_PATCHES[(step - 1) % WEAKENING_PATCHES.length]!;
      const hostile = changeFor(process, attack.patch, `weakening-after-${applied}`);
      const verdict = evaluateGovernanceGuard(hostile, process.content.parameters);
      expect(verdict.passed, `weakening attempt after ${applied} accumulated changes unexpectedly passed`).toBe(false);
      expect(verdict.rejection!.code).toBe('NON_EVOLVABLE_KEY');

      // (c) The structural bypass attempt still throws.
      expect(() =>
        applyMetaChange(process, hostile, { evaluate: evaluateGovernanceGuard }, {
          provenance: [...ADVERSARIAL_PROVENANCE, `adversarial:13:bypass-after-${applied}`],
          created_at: T1,
        }),
      ).toThrow(MetaEvolutionError);
    }
    expect(applied).toBe(6);
    expect(process.envelope.version).toBe(7); // root v1 + 6 healthy trials
    // The accumulated parameters are the healthy ones — never weakened.
    expect(process.content.parameters.retrieval_weights.VALIDATED_PACKAGE ?? 0).toBeGreaterThanOrEqual(1.0);
    expect(process.content.parameters.strategy.max_candidates_per_family).toBeGreaterThanOrEqual(3);
  });

  test('VALUE-LEVEL weakening is rejected too (altitude floor zeroed, diversity floor collapsed)', () => {
    const process = createMetaProcess({
      content: { parameters: structuredClone(INITIAL), mission_ref: null, notes: 'adversarial value-level base' },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:13:value-base'],
      created_at: T1,
      authority_ref: ADVERSARIAL_ANCHOR,
      status: 'ACTIVE',
    });
    // Zeroing a validated altitude weight (search could no longer start at
    // the highest safe validated altitude).
    const altitudeZero = changeFor(
      process,
      { retrieval_weights: { VALIDATED_COMPOSITION: 0, VALIDATED_PACKAGE: 0 } },
      'altitude-zeroed',
    );
    const altitudeVerdict = evaluateGovernanceGuard(altitudeZero, process.content.parameters);
    expect(altitudeVerdict.passed).toBe(false);
    expect(altitudeVerdict.rejection!.code).toBe('VALIDATED_ALTITUDE_ZEROED');
    expect(altitudeVerdict.rejection!.invariant).toBe('VALIDATED_ALTITUDE_FLOOR');
    // Collapsing the per-family diversity floor to a single winner.
    const diversityCollapse = changeFor(process, { strategy: { max_candidates_per_family: 0 } }, 'diversity-collapsed');
    const diversityVerdict = evaluateGovernanceGuard(diversityCollapse, process.content.parameters);
    expect(diversityVerdict.passed).toBe(false);
    expect(diversityVerdict.rejection!.code).toBe('DIVERSITY_COLLAPSE');
    expect(diversityVerdict.rejection!.invariant).toBe('DIVERSITY_FLOOR');
    // Neither weakening can be applied.
    for (const change of [altitudeZero, diversityCollapse]) {
      expect(() =>
        applyMetaChange(process, change, { evaluate: evaluateGovernanceGuard }, {
          provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:13:value-bypass'],
          created_at: T1,
        }),
      ).toThrow(MetaEvolutionError);
    }
  });

  test('healthy patch application preserves the evolvable surface exactly (no hidden weakening)', () => {
    const patch = healthyPatch(1);
    const next = applyParametersPatch(INITIAL, patch);
    // The healthy patch changed exactly what it declared — nothing else.
    expect(next.strategy.exploration_rate).toBeCloseTo(0.25, 10);
    expect(next.retrieval_weights.VALIDATED_PACKAGE).toBeCloseTo(1.05, 10);
    expect(next.retrieval_weights.VALIDATED_COMPOSITION).toBe(INITIAL.retrieval_weights.VALIDATED_COMPOSITION);
    expect(next.strategy.search_policy).toBe(INITIAL.strategy.search_policy);
    expect(parametersEqual(next, INITIAL)).toBe(false);
  });

  test('the trace chain stays queryable after the accumulated weakening attempts', () => {
    const process = createMetaProcess({
      content: { parameters: structuredClone(INITIAL), mission_ref: null, notes: 'adversarial trace base' },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:13:trace-base'],
      created_at: T1,
      authority_ref: ADVERSARIAL_ANCHOR,
      status: 'ACTIVE',
    });
    const links: ReturnType<typeof createTraceLink>[] = [];
    for (const attack of WEAKENING_PATCHES) {
      const change = changeFor(process, attack.patch, `trace-${attack.key}`);
      const verdict = evaluateGovernanceGuard(change, process.content.parameters);
      expect(verdict.passed).toBe(false);
      links.push(
        createTraceLink({
          source: change.envelope.id,
          target: process.envelope.id,
          type: 'DERIVED_FROM',
          provenance: [...ADVERSARIAL_PROVENANCE, `adversarial:13:rejected-change-targets-process`],
        }),
      );
    }
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryTo(process.envelope.id).length).toBe(WEAKENING_PATCHES.length);
    for (const link of links) {
      expect(queryFrom(link.source).length).toBe(1);
    }
  });
});
