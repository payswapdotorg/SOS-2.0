/**
 * History projection tests — the timeline + revision diff acceptance:
 * chains per kind ordered oldest -> newest, the per-revision what/why/
 * evidence, and the typed revision diff (including the exact-restore case).
 */

import { describe, expect, test } from 'vitest';
import { projectHistoryWorkspace, projectRevisionDiff, projectRevisionChains, revisionHrefOf, revisionNoteOf } from '../src/index.js';
import type { HistoryArtifactBearer } from '../src/index.js';
import { allLinks, chainFor, demoSource, liveRead, world } from './helpers.js';

const w = world();
const source = demoSource();
const missionV2 = w.base.missions[w.base.missions.length - 1]!;

const authority = {
  mode: 'READ_ONLY' as const,
  required_permission: null,
  grant_ref: null,
  note: 'History is a read-only projection of the durable revision chains.',
};

const nextAction = {
  action_id: 'view-history',
  kind: 'NAVIGATE' as const,
  label: 'Open History',
  description: 'The revision timeline with diffs.',
  href: '/history',
  rationale_ref: null,
  requires_authority: null,
};

describe('the revision chains over the live read', () => {
  test('every revision-bearing family read from the store forms its chains', async () => {
    const read = await liveRead(w);
    const artifacts = [
      ...read.missions,
      ...read.system_states,
      ...read.packages,
      ...read.memories,
      ...read.hypotheses,
      ...read.experiments,
      ...read.candidates,
      ...read.decisions,
      ...read.authority_grants,
    ];
    const chains = projectRevisionChains({ artifacts, evidence: read.evidence, data_source: source });
    const kinds = new Set(chains.map((chain) => chain.kind));
    for (const expected of ['Mission', 'SystemState', 'Package', 'ArchitectureMemory', 'CausalHypothesis', 'Experiment', 'CandidateState', 'Decision', 'AuthorityGrant']) {
      expect(kinds.has(expected)).toBe(true);
    }
    for (const chain of chains) {
      expect(chain.entries.length).toBeGreaterThan(0);
      expect(chain.current_head).toBe(chain.entries[chain.entries.length - 1]!.artifact_id);
      expect(chain.lineage_root).toBe(chain.entries[0]!.artifact_id);
      expect(chain.entries[0]!.supersedes).toBeNull();
      for (let index = 1; index < chain.entries.length; index += 1) {
        expect(chain.entries[index]!.supersedes).toBe(chain.entries[index - 1]!.artifact_id);
      }
    }
  });

  test('package chains are ordered oldest -> newest with the v2 head (one lineage per chain)', async () => {
    const read = await liveRead(w);
    const chains = projectRevisionChains({ artifacts: read.packages, evidence: read.evidence, data_source: source });
    expect(chains).toHaveLength(3); // the queue chain, the cache chain, the meta-strategy package
    for (const chain of chains.filter((entry) => entry.entries.length === 2)) {
      expect(chain.entries.map((entry) => entry.version)).toEqual([1, 2]);
      expect(chain.entries.map((entry) => entry.status)).toEqual(['SUPERSEDED', 'ACTIVE']);
    }
  });

  test('sibling artifacts of one kind form SEPARATE lineages (the three authority grants)', async () => {
    const read = await liveRead(w);
    const chains = projectRevisionChains({ artifacts: read.authority_grants, evidence: read.evidence, data_source: source });
    expect(chains).toHaveLength(3);
    expect(new Set(chains.map((chain) => chain.kind)).size).toBe(1);
    expect(new Set(chains.map((chain) => chain.lineage_root)).size).toBe(3);
  });
});

describe('the history workspace', () => {
  test('projects the timeline with per-revision what/why/evidence and deep links', async () => {
    const read = await liveRead(w);
    const artifacts = [
      ...read.missions,
      ...read.system_states,
      ...read.packages,
      ...read.memories,
      ...read.hypotheses,
      ...w.compositions,
      ...w.process_revisions,
    ];
    const vm = projectHistoryWorkspace({
      artifacts,
      evidence: read.evidence,
      data_source: source,
      rationale: chainFor(missionV2.envelope.id, allLinks(w)),
      evidence_refs: [],
      uncertainty: {
        uncertainty_class: 'UNQUANTIFIED' as const,
        statement: 'The timeline is a complete projection of the stored revision chains.',
      },
      authority,
      next_allowed_action: nextAction,
    });
    expect(vm.kinds_present).toContain('PackageComposition');
    expect(vm.kinds_present).toContain('MetaProcess');
    expect(vm.chains.every((chain) => chain.entries.every((entry) => entry.what_changed.length > 0 && entry.why.length > 0 && entry.href.startsWith('/history/revision/')))).toBe(true);
    const compositionChain = vm.chains.find((chain) => chain.kind === 'PackageComposition')!;
    expect(compositionChain.entries.map((entry) => entry.version)).toEqual([1, 2]);
  });

  test('revisionNoteOf picks the owner-shaped note (changes/purpose/notes)', () => {
    const pkg = w.packages[1]!;
    expect(revisionNoteOf(pkg)).toBe(pkg.content.changes);
    const process = w.process_revisions[2]!;
    expect(revisionNoteOf(process)).toBe(process.content.notes);
    const mission = w.base.missions[0]!;
    expect(revisionNoteOf(mission)).toBe(mission.content.purpose);
  });

  test('revisionHrefOf decomposes ids path-safely', () => {
    const id = w.packages[1]!.envelope.id;
    expect(revisionHrefOf(id)).toBe(`/history/revision/Package/${id.slice('sos://Package/'.length)}`);
  });
});

describe('the revision diff', () => {
  const next = {
    action_id: 'view-revision',
    kind: 'NAVIGATE' as const,
    label: 'Back to the timeline',
    description: 'Return to the revision timeline.',
    href: '/history',
    rationale_ref: null,
    requires_authority: null,
  };

  function diffOf(fromId: string, toId: string, chain: readonly HistoryArtifactBearer[]) {
    const from = chain.find((entry) => entry.envelope.id === fromId)!;
    const to = chain.find((entry) => entry.envelope.id === toId)!;
    return projectRevisionDiff({
      from,
      to,
      chain,
      rationale: chainFor(toId, allLinks(w)),
      data_source: source,
      uncertainty: {
        uncertainty_class: 'UNQUANTIFIED',
        statement: 'The diff is a presentational comparison of the stored revisions.',
      },
      authority,
      next_allowed_action: next,
    });
  }

  test('the package v1 -> v2 diff shows the changed fields (composition participation + version note)', () => {
    const queueChain = w.packages.filter((pkg) => pkg.content.semantic_capability.includes('Durable'));
    const diff = diffOf(queueChain[0]!.envelope.id, queueChain[1]!.envelope.id, queueChain);
    const fields = diff.field_changes.map((change) => change.field);
    expect(fields).toContain('composition_refs');
    expect(fields).toContain('changes');
    expect(diff.status_change).toEqual({ from: 'SUPERSEDED', to: 'ACTIVE' });
    expect(diff.exact_restore_of).toBeNull();
  });

  test('the process trial -> restore diff detects the EXACT RESTORE of the parameters (byte-equal to v1)', () => {
    const processChain = w.process_revisions;
    const diff = diffOf(w.process_revisions[1]!.envelope.id, w.process_revisions[2]!.envelope.id, processChain);
    const fields = diff.field_changes.map((change) => change.field);
    expect(fields).toContain('parameters');
    expect(fields).toContain('notes');
    const parametersChange = diff.field_changes.find((change) => change.field === 'parameters')!;
    expect(parametersChange.restored_from).not.toBeNull();
    expect(parametersChange.restored_from!.version).toBe(1);
    expect(diff.what_changed).toContain('restored byte-equal');
  });

  test('diffs are only between consecutive revisions (identity + supersedes checks)', () => {
    const queueChain = w.packages.filter((pkg) => pkg.content.semantic_capability.includes('Durable'));
    expect(() =>
      diffOf(queueChain[1]!.envelope.id, queueChain[0]!.envelope.id, queueChain),
    ).toThrow(/consecutive/);
  });

  test('the composition v1 -> v2 diff shows the OWN evidence arriving with the maturity step', () => {
    const diff = diffOf(w.compositions[0]!.envelope.id, w.compositions[1]!.envelope.id, w.compositions);
    const fields = diff.field_changes.map((change) => change.field);
    expect(fields).toContain('evidence_refs');
    expect(fields).toContain('maturity');
    expect(fields).toContain('independence');
  });
});
