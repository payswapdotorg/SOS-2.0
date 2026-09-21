/**
 * ADVERSARIAL CLASS 1 — STALE SYSTEM STATE (revision mismatch detected).
 *
 * The fault: a candidate is evaluated against a System State revision that
 * has been superseded (the subject moved on). The system must DETECT the
 * mismatch with typed rejection records — never silently evaluate against
 * stale state — and the trace chain stays queryable afterward.
 */

import { describe, expect, test } from 'vitest';
import { createSystemState, createSystemStateStore } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { createCandidateState } from '@sos-2/experiments';
import { evaluatePromotion } from '@sos-2/promotion';
import { createTraceLink, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { evaluateFreshness } from '@sos-2/evidence';
import { ADVERSARIAL_ANCHOR, ADVERSARIAL_PROVENANCE, T0, T1, T2, assertTraceQueryable, makeEvidence, promoteGrant, subjectId, toolProducer } from './helpers.js';

function systemState(version: number): SystemStateArtifact {
  return createSystemState({
    content: {
      architecture_ref: { artifact_id: subjectId('ArchitectureGraph', `adversarial-1-arch-v${version}`), version },
      implementation: [
        {
          artifact_id: subjectId('ImplementationModel', 'adversarial-1-model'),
          revision: { kind: 'git-sha', value: '31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2' },
        },
      ],
      configuration: [{ config_id: 'adversarial-1-config', revision: { kind: 'config-version', value: `v${version}` } }],
      deployment: [
        {
          deployment_id: `deploy:adversarial-1-${version}`,
          environment: 'production',
          revision: { kind: 'deployment-id', value: `dpl_adv1_${version}` },
        },
      ],
      policy: [{ policy_id: 'adversarial-1-policy', version: 1 }],
      environment_relationships: [],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:1:stale-system-state'],
    created_at: version === 1 ? T0 : T1,
    authority_ref: ADVERSARIAL_ANCHOR,
    status: 'ACTIVE',
    version,
  });
}

describe('adversarial class 1: stale System State', () => {
  test('the store itself detects the superseded revision (isLatest/history/latest)', () => {
    const root = systemState(1);
    const store = createSystemStateStore([root]);
    const { supersededBy } = store.supersede(root.envelope.id, {
      content: systemState(2).content,
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:1:supersede'],
      created_at: T1,
    });
    expect(supersededBy.envelope.version).toBe(2);
    // The root revision is now STALE: no longer latest, still queryable.
    expect(store.isLatest(root.envelope.id)).toBe(false);
    expect(store.latest(root.envelope.id)!.envelope.version).toBe(2);
    expect(store.history(root.envelope.id).map((entry) => entry.envelope.version)).toEqual([1, 2]);
  });

  test('the promotion gate REJECTS a candidate bound to the superseded revision (typed record)', () => {
    const root = systemState(1);
    const store = createSystemStateStore([root]);
    store.supersede(root.envelope.id, {
      content: systemState(2).content,
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:1:supersede'],
      created_at: T1,
    });
    const currentRevision = `${store.latest(root.envelope.id)!.envelope.id}@v2`;

    // The candidate was measured against the STALE revision r1.
    const staleRevisionToken = `${root.envelope.id}@v1`;
    const candidate = createCandidateState({
      content: {
        invariants: ['the storage p99 budget holds'],
        predicted_effects: ['storage p99 latency falls'],
        causal_claim: true,
        confidence: null,
        base_subject_revision: staleRevisionToken,
        hypothesis_ref: subjectId('CausalHypothesis', 'adversarial-1-hypothesis'),
        bounded_subgraph_ref: null,
        context: { environment: 'production' },
      },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:1:candidate'],
      created_at: T1,
      authority_ref: ADVERSARIAL_ANCHOR,
    });

    const evaluation = evaluatePromotion(candidate, {
      authority: { grant: promoteGrant('CandidateState'), now: T2 },
      assurance: null,
      evidence: [],
      systemState: { revision: currentRevision },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:1:promotion-gate'],
      created_at: T2,
    });

    // DETECTED: the gate refuses to promote against a stale subject revision.
    expect(evaluation.gates.systemState).not.toBeNull();
    expect(evaluation.gates.systemState!.compatible).toBe(false);
    expect(evaluation.gates.systemState!.reasons.length).toBeGreaterThan(0);
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.record.content.action).toBe('REJECT');
    expect(evaluation.record.content.reasons.join(' ')).toContain('revision');
  });

  test('evidence bound to the superseded subject revision is classified SUPERSEDED (not fresh)', () => {
    const record = makeEvidence(subjectId('SystemState', 'adversarial-1-state'), {
      subject_revision: 'system-state:r1',
    });
    const evaluation = evaluateFreshness(record, { now: T2, systemStateRevision: 'system-state:r2' });
    expect(evaluation.status).toBe('SUPERSEDED_SUBJECT_REVISION');
    expect(evaluation.reason).toContain('superseded');
  });

  test('the trace chain stays queryable after the stale-revision rejection', () => {
    const candidate = createCandidateState({
      content: {
        invariants: ['i'],
        predicted_effects: [],
        causal_claim: false,
        confidence: null,
        base_subject_revision: 'system-state:r1',
        hypothesis_ref: null,
        bounded_subgraph_ref: null,
        context: { environment: 'production' },
      },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:1:candidate-2'],
      created_at: T1,
    });
    const stateId = subjectId('SystemState', 'adversarial-1-state-2');
    const links = [
      createTraceLink({
        source: candidate.envelope.id,
        target: stateId,
        type: 'REFINES',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:1:candidate-refines-state'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryFrom(candidate.envelope.id).length).toBe(1);
    expect(queryTo(stateId).length).toBe(1);
    expect(queryTo(stateId)[0]!.type).toBe('REFINES');
  });
});
