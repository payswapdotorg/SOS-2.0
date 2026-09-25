/**
 * LANE C, NEGATIVE CASE 01 — STALE STATE (the Work Order's full list,
 * the W17 discipline at the product surface).
 *
 * The fault: state/evidence pinned to a revision that has been
 * superseded. The system must DETECT the mismatch with typed records
 * (never silently evaluate against stale state), the stale revision
 * must stay queryable (history retained), and the trace chain stays
 * queryable afterward. Never a silent pass, never a crash.
 */

import { describe, expect, test } from 'vitest';
import { createSystemState, createSystemStateStore } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { createCandidateState } from '@sos-2/experiments';
import { evaluatePromotion } from '@sos-2/promotion';
import { createTraceLink } from '@sos-2/semantic-spine';
import { evaluateFreshness } from '@sos-2/evidence';
import { LANE_ANCHOR, LANE_PROVENANCE, T0, T1, T2, assertTraceQueryable, makeEvidence, promoteGrant, subjectId, toolProducer } from './helpers.js';

function systemState(version: number): SystemStateArtifact {
  return createSystemState({
    content: {
      architecture_ref: { artifact_id: subjectId('ArchitectureGraph', `p15c-01-arch-v${version}`), version },
      implementation: [
        {
          artifact_id: subjectId('ImplementationModel', 'p15c-01-model'),
          revision: { kind: 'git-sha', value: '31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2' },
        },
      ],
      configuration: [{ config_id: 'p15c-01-config', revision: { kind: 'config-version', value: `v${version}` } }],
      deployment: [
        {
          deployment_id: `deploy:p15c-01-${version}`,
          environment: 'production',
          revision: { kind: 'deployment-id', value: `dpl_p15c_01_${version}` },
        },
      ],
      policy: [{ policy_id: 'p15c-01-policy', version: 1 }],
      environment_relationships: [],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: [...LANE_PROVENANCE, 'p15c-01:stale-system-state'],
    created_at: version === 1 ? T0 : T1,
    authority_ref: LANE_ANCHOR,
    status: 'ACTIVE',
    version,
  });
}

describe('P15 lane C negative case: stale state', () => {
  test('DETECTED: the store marks the superseded revision not-latest while keeping it queryable', () => {
    const root = systemState(1);
    const store = createSystemStateStore([root]);
    const { supersededBy } = store.supersede(root.envelope.id, {
      content: systemState(2).content,
      provenance: [...LANE_PROVENANCE, 'p15c-01:supersede'],
      created_at: T1,
    });
    // The typed detection: v1 is no longer latest; v2 is; BOTH stay queryable.
    expect(supersededBy.envelope.version).toBe(2);
    expect(store.isLatest(root.envelope.id)).toBe(false);
    expect(store.latest(root.envelope.id)!.envelope.version).toBe(2);
    expect(store.history(root.envelope.id).map((entry) => entry.envelope.version)).toEqual([1, 2]);
  });

  test('CONTAINED: the promotion gate REJECTS a candidate bound to the superseded revision (typed record, never a silent pass)', () => {
    const root = systemState(1);
    const store = createSystemStateStore([root]);
    store.supersede(root.envelope.id, {
      content: systemState(2).content,
      provenance: [...LANE_PROVENANCE, 'p15c-01:supersede'],
      created_at: T1,
    });
    const currentRevision = `${store.latest(root.envelope.id)!.envelope.id}@v2`;

    // The candidate was measured against the STALE revision r1.
    const candidate = createCandidateState({
      content: {
        invariants: ['the storage p99 budget holds'],
        predicted_effects: ['storage p99 latency falls'],
        causal_claim: false,
        confidence: null,
        base_subject_revision: `${root.envelope.id}@v1`,
        hypothesis_ref: null,
        bounded_subgraph_ref: null,
        context: { environment: 'production' },
      },
      provenance: [...LANE_PROVENANCE, 'p15c-01:candidate'],
      created_at: T1,
      authority_ref: LANE_ANCHOR,
    });

    const evaluation = evaluatePromotion(candidate, {
      authority: { grant: promoteGrant('CandidateState'), now: T2 },
      assurance: null,
      evidence: [],
      systemState: { revision: currentRevision },
      provenance: [...LANE_PROVENANCE, 'p15c-01:promotion-gate'],
      created_at: T2,
    });

    // DETECTED + CONTAINED: the gate refuses to promote against stale state.
    expect(evaluation.gates.systemState).not.toBeNull();
    expect(evaluation.gates.systemState!.compatible).toBe(false);
    expect(evaluation.gates.systemState!.reasons.join(' ')).toContain('revision');
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.record.content.action).toBe('REJECT');
  });

  test('DETECTED: evidence bound to the superseded subject revision is classified SUPERSEDED (not fresh)', () => {
    const record = makeEvidence(subjectId('SystemState', 'p15c-01-state'), {
      subject_revision: 'system-state:r1',
    });
    const evaluation = evaluateFreshness(record, { now: T2, systemStateRevision: 'system-state:r2' });
    expect(evaluation.status).toBe('SUPERSEDED_SUBJECT_REVISION');
    expect(evaluation.reason).toContain('superseded');
  });

  test('the trace chain stays queryable after the stale-rejection (and the rejection record carries provenance)', () => {
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
      provenance: [...LANE_PROVENANCE, 'p15c-01:candidate-2'],
      created_at: T1,
      authority_ref: LANE_ANCHOR,
    });
    const stateId = subjectId('SystemState', 'p15c-01-state-2');
    const links = [
      createTraceLink({
        source: candidate.envelope.id,
        target: stateId,
        type: 'REFINES',
        provenance: [...LANE_PROVENANCE, 'p15c-01:candidate-refines-state'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryFrom(candidate.envelope.id).length).toBe(1);
    expect(queryTo(stateId).length).toBe(1);
    expect(queryTo(stateId)[0]!.type).toBe('REFINES');
    // The tool producer of the evidence trail is retained (provenance honesty).
    expect(toolProducer().tool).toBe('p15-accessibility-dogfood');
  });
});
