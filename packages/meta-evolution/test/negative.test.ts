/**
 * Negative tests — the seven W16 REJECTED invariants, each pinned loudly:
 *
 *   1. object/meta conflation REJECTED;
 *   2. governance-weakening meta-change accepted REJECTED;
 *   3. guard bypass REJECTED;
 *   4. effectiveness-unmeasured promotion REJECTED;
 *   5. rollback without recovery declaration REJECTED;
 *   6. failed change deleted instead of retained REJECTED;
 *   7. broken trace chain REJECTED.
 */

import { describe, expect, it } from 'vitest';
import { buildGoldenMetaInput } from '../src/golden-scenario.js';
import { runMetaEvolutionLoop } from '../src/loop.js';
import { assertMeasuredBeforePromotion } from '../src/decision-stage.js';
import { assertRollbackRecovery } from '../src/revision.js';
import { assertFailureRetained } from '../src/liability.js';
import { assertMetaTraceChain, verifyMetaTraceChain } from '../src/trace.js';
import { evaluateGovernanceGuard, GOVERNANCE_GUARD } from '../src/guard.js';
import { routeToMetaPipeline, routeToObjectPipeline } from '../src/routing.js';
import { applyMetaChange, createMetaProcess } from '../src/process.js';
import { applyParametersPatch, cloneParameters } from '../src/parameters.js';
import { createMetaChange } from '../src/change.js';
import { createArchitectureMemory, ArchitectureMemoryStore } from '@sos-2/memory';
import { openResolution } from '@sos-2/memory';
import { createEvidence } from '@sos-2/evidence';
import { mintRandomArtifactId } from '@sos-2/semantic-spine';

const NOW = '2025-07-01T00:00:00.000Z';
const PROVENANCE = ['W16:test:negative'];
const PRODUCER = { tool: 'vitest', tool_version: null, model: null, model_version: null, command: 'pnpm -r test', environment: 'ci' };
const BASE_PARAMETERS = {
  strategy: { search_policy: 'GREEDY' as const, exploration_rate: 0.2, max_candidates_per_family: 3 },
  retrieval_weights: {
    VALIDATED_COMPOSITION: 1.0,
    VALIDATED_PACKAGE: 1.0,
    PACKAGE_ADAPTATION: 0.6,
    ARCHITECTURE_PATTERN: 0.4,
    NOVEL_ARCHITECTURE: 0.3,
    LOW_LEVEL_SYNTHESIS: 0.2,
  },
};

describe('negative: object/meta conflation REJECTED', () => {
  it('a MetaChange routed through the object pipeline is rejected (and vice versa)', () => {
    const metaChangeId = mintRandomArtifactId('MetaChange');
    const objectChangeId = mintRandomArtifactId('CandidateState');
    const objectLane = routeToObjectPipeline(metaChangeId);
    expect(objectLane.accepted).toBe(false);
    expect(objectLane.rejection?.code).toBe('OBJECT_META_CONFLATION');
    const metaLane = routeToMetaPipeline(objectChangeId);
    expect(metaLane.accepted).toBe(false);
    expect(metaLane.rejection?.code).toBe('OBJECT_META_CONFLATION');
  });

  it('the golden run retains BOTH conflation rejections in the separation record', () => {
    const { result } = { result: runMetaEvolutionLoop(buildGoldenMetaInput().input) };
    expect(result.stages.separation.conflation_rejections).toBe(2);
    expect(result.stages.separation.lane_probes.filter((probe) => probe.rejection !== null)).toHaveLength(2);
  });
});

describe('negative: governance-weakening meta-change accepted REJECTED', () => {
  const weakeningPatches: Array<Record<string, unknown>> = [
    { governance: { authority_gates: false } },
    { traceability: { trace_links: 'optional' } },
    { ask_policy: { escalation: 'disabled' } },
    { decision_records: { required: false } },
    { guard: { enabled: false } },
    { retrieval_weights: { VALIDATED_PACKAGE: 0 } },
    { strategy: { max_candidates_per_family: 0 } },
  ];

  it('every governance-weakening change is REJECTED by the guard (never accepted)', () => {
    const process = createMetaProcess({
      content: { parameters: cloneParameters(BASE_PARAMETERS), mission_ref: null, notes: 'negative' },
      provenance: PROVENANCE,
      created_at: NOW,
      status: 'ACTIVE',
    });
    for (const patch of weakeningPatches) {
      const change = createMetaChange({
        content: {
          target_process_id: process.envelope.id,
          target_process_version: process.envelope.version,
          patch,
          intent: 'weakening attempt',
          source_package_id: 'sos://Package/' + 'a'.repeat(32),
          predicted_effects: ['faster without governance'],
          proposed_against: cloneParameters(BASE_PARAMETERS),
        },
        provenance: PROVENANCE,
        created_at: NOW,
        status: 'ACTIVE',
      });
      const verdict = evaluateGovernanceGuard(change, BASE_PARAMETERS);
      expect(verdict.passed, JSON.stringify(patch)).toBe(false);
      expect(verdict.rejection, JSON.stringify(patch)).not.toBeNull();
      // ...and it can never be APPLIED:
      expect(() => applyMetaChange(process, change, GOVERNANCE_GUARD, { provenance: PROVENANCE, created_at: NOW })).toThrow();
    }
  });

  it("the golden run's weakening proposal produced NO revision, decision or application", () => {
    const result = runMetaEvolutionLoop(buildGoldenMetaInput().input);
    const rejection = result.artifacts.guard_rejections[0]!;
    const revisionsForChange = result.artifacts.process_revisions.filter((revision) =>
      revision.content.notes.includes(rejection.change_id),
    );
    expect(revisionsForChange).toHaveLength(0);
    expect(result.summary.guard.rejected).toBe(1);
  });
});

describe('negative: guard bypass REJECTED', () => {
  it('the apply path re-runs the guard — a direct weakening application throws', () => {
    const process = createMetaProcess({
      content: { parameters: cloneParameters(BASE_PARAMETERS), mission_ref: null, notes: 'bypass' },
      provenance: PROVENANCE,
      created_at: NOW,
      status: 'ACTIVE',
    });
    const weakening = createMetaChange({
      content: {
        target_process_id: process.envelope.id,
        target_process_version: process.envelope.version,
        patch: { guard: { enabled: false }, governance: { authority_gates: false } },
        intent: 'bypass attempt',
        source_package_id: 'sos://Package/' + 'b'.repeat(32),
        predicted_effects: ['no governance'],
        proposed_against: cloneParameters(BASE_PARAMETERS),
      },
      provenance: PROVENANCE,
      created_at: NOW,
      status: 'ACTIVE',
    });
    expect(() => applyMetaChange(process, weakening, GOVERNANCE_GUARD, { provenance: PROVENANCE, created_at: NOW })).toThrow(
      /GUARD_BYPASS|rejected by the governance guard/,
    );
  });

  it('applyParametersPatch refuses non-evolvable keys even without a guard verdict', () => {
    expect(() => applyParametersPatch(BASE_PARAMETERS, { authority: { gates: false } })).toThrow(/non-evolvable keys/);
    expect(() => applyParametersPatch(BASE_PARAMETERS, { trace_links: 'optional' })).toThrow(/non-evolvable keys/);
  });
});

describe('negative: effectiveness-unmeasured promotion REJECTED', () => {
  it('a candidate without a measurement cannot enter the promotion lane', () => {
    const candidateId = 'sos://CandidateState/' + 'c'.repeat(32);
    expect(() => assertMeasuredBeforePromotion(candidateId, [])).toThrow(/EFFECTIVENESS_UNMEASURED|unmeasured/);
  });

  it('the decision lane machine-checks the measurement gate', () => {
    const candidateId = 'sos://CandidateState/' + 'd'.repeat(32);
    expect(() => assertMeasuredBeforePromotion(candidateId, [])).toThrow();
    // a measured candidate passes:
    expect(() =>
      assertMeasuredBeforePromotion(candidateId, [
        { candidate: { envelope: { id: candidateId } } as never },
      ]),
    ).not.toThrow();
  });
});

describe('negative: rollback without recovery declaration REJECTED', () => {
  it('a ROLLBACK decision without a bounded recovery declaration is rejected', () => {
    expect(() => assertRollbackRecovery('ROLLBACK', null)).toThrow(/ROLLBACK_WITHOUT_RECOVERY|bounded recovery declaration/);
  });

  it('non-rollback decisions do not require the declaration (the asymmetric gate)', () => {
    expect(() => assertRollbackRecovery('ACT', null)).not.toThrow();
    expect(() => assertRollbackRecovery('ASK', null)).not.toThrow();
  });

  it("the golden run's rollback carries a valid wired recovery declaration", () => {
    const result = runMetaEvolutionLoop(buildGoldenMetaInput().input);
    for (const rollback of result.stages.rollback.rollbacks) {
      expect(() => assertRollbackRecovery('ROLLBACK', rollback.recovery)).not.toThrow();
      expect(rollback.recovery.rollback_triggers.length).toBeGreaterThan(0);
    }
  });
});

describe('negative: failed change deleted instead of retained REJECTED', () => {
  it('the memory evolution rule rejects dropping the FAILURE entry (memory never forgets)', () => {
    const evidence = createEvidence({
      kind: 'meta-evolution-outcome',
      subject_ref: 'sos://MetaChange/' + 'e'.repeat(32),
      availability: 'FAILURE',
      evidence_class: 'OBSERVATIONAL',
      method: 'meta-evolution:rollback-outcome',
      provenance: PROVENANCE,
      window: { start: NOW, end: NOW },
      producer: PRODUCER,
    });
    const memory = createArchitectureMemory({
      content: {
        entries: [
          {
            entry_kind: 'FAILURE',
            id: 'failure-x',
            recorded_at: NOW,
            statement: 'the failed change',
            evidence_refs: [evidence.id],
            context: { domain: 'sos-meta' },
          },
          {
            entry_kind: 'ROLLBACK',
            id: 'rollback-x',
            recorded_at: NOW,
            statement: 'the failed change rolled back within the recovery bound',
            from_revision: 'sos://MetaProcess/' + '1'.repeat(32) + '@v2',
            to_revision: 'sos://MetaProcess/' + '2'.repeat(32) + '@v3',
            reason: 'guardrail breach',
            evidence_refs: [evidence.id],
            context: { domain: 'sos-meta' },
          },
          {
            entry_kind: 'LIABILITY',
            id: 'liability-x',
            recorded_at: NOW,
            statement: 'the source package carries a failed self-change',
            severity: 'HIGH',
            owner_kind: 'GOVERNANCE',
            resolution: openResolution(),
            context: { domain: 'sos-meta' },
          },
          {
            entry_kind: 'LEARNED_RULE',
            id: 'rule-x',
            recorded_at: NOW,
            statement: 'learned',
            applicability: { domain: 'sos-meta' },
            evidence_refs: [evidence.id],
            uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
          },
        ],
        update: { producer: PRODUCER, evidence_refs: [evidence.id] },
      },
      provenance: PROVENANCE,
      created_at: NOW,
      status: 'ACTIVE',
    });
    const store = new ArchitectureMemoryStore();
    store.put(memory);
    // the retention assertion passes WITH the failure:
    expect(() => assertFailureRetained(store, memory.envelope.id)).not.toThrow();
    // attempting to REVISE the memory WITHOUT the FAILURE entry (a deletion)
    // is rejected by the memory evolution rule (never forgets):
    expect(() =>
      store.revise(memory.envelope.id, {
        entries: [
          {
            entry_kind: 'LEARNED_RULE',
            id: 'rule-x',
            recorded_at: NOW,
            statement: 'learned',
            applicability: { domain: 'sos-meta' },
            evidence_refs: [evidence.id],
            uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
          },
        ],
        update: { producer: PRODUCER, evidence_refs: [evidence.id] },
        provenance: PROVENANCE,
        created_at: NOW,
      }),
    ).toThrow();
  });

  it('assertFailureRetained detects a memory that lost its failure entries', () => {
    const evidence = createEvidence({
      kind: 'meta-evolution-outcome',
      subject_ref: 'sos://MetaChange/' + 'f'.repeat(32),
      availability: 'FAILURE',
      evidence_class: 'OBSERVATIONAL',
      method: 'meta-evolution:rollback-outcome',
      provenance: PROVENANCE,
      window: { start: NOW, end: NOW },
      producer: PRODUCER,
    });
    const incomplete = createArchitectureMemory({
      content: {
        entries: [
          {
            entry_kind: 'LIABILITY',
            id: 'liability-y',
            recorded_at: NOW,
            statement: 'liability only — failure deleted',
            severity: 'HIGH',
            owner_kind: 'GOVERNANCE',
            resolution: openResolution(),
            context: { domain: 'sos-meta' },
          },
        ],
        update: { producer: PRODUCER, evidence_refs: [evidence.id] },
      },
      provenance: PROVENANCE,
      created_at: NOW,
      status: 'ACTIVE',
    });
    const store = new ArchitectureMemoryStore();
    store.put(incomplete);
    expect(() => assertFailureRetained(store, incomplete.envelope.id)).toThrow(/LIABILITY_RETENTION_VIOLATION|missing its FAILURE/);
  });

  it("the golden run retains the failure in the injected stores (no deletion path exists)", () => {
    const built = buildGoldenMetaInput();
    const result = runMetaEvolutionLoop(built.input);
    const memory = result.artifacts.retentions[0]!.memory;
    expect(built.input.stores.memory.entriesOf(memory.envelope.id, 'FAILURE')).toHaveLength(1);
    expect(built.input.stores.transfer.allTransfers().some((record) => record.outcome === 'TRANSFER_FAILURE')).toBe(true);
    // the failed package remains registered (never deleted from the ecology):
    expect(built.input.registry.current(result.stages.liability.failures[0]!.package_id)).toBeDefined();
  });
});

describe('negative: broken trace chain REJECTED', () => {
  const result = runMetaEvolutionLoop(buildGoldenMetaInput().input);

  it('removing a link breaks connectivity and the assert fails loudly', () => {
    // remove the ASK link (ask DERIVED_FROM engine decision):
    const askLink = result.trace.find((link) => link.target.startsWith('sos://Decision/') && link.source.startsWith('sos://AskRequest/'));
    expect(askLink).toBeDefined();
    const brokenTrace = result.trace.filter((link) => link !== askLink);
    const required = [...result.chain.reachable];
    const verification = verifyMetaTraceChain(brokenTrace, result.chain.root, required);
    expect(verification.complete).toBe(false);
    expect(verification.missing.length).toBeGreaterThan(0);
    expect(() => assertMetaTraceChain(brokenTrace, result.chain.root, required)).toThrow(/BROKEN_TRACE_CHAIN|not reachable/);
  });

  it('an endpoint missing from the graph entirely also fails the assert', () => {
    const required = [...result.chain.reachable, 'sos://Evidence/' + '0'.repeat(32)];
    expect(() => assertMetaTraceChain(result.trace, result.chain.root, required)).toThrow();
  });

  it('the intact golden chain passes (the control)', () => {
    expect(() => assertMetaTraceChain(result.trace, result.chain.root, result.chain.reachable)).not.toThrow();
  });
});
