/**
 * Unit tests — the meta-evolution core: kinds, parameters, process
 * revisions, change artifacts, the governance guard, routing, apply/rollback
 * exact restore, and the R19 penalty.
 */

import { describe, expect, it } from 'vitest';
import {
  EVOLVABLE_KEYS,
  applyParametersPatch,
  assertValidMetaProcessParameters,
  cloneParameters,
  isEvolvableKey,
  nonEvolvableKeys,
  parametersEqual,
  patchKeys,
} from '../src/parameters.js';
import {
  META_CHANGE_KIND,
  META_PROCESS_KIND,
  registerMetaEvolutionKinds,
} from '../src/kinds.js';
import { createMetaChange, metaChangeArtifactId } from '../src/change.js';
import type { MetaChangeArtifact } from '../src/change.js';
import {
  activateRevision,
  applyMetaChange,
  assertExactRestore,
  createMetaProcess,
  MetaProcessStore,
  retireRevision,
} from '../src/process.js';
import type { MetaProcessArtifact } from '../src/process.js';
import {
  evaluateGovernanceGuard,
  GOVERNANCE_GUARD,
  GOVERNANCE_INVARIANT_IDS,
} from '../src/guard.js';
import {
  OBJECT_CHANGE_KIND,
  routeToMetaPipeline,
  routeToObjectPipeline,
} from '../src/routing.js';
import { failurePenalty } from '../src/propose.js';
import { isRegisteredArtifactKind, mintRandomArtifactId } from '@sos-2/semantic-spine';

const NOW = '2025-07-01T00:00:00.000Z';
const PROVENANCE = ['W16:test:unit'];
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

function baseProcess(): MetaProcessArtifact {
  return createMetaProcess({
    content: { parameters: cloneParameters(BASE_PARAMETERS), mission_ref: null, notes: 'test process' },
    provenance: PROVENANCE,
    created_at: NOW,
    status: 'ACTIVE',
  });
}

function metaChange(patch: Record<string, unknown>, packageId = 'sos://Package/' + 'a'.repeat(32)): MetaChangeArtifact {
  return createMetaChange({
    content: {
      target_process_id: baseProcess().envelope.id,
      target_process_version: 1,
      patch,
      intent: 'test change',
      source_package_id: packageId,
      predicted_effects: ['effect-1'],
      proposed_against: cloneParameters(BASE_PARAMETERS),
    },
    provenance: PROVENANCE,
    created_at: NOW,
    status: 'ACTIVE',
  });
}

describe('kinds', () => {
  it('registers MetaProcess and MetaChange (idempotent, add-only)', () => {
    expect(isRegisteredArtifactKind(META_PROCESS_KIND)).toBe(true);
    expect(isRegisteredArtifactKind(META_CHANGE_KIND)).toBe(true);
    expect(() => registerMetaEvolutionKinds()).not.toThrow();
    expect(() => registerMetaEvolutionKinds()).not.toThrow();
  });
});

describe('parameters', () => {
  it('validates the exact evolvable surface', () => {
    expect(EVOLVABLE_KEYS).toHaveLength(9);
    expect(isEvolvableKey('strategy.exploration_rate')).toBe(true);
    expect(isEvolvableKey('governance.authority_gates')).toBe(false);
    expect(() => assertValidMetaProcessParameters(BASE_PARAMETERS)).not.toThrow();
  });

  it('rejects invalid parameter sets loudly', () => {
    expect(() => assertValidMetaProcessParameters({ ...BASE_PARAMETERS, strategy: { ...BASE_PARAMETERS.strategy, exploration_rate: 1.5 } })).toThrow();
    expect(() =>
      assertValidMetaProcessParameters({
        ...BASE_PARAMETERS,
        retrieval_weights: { ...BASE_PARAMETERS.retrieval_weights, VALIDATED_PACKAGE: 0 },
      }),
    ).toThrow();
    expect(() => assertValidMetaProcessParameters({ ...BASE_PARAMETERS, strategy: { ...BASE_PARAMETERS.strategy, max_candidates_per_family: 0 } })).toThrow();
  });

  it('flattens patch keys and flags foreign keys', () => {
    const patch = { strategy: { exploration_rate: 0.4 }, governance: { authority_gates: false } };
    expect(patchKeys(patch)).toEqual(['governance.authority_gates', 'strategy.exploration_rate']);
    expect(nonEvolvableKeys(patch)).toEqual(['governance.authority_gates']);
  });

  it('applies patches purely and refuses foreign keys loudly', () => {
    const next = applyParametersPatch(BASE_PARAMETERS, { strategy: { exploration_rate: 0.4 }, retrieval_weights: { VALIDATED_PACKAGE: 1.3 } });
    expect(next.strategy.exploration_rate).toBe(0.4);
    expect(next.retrieval_weights['VALIDATED_PACKAGE']).toBe(1.3);
    expect(BASE_PARAMETERS.strategy.exploration_rate).toBe(0.2);
    expect(() => applyParametersPatch(BASE_PARAMETERS, { guard: { enabled: false } })).toThrow(/non-evolvable keys/);
  });

  it('compares parameters canonically', () => {
    expect(parametersEqual(BASE_PARAMETERS, cloneParameters(BASE_PARAMETERS))).toBe(true);
    expect(parametersEqual(BASE_PARAMETERS, applyParametersPatch(BASE_PARAMETERS, { strategy: { exploration_rate: 0.4 } }))).toBe(false);
  });
});

describe('process revisions', () => {
  it('mints deterministic content-addressed ids', () => {
    const input = {
      content: { parameters: cloneParameters(BASE_PARAMETERS), mission_ref: null, notes: 'deterministic' },
      provenance: PROVENANCE,
      created_at: NOW,
      status: 'ACTIVE' as const,
    };
    const a = createMetaProcess(input);
    const b = createMetaProcess(input);
    expect(a.envelope.id).toBe(b.envelope.id);
    expect(a.envelope.id.startsWith(`sos://${META_PROCESS_KIND}/`)).toBe(true);
  });

  it('stores linear contiguous chains and reports history', () => {
    const store = new MetaProcessStore();
    const root = baseProcess();
    store.put(root);
    const change = metaChange({ strategy: { exploration_rate: 0.4 } }, mintRandomArtifactId('Package'));
    const { trial } = applyMetaChange(root, change, GOVERNANCE_GUARD, { provenance: PROVENANCE, created_at: NOW });
    store.put(trial);
    const { activated, superseded } = activateRevision(trial, root);
    store.replace(trial, activated);
    store.replace(root, superseded);
    expect(store.active()).toHaveLength(1);
    expect(store.active()[0]!.envelope.id).toBe(trial.envelope.id);
    expect(store.history(activated.envelope.id)).toHaveLength(2);
    expect(store.history(activated.envelope.id)[0]!.envelope.status).toBe('SUPERSEDED');
  });

  it('activates only DRAFT trials that supersede the head; retires only DRAFT trials', () => {
    const root = baseProcess();
    const change = metaChange({ strategy: { exploration_rate: 0.4 } }, mintRandomArtifactId('Package'));
    const { trial } = applyMetaChange(root, change, GOVERNANCE_GUARD, { provenance: PROVENANCE, created_at: NOW });
    const { activated } = activateRevision(trial, root);
    expect(() => activateRevision(activated, root)).toThrow();
    expect(() => retireRevision(activated)).toThrow();
    expect(retireRevision(trial).envelope.status).toBe('RETIRED');
  });

  it('assertExactRestore detects non-exact restores', () => {
    expect(() => assertExactRestore(BASE_PARAMETERS, cloneParameters(BASE_PARAMETERS))).not.toThrow();
    expect(() => assertExactRestore(applyParametersPatch(BASE_PARAMETERS, { strategy: { exploration_rate: 0.9 } }), BASE_PARAMETERS)).toThrow(/RESTORE_NOT_EXACT|not the exact/);
  });
});

describe('meta change artifacts', () => {
  it('mints deterministic ids and validates content deeply', () => {
    const process = baseProcess();
    const content = {
      target_process_id: process.envelope.id,
      target_process_version: 1,
      patch: { strategy: { exploration_rate: 0.4 } },
      intent: 'intent',
      source_package_id: 'sos://Package/' + 'b'.repeat(32),
      predicted_effects: ['e1'],
      proposed_against: cloneParameters(BASE_PARAMETERS),
    };
    const a = metaChangeArtifactId({ content, provenance: PROVENANCE, created_at: NOW, status: 'ACTIVE' });
    const b = metaChangeArtifactId({ content, provenance: PROVENANCE, created_at: NOW, status: 'ACTIVE' });
    expect(a).toBe(b);
    expect(a.startsWith(`sos://${META_CHANGE_KIND}/`)).toBe(true);
  });

  it('requires a Package source (R24) and a MetaProcess target', () => {
    expect(() =>
      metaChange({ strategy: { exploration_rate: 0.4 } }, 'sos://CandidateState/' + 'c'.repeat(32)),
    ).toThrow(/sos:\/\/Package\//);
    expect(() =>
      createMetaChange({
        content: {
          target_process_id: 'sos://CandidateState/' + 'd'.repeat(32),
          target_process_version: 1,
          patch: { strategy: { exploration_rate: 0.4 } },
          intent: 'x',
          source_package_id: 'sos://Package/' + 'e'.repeat(32),
          predicted_effects: ['e'],
          proposed_against: cloneParameters(BASE_PARAMETERS),
        },
        provenance: PROVENANCE,
        created_at: NOW,
      }),
    ).toThrow(/MetaProcess/);
  });
});

describe('governance guard', () => {
  it('passes governance-preserving evolvable patches', () => {
    const change = metaChange({ strategy: { exploration_rate: 0.4 }, retrieval_weights: { VALIDATED_PACKAGE: 1.2 } });
    const verdict = evaluateGovernanceGuard(change, BASE_PARAMETERS);
    expect(verdict.passed).toBe(true);
    expect(verdict.rejection).toBeNull();
    expect(verdict.invariants_checked).toEqual([...GOVERNANCE_INVARIANT_IDS]);
  });

  it('rejects every governance-weakening category with typed records', () => {
    const cases: Array<{ patch: Record<string, unknown>; invariant: string }> = [
      { patch: { governance: { authority_gates: false } }, invariant: 'AUTHORITY_GATES_NON_DISABLEABLE' },
      { patch: { authority: { requires_authority: false } }, invariant: 'AUTHORITY_GATES_NON_DISABLEABLE' },
      { patch: { guard: { enabled: false } }, invariant: 'AUTHORITY_GATES_NON_DISABLEABLE' },
      { patch: { traceability: { trace_links: 'optional' } }, invariant: 'TRACEABILITY_MANDATORY' },
      { patch: { provenance: { required: false } }, invariant: 'TRACEABILITY_MANDATORY' },
      { patch: { ask_policy: { escalation: 'disabled' } }, invariant: 'ASK_FIRST_CLASS' },
      { patch: { decision_records: { required: false } }, invariant: 'DECISION_RECORDS_MANDATORY' },
      { patch: { retrieval_weights: { VALIDATED_PACKAGE: 0 } }, invariant: 'VALIDATED_ALTITUDE_FLOOR' },
      { patch: { retrieval_weights: { VALIDATED_COMPOSITION: 0 } }, invariant: 'VALIDATED_ALTITUDE_FLOOR' },
      { patch: { strategy: { max_candidates_per_family: 0 } }, invariant: 'DIVERSITY_FLOOR' },
      { patch: { strategy: { search_policy: 'FAST' } }, invariant: 'META_EVOLVABLE_SURFACE' },
    ];
    for (const testCase of cases) {
      const change = metaChange(testCase.patch);
      const verdict = evaluateGovernanceGuard(change, BASE_PARAMETERS);
      expect(verdict.passed, JSON.stringify(testCase.patch)).toBe(false);
      expect(verdict.rejection?.invariant, JSON.stringify(testCase.patch)).toBe(testCase.invariant);
      expect(verdict.rejection?.reason.length ?? 0).toBeGreaterThan(0);
      expect(verdict.rejection?.change_id).toBe(change.envelope.id);
    }
  });

  it('is deterministic: the same change yields the byte-identical rejection', () => {
    const change = metaChange({ guard: { enabled: false } });
    const first = evaluateGovernanceGuard(change, BASE_PARAMETERS);
    const second = evaluateGovernanceGuard(change, BASE_PARAMETERS);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('object/meta separation (routing)', () => {
  const objectChangeId = mintRandomArtifactId('CandidateState');
  const metaChangeId = mintRandomArtifactId('MetaChange');

  it('accepts only the pinned kind per lane', () => {
    expect(routeToObjectPipeline(objectChangeId)).toMatchObject({ accepted: true, parsed_kind: OBJECT_CHANGE_KIND, rejection: null });
    expect(routeToMetaPipeline(metaChangeId)).toMatchObject({ accepted: true, parsed_kind: META_CHANGE_KIND, rejection: null });
  });

  it('rejects a MetaChange routed through the object pipeline (and vice versa)', () => {
    const verdict = routeToObjectPipeline(metaChangeId);
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejection?.code).toBe('OBJECT_META_CONFLATION');
    expect(verdict.rejection?.submitted_kind).toBe('MetaChange');
    expect(verdict.rejection?.expected_kind).toBe('CandidateState');

    const reverse = routeToMetaPipeline(objectChangeId);
    expect(reverse.accepted).toBe(false);
    expect(reverse.rejection?.code).toBe('OBJECT_META_CONFLATION');
    expect(reverse.rejection?.submitted_kind).toBe('CandidateState');
    expect(reverse.rejection?.expected_kind).toBe('MetaChange');
  });

  it('rejects malformed change ids with typed records', () => {
    const verdict = routeToMetaPipeline('not-an-id');
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejection?.code).toBe('MALFORMED_CHANGE_ID');
  });
});

describe('apply + rollback exact restore', () => {
  it('restores the exact pre-change parameters on rollback', () => {
    const root = baseProcess();
    const change = metaChange({ strategy: { exploration_rate: 0.65 }, retrieval_weights: { VALIDATED_PACKAGE: 2.0 } });
    const { trial } = applyMetaChange(root, change, GOVERNANCE_GUARD, { provenance: PROVENANCE, created_at: NOW });
    expect(trial.content.parameters.strategy.exploration_rate).toBe(0.65);
    expect(trial.envelope.status).toBe('DRAFT');

    const retired = retireRevision(trial);
    const restore = createMetaProcess({
      content: {
        parameters: cloneParameters(root.content.parameters),
        mission_ref: root.content.mission_ref,
        notes: 'restore',
      },
      provenance: PROVENANCE,
      created_at: NOW,
      version: root.envelope.version + 1,
      status: 'ACTIVE',
      supersedes: root.envelope.id,
    });
    assertExactRestore(restore.content.parameters, root.content.parameters);
    expect(retired.envelope.status).toBe('RETIRED');
  });

  it('refuses to apply a change targeting a foreign process chain', () => {
    const root = baseProcess();
    const foreignTarget = createMetaProcess({
      content: { parameters: cloneParameters(BASE_PARAMETERS), mission_ref: null, notes: 'a DIFFERENT chain root' },
      provenance: PROVENANCE,
      created_at: NOW,
      status: 'ACTIVE',
    });
    expect(foreignTarget.envelope.id).not.toBe(root.envelope.id);
    const change = metaChangeFor(foreignTarget, { strategy: { exploration_rate: 0.4 } });
    expect(() =>
      applyMetaChange(root, change, GOVERNANCE_GUARD, { provenance: PROVENANCE, created_at: NOW, targetInChain: () => false }),
    ).toThrow(/neither the current revision/);
  });
});

describe('R19 penalty', () => {
  it('monotonically reduces the proposal weight with recorded failures', () => {
    expect(failurePenalty(0)).toBe(1);
    expect(failurePenalty(1)).toBe(0.5);
    expect(failurePenalty(2)).toBe(1 / 3);
    expect(failurePenalty(-5)).toBe(1); // defensive
  });
});

function metaChangeFor(process: MetaProcessArtifact, patch: Record<string, unknown>): MetaChangeArtifact {
  return createMetaChange({
    content: {
      target_process_id: process.envelope.id,
      target_process_version: process.envelope.version,
      patch,
      intent: 'test change',
      source_package_id: 'sos://Package/' + 'f'.repeat(32),
      predicted_effects: ['effect-1'],
      proposed_against: cloneParameters(process.content.parameters),
    },
    provenance: PROVENANCE,
    created_at: NOW,
    status: 'ACTIVE',
  });
}
