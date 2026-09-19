/**
 * Composed workflow: typed Value constraints subordinate to a REAL Mission.
 *
 * @sos-2/value has no runtime dependency on @sos-2/mission — the mission
 * surface is a structural view. This test uses REAL @sos-2/mission mission
 * artifacts and constraints to prove the subordination rule against actual
 * mission objects (test-only devDependency).
 */

import { describe, expect, it } from 'vitest';
import { createMission } from '@sos-2/mission';
import {
  MISSION_PREVAILS,
  createValueModel,
  outranks,
} from '../src/index.js';
import type { MissionView } from '../src/index.js';
import { PROVENANCE, T0, sampleValueContent } from './helpers.js';

const CONSTITUTION_ANCHOR_ID = 'sos://Constitution/9adb696728b256d62bc7f4e2c796a401'; // W0.5 golden fixture anchor

function realMission() {
  return createMission({
    content: {
      purpose: 'Make software continuously better over time while staying comprehensible.',
      goals: [],
      outcomes: [],
      stakeholders: [],
      measures: [],
      assumptions: [],
      ambiguities: [],
      constraints: [
        {
          id: 'cost-ceiling',
          statement: 'Monthly platform cost must stay within the approved envelope.',
          hard: true,
          bound: { axis: 'monthly-cost', direction: 'MAX', limit: 10000 },
        },
      ],
    },
    provenance: ['W1:test'],
    created_at: T0,
    authority_ref: CONSTITUTION_ANCHOR_ID,
    status: 'ACTIVE',
  });
}

function missionViewOf(mission: ReturnType<typeof realMission>): MissionView {
  return { artifact_id: mission.envelope.id, constraints: mission.content.constraints };
}

describe('composed workflow: value subordinate to a real mission', () => {
  it('a compatible value model constructs SUBORDINATE under the real mission', () => {
    const mission = realMission();
    const result = createValueModel({
      content: sampleValueContent(),
      provenance: PROVENANCE,
      created_at: T0,
      authority_ref: mission.envelope.id,
      mission: missionViewOf(mission),
    });
    expect(result.subordination.status).toBe('SUBORDINATE');
    expect(result.artifact.envelope.authority_ref).toBe(mission.envelope.id);
    expect(result.artifact.envelope.kind).toBe('ValueModel');
  });

  it('a value budget exceeding the real mission hard ceiling is REJECTED', () => {
    const mission = realMission();
    const content = sampleValueContent();
    content.budgets = [{ id: 'greedy-budget', resource: 'monthly-cost', limit: 25000, unit: 'USD' }];
    expect(() =>
      createValueModel({
        content,
        provenance: PROVENANCE,
        created_at: T0,
        mission: missionViewOf(mission),
      }),
    ).toThrow(/rejected at construction/);
    // and the mission's hard bound is untouched
    expect(mission.content.constraints[0]!.bound!.limit).toBe(10000);
  });

  it('FLAG policy links the value model to the real mission artifact with CONFLICTS_WITH', () => {
    const mission = realMission();
    const content = sampleValueContent();
    content.constraints = [
      { id: 'greedy-ceiling', type: 'BUDGET_LIMIT', statement: 'Up to 30000.', bound: { axis: 'monthly-cost', direction: 'MAX', limit: 30000 } },
    ];
    const result = createValueModel({
      content,
      provenance: PROVENANCE,
      created_at: T0,
      mission: missionViewOf(mission),
      policy: 'FLAG',
    });
    expect(result.conflict_links).toHaveLength(1);
    const link = result.conflict_links[0]!;
    expect(link.type).toBe('CONFLICTS_WITH');
    expect(link.source.startsWith('sos://ValueModel/')).toBe(true);
    expect(link.target).toBe(mission.envelope.id);
    expect(link.target.startsWith('sos://Mission/')).toBe(true);
    // the mission is untouched: value never outranks mission
    expect(mission.content.constraints[0]!.bound!.limit).toBe(10000);
    expect(outranks('MISSION', 'APPROVED_VALUE_COMMITMENT')).toBe(true);
    expect(MISSION_PREVAILS).toBe('MISSION_PREVAILS');
  });
});
