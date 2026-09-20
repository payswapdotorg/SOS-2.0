/**
 * STAGE 1 — Mission formalization (Work Order W14).
 *
 * Raw mission input -> formalized Mission artifact via @sos-2/mission
 * (the W1 authority — never duplicated here). The formalization is the
 * deterministic progressive-formalization projection (R2):
 *
 *   - a goal referencing >= 1 existing measure is formalized MEASURABLE;
 *   - a goal referencing none stays PROPOSED (informal, honestly).
 *
 * The stage also derives the capability search key (the mission's declared
 * semantic capability — validated in the context layer) that stage 2
 * searches the package ecology with. The mission artifact is a spine
 * Mission with a deterministic content-addressed id; identical input
 * reproduces the identical mission (byte-identical across runs).
 */

import { createMission } from '@sos-2/mission';
import type { MissionArtifact, MissionContent, MissionGoalStatus } from '@sos-2/mission';
import type { TraceLink } from '@sos-2/semantic-spine';
import type { GreenfieldMissionInput, GreenfieldRunContext } from '../context.js';
import { GreenfieldError } from '../errors.js';

/** The typed stage record of mission formalization (plain JSON, spine-traceable). */
export interface MissionStageRecord {
  stage: 'MISSION_FORMALIZATION';
  /** The formalized Mission artifact (kind Mission, ACTIVE, deterministic id). */
  mission: MissionArtifact;
  /** The formalization decisions (goal -> status), in mission order. */
  formalization: { goal_id: string; status: MissionGoalStatus; measures: string[] }[];
  /** The derived capability search key (consumed by stage 2). */
  capability: string;
  /** The mission's required contracts (consumed by stage 2). */
  contracts: string[];
  /**
   * The stage's trace links. The mission is the AUTHORITY ROOT of the
   * greenfield chain (no artifact precedes it), so this stage mints no
   * links — it IS the chain's origin; every later handoff links INTO it.
   */
  links: TraceLink[];
}

export interface MissionStageInput {
  mission_input: GreenfieldMissionInput;
  run: GreenfieldRunContext;
}

/**
 * Run the mission formalization stage. Deterministic and pure: the mission
 * id is content-addressed over the creation address (provenance, instants,
 * content), so the same input + run context reproduce the same artifact.
 */
export function runMissionStage(input: MissionStageInput): MissionStageRecord {
  const { mission_input, run } = input;

  const content: MissionContent = {
    purpose: mission_input.purpose,
    goals: mission_input.goals.map((goal) => ({
      id: goal.id,
      statement: goal.statement,
      status: goal.measures.length > 0 ? 'MEASURABLE' : 'PROPOSED',
      measures: [...goal.measures],
    })),
    outcomes: mission_input.outcomes?.map((outcome) => ({ ...outcome, goal_refs: [...outcome.goal_refs] })) ?? [],
    stakeholders: mission_input.stakeholders?.map((stakeholder) => ({ ...stakeholder })) ?? [],
    measures: mission_input.measures.map((measure) => ({
      id: measure.id,
      description: measure.description,
      target: measure.target,
      unit: measure.unit,
    })),
    assumptions: mission_input.assumptions?.map((assumption) => ({ ...assumption })) ?? [],
    ambiguities: mission_input.ambiguities?.map((ambiguity) => ({ ...ambiguity })) ?? [],
    constraints: mission_input.constraints.map((constraint) => structuredClone(constraint)),
  };

  let mission: MissionArtifact;
  try {
    mission = createMission({
      content,
      provenance: [...run.provenance, 'W14:greenfield:mission-formalization'],
      created_at: run.t_mission,
      status: 'ACTIVE',
      authority_ref: null,
    });
  } catch (cause) {
    throw new GreenfieldError(
      `mission formalization failed against the W1 mission contract: ${(cause as Error).message}`,
      { cause },
    );
  }

  const formalization = mission.content.goals.map((goal) => ({
    goal_id: goal.id,
    status: goal.status,
    measures: [...goal.measures],
  }));
  const measurable = formalization.filter((entry) => entry.status === 'MEASURABLE').length;
  const proposed = formalization.length - measurable;
  if (measurable + proposed !== mission.content.goals.length) {
    throw new GreenfieldError('internal invariant: formalization decisions do not cover every goal');
  }

  return {
    stage: 'MISSION_FORMALIZATION',
    mission,
    formalization,
    capability: mission_input.capability,
    contracts: [...mission_input.contracts],
    links: [],
  };
}
