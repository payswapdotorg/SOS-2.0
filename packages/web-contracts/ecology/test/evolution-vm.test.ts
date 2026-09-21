/**
 * Evolution projection tests — the self-evolution acceptance: process
 * revisions (with the exact restore), the non-disableable guard state, the
 * retained failure memory, the learned rules and the machine state — all
 * read from canonical live state through the live-store repositories.
 */

import { describe, expect, test } from 'vitest';
import { GOVERNANCE_INVARIANT_IDS } from '@sos-2/meta-evolution';
import {
  EVOLUTION_READ_ONLY_NOTE,
  FAILURE_MEMORY_RETENTION_NOTE,
  GUARD_NON_DISABLEABLE_NOTE,
  projectEvolution,
} from '../src/index.js';
import { allLinks, chainFor, demoSource, liveRead, world } from './helpers.js';

const w = world();
const source = demoSource();
const missionV2 = w.base.missions[w.base.missions.length - 1]!;
const processV3 = w.process_revisions[w.process_revisions.length - 1]!;

function evolutionVM() {
  const memories = w.failure_memory;
  const machineStateRaw = w.development_state.state as Record<string, unknown>;
  return projectEvolution({
    process_revisions: w.process_revisions,
    guard_rejections: [w.guard_rejection],
    memories: [memories],
    machine_state: {
      state_id: w.development_state.state_id,
      revision: w.development_state.revision,
      description: w.development_state.description,
      updated_at: w.development_state.updated_at,
      frontier: (machineStateRaw['currentFrontier'] as string[]) ?? [],
      program: (machineStateRaw['program'] as string) ?? '',
      status: (machineStateRaw['status'] as string) ?? '',
      current_task: (machineStateRaw['currentTask'] as string) ?? '',
    },
    live_read: {
      store_ref: 'in-memory-reference://demo-ecology-seed',
      families_read: ['history.memories', 'developmentState', 'packages', 'evidence'],
      as_of: w.now,
    },
    rationale: chainFor(processV3.envelope.id, allLinks(w), w.evolution_evidence.map((record) => record.id)),
    data_source: source,
    evidence_refs: w.evolution_evidence.map((record) => record.id),
    uncertainty: {
      uncertainty_class: 'MODERATE',
      statement: 'The effectiveness picture rests on one trial window; the restore is exact but the cost coupling stays uncertain.',
    },
    authority: {
      mode: 'READ_ONLY',
      required_permission: null,
      grant_ref: null,
      note: 'Self-evolution is observed, never steered from the console (meta-adaptation cannot disable its own judge).',
    },
    next_allowed_action: {
      action_id: 'view-process-history',
      kind: 'REVIEW',
      label: 'Open the process revision history',
      description: 'See the full revision diff of the SOS process chain.',
      href: `/history/revision/MetaProcess/${processV3.envelope.id.slice('sos://MetaProcess/'.length)}`,
      rationale_ref: processV3.envelope.id,
      requires_authority: null,
    },
  });
}

describe('the process revision chain', () => {
  const vm = evolutionVM();

  test('orders the chain baseline -> trial -> restore with the restore ACTIVE', () => {
    expect(vm.process_chain.entries.map((entry) => entry.version)).toEqual([1, 2, 3]);
    expect(vm.process_chain.entries.map((entry) => entry.status)).toEqual(['SUPERSEDED', 'RETIRED', 'ACTIVE']);
    expect(vm.process_chain.current_head).toBe(processV3.envelope.id);
  });

  test('carries the parameters VERBATIM with a digest per revision', () => {
    for (const entry of vm.process_chain.entries) {
      expect(entry.parameters.strategy).toBeDefined();
      expect(entry.parameters.retrieval_weights.VALIDATED_PACKAGE).toBeGreaterThan(0);
      expect(entry.parameters_digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('the restore is EXACT: the v3 digest equals the v1 digest (and differs from the trial)', () => {
    const [v1, v2, v3] = vm.process_chain.entries;
    expect(v3!.parameters_digest).toBe(v1!.parameters_digest);
    expect(v3!.parameters_digest).not.toBe(v2!.parameters_digest);
  });
});

describe('the non-disableable guard state', () => {
  const vm = evolutionVM();

  test('carries the frozen invariant list VERBATIM from the owning package', () => {
    expect(vm.guard.invariants).toEqual([...GOVERNANCE_INVARIANT_IDS]);
    expect(vm.guard.note).toBe(GUARD_NON_DISABLEABLE_NOTE);
  });

  test('the guard is outside the evolvable surface (no governance keys are evolvable)', () => {
    expect(vm.guard.evolvable_keys.every((key) => !/authority|guard|ask|decision|trace/.test(key))).toBe(true);
    expect(vm.guard.evolvable_keys.length).toBeGreaterThan(0);
  });

  test('retains the typed rejection of the governance-weakening attempt', () => {
    expect(vm.guard.rejections).toHaveLength(1);
    const rejection = vm.guard.rejections[0]!;
    expect(rejection.code).toBe('VALIDATED_ALTITUDE_ZEROED');
    expect(rejection.invariant).toBe('VALIDATED_ALTITUDE_FLOOR');
    expect(rejection.attempted_keys).toContain('retrieval_weights.VALIDATED_PACKAGE');
    expect(rejection.reason).toContain('highest safe validated reasoning altitude');
  });
});

describe('the retained failure memory (R19)', () => {
  const vm = evolutionVM();

  test('keeps FAILURE, ROLLBACK, LIABILITY and LEARNED_RULE entries — never deleted', () => {
    expect(vm.failure_memory.entry_kinds_present.sort()).toEqual(['FAILURE', 'LEARNED_RULE', 'LIABILITY', 'ROLLBACK']);
    expect(vm.failure_memory.note).toBe(FAILURE_MEMORY_RETENTION_NOTE);
  });

  test('the FAILURE entry keeps its context facts (contexts of failure are retained)', () => {
    const failure = vm.failure_memory.memories[0]!.entries.find((entry) => entry.entry_kind === 'FAILURE')!;
    expect(failure.context_facts.join(' ')).toContain('sos-meta');
    expect(failure.evidence_refs.length).toBeGreaterThan(0);
  });

  test('the LIABILITY entry is owned with an open resolution', () => {
    const liability = vm.failure_memory.memories[0]!.entries.find((entry) => entry.entry_kind === 'LIABILITY')!;
    expect(liability.severity).toBe('HIGH');
    expect(liability.owner_kind).toBe('GOVERNANCE');
    expect(liability.resolution!.state).toBe('OPEN');
  });

  test('surfaces the learned rule first-class with its applicability and uncertainty', () => {
    expect(vm.learned_rules).toHaveLength(1);
    const rule = vm.learned_rules[0]!;
    expect(rule.statement).toContain('exploration rate');
    expect(rule.applicability['lesson']).toBe('exploration-cost-coupling');
    expect(rule.uncertainty_class).toBe('MODERATE');
    expect(rule.evidence_refs.length).toBeGreaterThan(0);
  });
});

describe('the machine state and the live-read provenance', () => {
  const vm = evolutionVM();

  test('carries the machine-state snapshot (frontier, program, current task)', () => {
    expect(vm.machine_state?.frontier.sort()).toEqual(['P10', 'P4', 'P5', 'P7']);
    expect(vm.machine_state?.program).toBe('SOS 2.0 Productization');
    expect(vm.machine_state?.current_task).toBe('P10');
  });

  test('carries the live-read provenance (store ref, families, read instant)', () => {
    expect(vm.live_read.store_ref).toBe('in-memory-reference://demo-ecology-seed');
    expect(vm.live_read.families_read).toContain('history.memories');
    expect(vm.live_read.as_of).toBe(w.now);
  });

  test('is a READ-ONLY projection (the note is structural)', () => {
    expect(vm.read_only_note).toBe(EVOLUTION_READ_ONLY_NOTE);
    expect(vm.core.data_source.kind).toBe('DEMO');
  });
});

describe('the evolution records come through the live-store repositories', () => {
  test('the failure memory and machine state are read from the store, not from fixture objects', async () => {
    const read = await liveRead(w);
    expect(read.memories).toHaveLength(1);
    expect(read.memories[0]!.envelope.id).toBe(w.failure_memory.envelope.id);
    expect(read.memories[0]!.content).toEqual(w.failure_memory.content);
    expect(read.development_state).toHaveLength(1);
    expect(read.development_state[0]!.state_id).toBe(w.development_state.state_id);
  });
});
