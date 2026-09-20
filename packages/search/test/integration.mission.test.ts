/**
 * Integration test: the typed hard-constraint set is CONSUMED from the
 * mission/value models' exported types — REAL @sos-2/mission
 * MissionConstraint objects satisfy the duck-typed HardConstraintView
 * DIRECTLY (the same integration pattern @sos-2/value established; no
 * sibling packages were modified).
 */

import { describe, expect, it } from 'vitest';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { createLadderSearchEngine, filterByHardConstraints, hardConstraintsFromMission } from '../src/index.js';
import type { SearchCandidate } from '../src/index.js';
import { buildSearchFixture, fixedGenerator, generatedCandidate } from './helpers.js';

function realMission(): MissionArtifact {
  return createMission({
    content: {
      purpose: 'Deliver fast, cheap image resizing.',
      goals: [{ id: 'resize-goal', statement: 'Resize images under 100ms p99', status: 'PROPOSED', measures: [] }],
      outcomes: [],
      stakeholders: [{ id: 'users', name: 'End users', interest: 'fast images' }],
      measures: [{ id: 'resize-p99', description: 'p99 resize latency', target: '<100ms', unit: 'ms' }],
      assumptions: [],
      ambiguities: [],
      constraints: [
        {
          id: 'cost-ceiling',
          statement: 'Monthly infra cost must not exceed 600.',
          hard: true,
          bound: { axis: 'monthly-cost', direction: 'MAX', limit: 600 },
        },
        {
          id: 'latency-slo',
          statement: 'p99 latency must stay under 100ms.',
          hard: true,
          bound: { axis: 'p99-latency', direction: 'MAX', limit: 100 },
        },
        {
          id: 'privacy-preference',
          statement: 'Prefer privacy-local deployments.',
          hard: false,
          bound: null,
        },
        {
          id: 'sovereignty',
          statement: 'Data must not leave the EU.',
          hard: true,
          bound: null,
        },
      ],
    },
    provenance: ['w7:search-test:mission-integration'],
    created_at: '2025-01-01T00:00:00.000Z',
    status: 'ACTIVE',
  });
}

describe('mission integration (typed constraints consumed from @sos-2/mission)', () => {
  it('REAL MissionConstraint objects satisfy the duck-typed HardConstraintView directly', () => {
    const mission = realMission();
    const set = hardConstraintsFromMission({
      artifact_id: mission.envelope.id,
      constraints: mission.content.constraints,
    });
    // Soft constraints are excluded; bounded hard constraints are machine-checkable.
    expect(set.source).toBe(mission.envelope.id);
    expect(set.constraints.map((constraint) => constraint.id)).toEqual(['cost-ceiling', 'latency-slo', 'sovereignty']);
    expect(set.machine_checkable.map((constraint) => constraint.id)).toEqual(['cost-ceiling', 'latency-slo']);
  });

  it('real mission constraints filter search candidates BEFORE evaluation (the golden path)', () => {
    const mission = realMission();
    const set = hardConstraintsFromMission({
      artifact_id: mission.envelope.id,
      constraints: mission.content.constraints,
    });
    const candidates: SearchCandidate[] = [
      {
        ...generatedCandidate({ seed: 'cheap-fast', altitude: 'ARCHITECTURE_PATTERN', family: 'sharded-queue' }),
        estimates: { 'monthly-cost': 450, 'p99-latency': 80 },
      },
      {
        ...generatedCandidate({ seed: 'expensive', altitude: 'ARCHITECTURE_PATTERN', family: 'premium-gpu' }),
        estimates: { 'monthly-cost': 900, 'p99-latency': 40 },
      },
      {
        ...generatedCandidate({ seed: 'slow', altitude: 'ARCHITECTURE_PATTERN', family: 'batch-queue' }),
        estimates: { 'monthly-cost': 300, 'p99-latency': 250 },
      },
    ];
    const { survivors, rejected } = filterByHardConstraints(candidates, set);
    expect(survivors.map((entry) => entry.candidate.family)).toEqual(['sharded-queue']);
    expect(rejected.map((entry) => entry.candidate.family).sort()).toEqual(['batch-queue', 'premium-gpu']);
    // The unbounded hard constraint (sovereignty) is carried but cannot
    // machine-filter — it appears in no check (recorded as prose).
    expect(set.constraints.some((constraint) => constraint.bound === null)).toBe(true);
    for (const entry of [...survivors, ...rejected]) {
      expect(entry.report.checks.every((check) => check.axis !== undefined)).toBe(true);
    }
  });

  it('the ladder engine consumes the real mission constraint set end-to-end', () => {
    const mission = realMission();
    const set = hardConstraintsFromMission({
      artifact_id: mission.envelope.id,
      constraints: mission.content.constraints,
    });
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({
      facade: fixture.facade,
      patternSource: fixedGenerator([
        // Violates the mission latency SLO (250ms > 100ms).
        { ...generatedCandidate({ seed: 'too-slow', altitude: 'ARCHITECTURE_PATTERN', family: 'sharded-queue' }), estimates: { 'monthly-cost': 450, 'p99-latency': 250 } },
      ]),
      synthesisSource: fixedGenerator([
        // Violates the mission cost ceiling (9999 > 600).
        { ...generatedCandidate({ seed: 'costly', altitude: 'LOW_LEVEL_SYNTHESIS', family: 'hand-rolled' }), estimates: { 'monthly-cost': 9999 } },
      ]),
    });
    // The registry rungs have no estimates for these axes (UNCHECKED — they
    // survive), so the search stays at VALIDATED_COMPOSITION (the §10 stop
    // discipline); the mission's bounded constraints are reported per candidate.
    const result = engine.search({ capability: 'image-resize', constraints: set, policy: { kind: 'GREEDY' } });
    expect(result.final_altitude).toBe('VALIDATED_COMPOSITION');
    expect(result.candidates).toHaveLength(1);
    for (const entry of result.candidates) {
      expect(entry.constraint_report.checks).toHaveLength(2);
      expect(entry.constraint_report.checks.every((check) => check.verdict === 'UNCHECKED')).toBe(true);
      expect(entry.constraint_report.passes).toBe(true);
    }
    // And when generated candidates VIOLATE the mission constraints, the
    // ladder records every justified descent and ends honestly empty.
    const rejectedResult = engine.search({
      capability: 'video-transcode',
      constraints: set,
      policy: { kind: 'GREEDY' },
    });
    // video-transcode has no registry entries; the pattern candidate violates
    // the latency SLO and the synthesis candidate violates the cost ceiling —
    // every rung is exhausted, the trace is complete and justified.
    expect(rejectedResult.final_altitude).toBeNull();
    expect(rejectedResult.candidates).toEqual([]);
    expect(rejectedResult.ladder).toHaveLength(6);
    expect(rejectedResult.total_rejected).toBe(2);
    const patternStep = rejectedResult.ladder[3]!;
    expect(patternStep.altitude).toBe('ARCHITECTURE_PATTERN');
    expect(patternStep.outcome).toBe('ALL_REJECTED_BY_CONSTRAINTS');
    expect(patternStep.descent!.justification).toMatch(/rejected by hard constraints/);
    const synthesisStep = rejectedResult.ladder[5]!;
    expect(synthesisStep.altitude).toBe('LOW_LEVEL_SYNTHESIS');
    expect(synthesisStep.outcome).toBe('ALL_REJECTED_BY_CONSTRAINTS');
    expect(synthesisStep.descent).toBeUndefined();
  });
});
