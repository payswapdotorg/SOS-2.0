/**
 * The Overview hero projections (the dominant surface,
 * docs/ux/sharenet-inspired-design.md "Overview / Hero"): mission outcome
 * health, current system condition, current shortfall/opportunity, and the
 * next allowed action.
 *
 * Presentation classifications (outcome health, system condition) are
 * documented, deterministic DISPLAY rules — they are not domain verdicts;
 * the domain vocabulary they summarize (goal statuses, evidence truth
 * states, exact revisions) is always carried verbatim alongside, with the
 * basis exposed. All vocabularies are imported from the owning packages.
 */

import type { MissionArtifact } from '@sos-2/mission';
import type { MissionGoalStatus } from '@sos-2/mission';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { UncertaintyClass } from '@sos-2/evidence';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { RationaleChain } from '@sos-2/ui-contracts';
import type { DataSource } from './data-source.js';
import { WebContractError } from './errors.js';
import type { NextActionView } from './next-action.js';
import type { ActionAvailability } from './next-action.js';
import { buildStateBlock } from './state-block.js';
import type { ProductCondition } from './state-block.js';
import type { ProductVmCore } from './vm-core.js';

// ---------------------------------------------------------------------------
// Gap records (shortfall / opportunity) — view-level fixture records
// ---------------------------------------------------------------------------

/**
 * A shortfall or opportunity record. These are VIEW-LEVEL product records:
 * the live reconciliation that will produce them durably belongs to the
 * execution-fabric Work Orders; until then the console consumes clearly
 * labelled fixture records that reference REAL spine ids (the mission goal,
 * the measure, the evidence) — nothing about the referenced artifacts is
 * invented here.
 */
export interface DemoGapRecord {
  record_id: string;
  kind: 'SHORTFALL' | 'OPPORTUNITY';
  /** The presentation condition this gap warrants (authored fixture classification). */
  condition: ProductCondition;
  statement: string;
  /** The mission goal id this gap is about (local id within the mission). */
  goal_ref: string;
  /** The measure id this gap is measured by, or null. */
  measure_ref: string | null;
  /** Spine Evidence ids supporting the gap statement. */
  evidence_refs: string[];
  uncertainty_class: UncertaintyClass;
  uncertainty_statement: string;
}

// ---------------------------------------------------------------------------
// Mission hero
// ---------------------------------------------------------------------------

/** One goal with its measures, for the hero's goal list. */
export interface MissionGoalView {
  goal_id: string;
  statement: string;
  status: MissionGoalStatus;
  measures: { measure_id: string; description: string; target: string | null; unit: string | null }[];
}

/** The mission hero view model (mission outcome health). */
export interface MissionHeroVM {
  core: ProductVmCore;
  mission_id: string;
  purpose: string;
  /** The presentation classification of mission outcome health. */
  outcome_health: ProductCondition;
  /** Why the outcome health is what it is (the basis, always shown). */
  outcome_basis: string;
  goals: MissionGoalView[];
}

function missionGoalsOf(mission: MissionArtifact): MissionGoalView[] {
  const measuresById = new Map(mission.content.measures.map((measure) => [measure.id, measure]));
  return mission.content.goals.map((goal) => ({
    goal_id: goal.id,
    statement: goal.statement,
    status: goal.status,
    measures: goal.measures
      .map((measureId) => measuresById.get(measureId))
      .filter((measure): measure is NonNullable<typeof measure> => measure !== undefined)
      .map((measure) => ({
        measure_id: measure.id,
        description: measure.description,
        target: measure.target,
        unit: measure.unit,
      })),
  }));
}

/**
 * The documented outcome-health display rule (deterministic):
 *   - a BLOCKED shortfall wins over everything;
 *   - otherwise any DEGRADED shortfall -> DEGRADED (attention);
 *   - otherwise, if every goal is ACHIEVED -> HEALTHY;
 *   - otherwise, if the mission has goals and supporting evidence -> HEALTHY
 *     (on track);
 *   - a mission with no goals yet -> INACTIVE (nothing formalized).
 * OPPORTUNITY records never degrade outcome health (they are upside, not
 * problems) — they are displayed on their own surface.
 */
export function classifyMissionOutcomeHealth(
  mission: MissionArtifact,
  gaps: readonly DemoGapRecord[],
): { condition: ProductCondition; basis: string } {
  const blocked = gaps.filter((gap) => gap.kind === 'SHORTFALL' && gap.condition === 'BLOCKED');
  const degraded = gaps.filter((gap) => gap.kind === 'SHORTFALL' && gap.condition === 'DEGRADED');
  if (blocked.length > 0) {
    return {
      condition: 'BLOCKED',
      basis: blocked.map((gap) => gap.statement).join(' '),
    };
  }
  if (degraded.length > 0) {
    return {
      condition: 'DEGRADED',
      basis: degraded.map((gap) => gap.statement).join(' '),
    };
  }
  const goals = mission.content.goals;
  if (goals.length === 0) {
    return {
      condition: 'INACTIVE',
      basis: 'The mission is anchored by its purpose; no goals have been formalized yet.',
    };
  }
  if (goals.every((goal) => goal.status === 'ACHIEVED')) {
    return {
      condition: 'HEALTHY',
      basis: 'Every formalized goal is achieved.',
    };
  }
  return {
    condition: 'HEALTHY',
    basis: 'Formalized goals are on track; no shortfall is currently known.',
  };
}

/** Project the mission hero (deterministic, total). */
export function projectMissionHero(input: {
  mission: MissionArtifact;
  gaps: readonly DemoGapRecord[];
  rationale: RationaleChain;
  data_source: DataSource;
  evidence_refs: readonly string[];
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): MissionHeroVM {
  if (input.rationale.subject_id !== input.mission.envelope.id) {
    throw new WebContractError('the mission hero rationale must bind the mission id');
  }
  const health = classifyMissionOutcomeHealth(input.mission, input.gaps);
  return {
    core: {
      subject_id: input.mission.envelope.id,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: [...new Set(input.evidence_refs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    mission_id: input.mission.envelope.id,
    purpose: input.mission.content.purpose,
    outcome_health: health.condition,
    outcome_basis: health.basis,
    goals: missionGoalsOf(input.mission),
  };
}

// ---------------------------------------------------------------------------
// System condition
// ---------------------------------------------------------------------------

/** One implementation/deployment reference with its exact revision. */
export interface SystemRefView {
  kind: 'IMPLEMENTATION' | 'DEPLOYMENT' | 'CONFIGURATION' | 'POLICY';
  id: string;
  revision: string;
  environment?: string;
}

/** The system condition view model. */
export interface SystemConditionVM {
  core: ProductVmCore;
  system_state_id: string;
  system_state_version: number;
  /** The presentation classification of the current system condition. */
  condition: ProductCondition;
  /** Why (the basis, always shown, per distinct truth state). */
  condition_basis: string;
  refs: SystemRefView[];
  active_experiment_refs: string[];
  /** Observation coverage across the surfaces the system is known by. */
  coverage_block: ReturnType<typeof buildStateBlock> | null;
}

/**
 * The documented system-condition display rule (deterministic), over the
 * evidence records about the CURRENT system state (subject is the current
 * system state artifact, or the implementation model it references):
 *   - any FAILURE -> BLOCKED;
 *   - otherwise any PARTIAL -> DEGRADED (attention);
 *   - otherwise only SUCCESS -> HEALTHY;
 *   - no evidence about the current system at all -> UNKNOWN.
 * UNAVAILABLE/UNKNOWN evidence is observation coverage, not system health:
 * it is reported in the coverage block with the distinct epistemic
 * treatment and never folded into the condition.
 */
export function classifySystemCondition(
  currentEvidence: readonly EvidenceRecordW3[],
): { condition: ProductCondition; basis: string } {
  const states = currentEvidence.map((record) => record.availability);
  if (states.length === 0) {
    return {
      condition: 'UNKNOWN',
      basis: 'No evidence has been observed about the current system state yet.',
    };
  }
  if (states.includes('FAILURE')) {
    return {
      condition: 'BLOCKED',
      basis: 'Failure evidence has been observed against the current system state.',
    };
  }
  if (states.includes('PARTIAL')) {
    return {
      condition: 'DEGRADED',
      basis: 'The system is up; some measurements are only partially available against their targets.',
    };
  }
  if (states.every((state) => state === 'SUCCESS')) {
    return {
      condition: 'HEALTHY',
      basis: 'Observed evidence about the current system state is successful.',
    };
  }
  return {
    condition: 'HEALTHY',
    basis: 'Observed evidence about the current system state is successful; some observation sources are not reachable (see coverage).',
  };
}

/** Project the system condition (deterministic, total). */
export function projectSystemCondition(input: {
  system_state: SystemStateArtifact;
  /** Evidence about the current system state (subject = the state or its implementation refs). */
  current_evidence: readonly EvidenceRecordW3[];
  /** Names of the observation surfaces that are present / missing (coverage). */
  coverage: { present: readonly string[]; missing: readonly string[] };
  rationale: RationaleChain;
  data_source: DataSource;
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): SystemConditionVM {
  if (input.rationale.subject_id !== input.system_state.envelope.id) {
    throw new WebContractError('the system condition rationale must bind the system state id');
  }
  const condition = classifySystemCondition(input.current_evidence);
  const refs: SystemRefView[] = [
    ...input.system_state.content.implementation.map((reference) => ({
      kind: 'IMPLEMENTATION' as const,
      id: reference.artifact_id,
      revision: reference.revision.value,
    })),
    ...input.system_state.content.deployment.map((reference) => ({
      kind: 'DEPLOYMENT' as const,
      id: reference.deployment_id,
      revision: reference.revision.value,
      environment: reference.environment,
    })),
    ...input.system_state.content.configuration.map((reference) => ({
      kind: 'CONFIGURATION' as const,
      id: reference.config_id,
      revision: reference.revision.value,
    })),
    ...input.system_state.content.policy.map((reference) => ({
      kind: 'POLICY' as const,
      id: reference.policy_id,
      revision: `v${String(reference.version)}`,
    })),
  ];
  const coverage_block =
    input.coverage.missing.length > 0 && input.coverage.present.length > 0
      ? buildStateBlock({
          kind: 'PARTIAL',
          surface: 'system-observation-coverage',
          statement: 'Observation covers most surfaces; some sources are not reachable right now.',
          present: input.coverage.present,
          missing: input.coverage.missing,
          action: 'The unreachable sources are listed; no value is fabricated for them.',
        })
      : null;
  const evidenceRefs = input.current_evidence.map((record) => record.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    core: {
      subject_id: input.system_state.envelope.id,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: evidenceRefs,
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    system_state_id: input.system_state.envelope.id,
    system_state_version: input.system_state.envelope.version,
    condition: condition.condition,
    condition_basis: condition.basis,
    refs,
    active_experiment_refs: input.system_state.content.active_experiments.map((reference) => reference.experiment_id),
    coverage_block,
  };
}

// ---------------------------------------------------------------------------
// Shortfall / opportunity
// ---------------------------------------------------------------------------

/** The current shortfall-or-opportunity view model. */
export interface ShortfallOpportunityVM {
  core: ProductVmCore;
  kind: 'SHORTFALL' | 'OPPORTUNITY';
  statement: string;
  goal_ref: string;
  goal_statement: string;
  measure_ref: string | null;
  measure_description: string | null;
  measure_target: string | null;
}

/** Project one gap record onto the shortfall/opportunity view model. */
export function projectShortfallOpportunity(input: {
  gap: DemoGapRecord;
  mission: MissionArtifact;
  rationale: RationaleChain;
  data_source: DataSource;
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): ShortfallOpportunityVM {
  if (input.rationale.subject_id !== input.mission.envelope.id) {
    throw new WebContractError('the shortfall/opportunity rationale binds the mission that defines the gap');
  }
  const goal = input.mission.content.goals.find((entry) => entry.id === input.gap.goal_ref);
  if (!goal) {
    throw new WebContractError(
      `gap record ${JSON.stringify(input.gap.record_id)} references unknown mission goal ${JSON.stringify(input.gap.goal_ref)}`,
    );
  }
  const measure = input.gap.measure_ref
    ? input.mission.content.measures.find((entry) => entry.id === input.gap.measure_ref) ?? null
    : null;
  return {
    core: {
      subject_id: input.mission.envelope.id,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: [...new Set(input.gap.evidence_refs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      uncertainty: {
        uncertainty_class: input.gap.uncertainty_class,
        statement: input.gap.uncertainty_statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    kind: input.gap.kind,
    statement: input.gap.statement,
    goal_ref: goal.id,
    goal_statement: goal.statement,
    measure_ref: measure?.id ?? null,
    measure_description: measure?.description ?? null,
    measure_target: measure?.target ?? null,
  };
}

/** Pick the CURRENT gap (deterministic priority: SHORTFALL before OPPORTUNITY, then record id). */
export function currentGapOf(gaps: readonly DemoGapRecord[]): DemoGapRecord | null {
  if (gaps.length === 0) {
    return null;
  }
  const sorted = [...gaps].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'SHORTFALL' ? -1 : 1;
    }
    return a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0;
  });
  return sorted[0] ?? null;
}

// ---------------------------------------------------------------------------
// Next allowed action
// ---------------------------------------------------------------------------

/** The hero's next allowed action, with its gated availability. */
export interface NextAllowedActionVM {
  core: ProductVmCore;
  action: NextActionView;
  availability: ActionAvailability;
  /** Why this action is the NEXT one (the priority reason, always shown). */
  priority_reason: string;
}

/** Project the next allowed action (deterministic, total). */
export function projectNextAllowedAction(input: {
  subject_id: string;
  action: NextActionView;
  availability: ActionAvailability;
  priority_reason: string;
  rationale: RationaleChain;
  data_source: DataSource;
  evidence_refs: readonly string[];
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
}): NextAllowedActionVM {
  return {
    core: {
      subject_id: input.subject_id,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: [...new Set(input.evidence_refs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.action,
    },
    action: input.action,
    availability: input.availability,
    priority_reason: input.priority_reason,
  };
}
