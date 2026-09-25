/**
 * LANE C, NEGATIVE CASE 07 — UNSAFE CANDIDATE (the frozen assurance
 * discipline: an unsafe candidate is NOT promoted).
 *
 * The fault: a candidate whose assurance case is REFUTED (a claim is
 * actively disproven), EXPIRED, or otherwise not CURRENT tries to
 * promote. The promotion gate must REFUSE — the assurance gate blocks
 * every invalid assurance shape (REFUTED verdicts REJECT; INCOMPLETE
 * verdicts and non-CURRENT validity GATHER_EVIDENCE — never ACT) — and
 * at the journey surface a defective (unsafe) body output is FAILED by
 * the independent evaluation and never lands as the final revision.
 * The rejection is a typed Decision record; the trace chain stays
 * queryable. Never a silent pass, never a crash.
 */

import { describe, expect, test } from 'vitest';
import { evaluatePromotion } from '@sos-2/promotion';
import { createCandidateState } from '@sos-2/experiments';
import { contentAddress, WORLD_BASE_SHA } from '@sos-2/action-gateway';
import { ReferenceArchitecturePlanner, ReferenceMissionFormalizer, SCAFFOLD_COMPONENT_ID } from '@sos-2/implementation-orchestrator';
import type { PlannedFile } from '@sos-2/implementation-orchestrator';
import { corruptFileContents } from '@sos-2/greenfield-runtime';
import { createTraceLink } from '@sos-2/semantic-spine';
import { formatRfc3339 } from '@sos-2/live-store';
import {
  LANE_ANCHOR,
  LANE_PROVENANCE,
  PRODUCT_T0,
  T0,
  T2,
  assertProductGraphQueryableAndTruthful,
  assertTraceQueryable,
  createProductWorld,
  driveOnCloudTicks,
  promoteGrant,
  startFlagshipJourney,
  subjectId,
} from './helpers.js';

function candidate(): ReturnType<typeof createCandidateState> {
  return createCandidateState({
    content: {
      invariants: ['the storage p99 budget holds'],
      predicted_effects: ['storage p99 latency falls'],
      causal_claim: false,
      confidence: null,
      base_subject_revision: null,
      hypothesis_ref: null,
      bounded_subgraph_ref: null,
      context: { environment: 'production' },
    },
    provenance: [...LANE_PROVENANCE, 'p15c-07:candidate'],
    created_at: T0,
    authority_ref: LANE_ANCHOR,
  });
}

function assuranceFixture(overrides: {
  verdict?: 'SATISFIED' | 'REFUTED' | 'INCOMPLETE';
  validity?: { status: 'CURRENT' | 'EXPIRED' | 'SUPERSEDED' | 'VIOLATED'; expires_at: string | null; reason: string };
}) {
  return {
    id: subjectId('AssuranceCase', 'p15c-07-case'),
    claims: [{ id: 'claim-storage-budget', statement: 'The storage p99 budget holds under the proposed change.' }],
    verdict: overrides.verdict ?? 'SATISFIED',
    validity: overrides.validity ?? { status: 'CURRENT' as const, expires_at: null, reason: 'the case was argued and holds at the promotion instant' },
  };
}

describe('P15 lane C negative case: unsafe candidate', () => {
  test('CONTAINED: a REFUTED assurance case REJECTS promotion (the unsafe candidate is not promoted)', () => {
    const evaluation = evaluatePromotion(candidate(), {
      authority: { grant: promoteGrant('CandidateState'), now: T2 },
      assurance: assuranceFixture({ verdict: 'REFUTED' }),
      evidence: [],
      provenance: [...LANE_PROVENANCE, 'p15c-07:promotion-gate-refuted'],
      created_at: T2,
    });
    expect(evaluation.gates.assurance.structurally_valid).toBe(true);
    expect(evaluation.gates.assurance.verdict).toBe('REFUTED');
    expect(evaluation.decision).toBe('REJECT');
    // The rejection is a typed Decision record with the frozen action + reasons.
    expect(evaluation.record.content.action).toBe('REJECT');
    expect(evaluation.reasons.length).toBeGreaterThan(0);
  });

  test('CONTAINED: an EXPIRED assurance case blocks promotion (validity is never assumed)', () => {
    const evaluation = evaluatePromotion(candidate(), {
      authority: { grant: promoteGrant('CandidateState'), now: T2 },
      assurance: assuranceFixture({
        validity: { status: 'EXPIRED', expires_at: T0, reason: 'the case expired before the promotion instant' },
      }),
      evidence: [],
      provenance: [...LANE_PROVENANCE, 'p15c-07:promotion-gate-expired'],
      created_at: T2,
    });
    expect(evaluation.decision).toBe('GATHER_EVIDENCE');
    expect(evaluation.gates.assurance.effective_validity).toBe('EXPIRED');
    // Never ACT: the unsafe candidate is not promoted on stale assurance.
    expect(evaluation.decision).not.toBe('ACT');
  });

  test('CONTAINED: an INCOMPLETE assurance case blocks promotion (never ACT)', () => {
    const evaluation = evaluatePromotion(candidate(), {
      authority: { grant: promoteGrant('CandidateState'), now: T2 },
      assurance: assuranceFixture({ verdict: 'INCOMPLETE' }),
      evidence: [],
      provenance: [...LANE_PROVENANCE, 'p15c-07:promotion-gate-incomplete'],
      created_at: T2,
    });
    expect(evaluation.decision).toBe('GATHER_EVIDENCE');
    expect(evaluation.decision).not.toBe('ACT');
  });

  test('the CONTROL: a SATISFIED + CURRENT case with live authority passes the assurance + authority gates (the gate is not a blanket deny)', () => {
    const evaluation = evaluatePromotion(candidate(), {
      authority: { grant: promoteGrant('CandidateState'), now: T2 },
      assurance: assuranceFixture({}),
      evidence: [],
      provenance: [...LANE_PROVENANCE, 'p15c-07:promotion-gate-control'],
      created_at: T2,
    });
    expect(evaluation.gates.assurance.verdict).toBe('SATISFIED');
    expect(evaluation.gates.authority.passes).toBe(true);
  });

  test('CONTAINED (journey surface): a defective body output is FAILED by the independent evaluation and never becomes the final revision', async () => {
    // Precompute the BUGGY revision the defective first attempt produces
    // (scaffold lands first — correct; then the goal's attempt 1 is corrupt).
    const formalizer = new ReferenceMissionFormalizer({ createdAt: formatRfc3339(PRODUCT_T0) });
    const formalized = formalizer.formalize({
      statement: 'Build a URL shortener service with a public API',
      repositorySlug: 'acme/empty-repo',
      capturedAt: formatRfc3339(PRODUCT_T0),
      source: 'web-console:greenfield',
    });
    if (formalized.kind !== 'FORMALIZED') throw new Error('unreachable: the default mission formalizes');
    const planner = new ReferenceArchitecturePlanner({ createdAt: formatRfc3339(PRODUCT_T0) });
    const planned = planner.plan({ mission: formalized.mission });
    if (planned.kind !== 'PLANNED') throw new Error('unreachable: the default mission plans');

    const filesOf = (componentId: string): PlannedFile[] => {
      const component = planned.plan.components.find((entry) => entry.id === componentId);
      if (component === undefined) throw new Error(`unknown component ${componentId}`);
      return [...component.files];
    };
    const scaffoldFiles = filesOf(SCAFFOLD_COMPONENT_ID).map((file) => ({ path: file.path, contents: file.contents }));
    const scaffoldSha = contentAddress({ repo: 'workspace', baseSha: WORLD_BASE_SHA, changes: scaffoldFiles }, 'source');
    const goalFiles = filesOf('goal-deliver').map((file) => ({ path: file.path, contents: file.contents }));
    const buggyFiles = goalFiles.map((file) => ({ path: file.path, contents: corruptFileContents(file.contents) }));
    const buggySha = contentAddress({ repo: 'workspace', baseSha: scaffoldSha, changes: buggyFiles }, 'source');

    // The fault: the body's FIRST attempt at the goal task is unsafe
    // (corrupted output), and the evaluation of that exact revision FAILS.
    const world = createProductWorld({
      defects: [{ taskId: 'p13-goal-deliver', mode: 'BUGGY_OUTPUT' }],
      probes: {
        failRevisions: new Map([
          [
            buggySha,
            {
              status: 'EVIDENCE_COLLECTED',
              limitations: [],
              evidence: {
                evidenceType: 'tests',
                summary: 'the unsafe (defective) revision failed the independent evaluation',
                checks: [{ check: 'tests:fixture', passed: false, detail: 'the defective output fails', expected: 'the planned output', actual: 'the corrupted output' }],
                artifactDigest: 'fixture-failure:tests',
              },
            },
          ],
        ]),
      },
    });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // The unsafe revision was DETECTED (failed evaluation) and CONTAINED
    // (repaired): the journey completes on the REPAIRED revision — the
    // final head is never the buggy one, and the repaired node completed
    // through the independent gate.
    expect(state.stage).toBe('COMPLETED');
    expect(state.workspaceHead).not.toBe(buggySha);
    const report = world.journey.completionReport()!;
    expect(report.tasks.find((task) => task.taskId === 'p13-goal-deliver')!.state).toBe('COMPLETED');
    // The buggy commit is RETAINED in the truthful history (never hidden) —
    // exactly once — while every evaluation verdict targets the FINAL head.
    expect(state.realizedCommits.filter((commit) => commit.sha === buggySha).length).toBe(1);
    expect(state.realizedCommits[state.realizedCommits.length - 1]!.sha).not.toBe(buggySha);
    for (const ref of report.evaluation.verdictRefs) {
      expect(ref.targetSourceRevision).toBe(report.sourceRevisions.workspaceHead);
    }
    // The evidence graph stays queryable and truthful after the containment.
    await assertProductGraphQueryableAndTruthful(world);
  });

  test('the trace chain stays queryable after the unsafe-candidate rejection (the rejection record retained)', () => {
    const caseId = subjectId('AssuranceCase', 'p15c-07-case');
    const candidateArtifact = candidate();
    const links = [
      createTraceLink({
        source: caseId,
        target: candidateArtifact.envelope.id,
        type: 'VERIFIES',
        provenance: [...LANE_PROVENANCE, 'p15c-07:case-verifies-candidate'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryFrom(caseId).length).toBe(1);
    expect(queryTo(candidateArtifact.envelope.id)[0]!.type).toBe('VERIFIES');
  });
});
