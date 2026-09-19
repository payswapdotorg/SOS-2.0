/**
 * Deterministic Mission-over-Value subordination.
 *
 * Realizes, as a machine-checked rule (spec/architecture.md §7), the frozen
 * authority ordering of §3 ("Constitution > Mission > approved Value
 * commitments > ...") and §18 ("Hard constraints outrank preferences"), plus
 * spec/architecture-lock.md "Value precedence" (frozen).
 *
 * RULE (deterministic, total, documented):
 *   A typed value constraint (or budget) CONFLICTS WITH a HARD mission
 *   constraint iff both carry bounds, the axes are EQUAL, the directions are
 *   EQUAL, and the value bound EXCEEDS what the mission permits:
 *     - direction MAX (at most): conflict iff value.limit > mission.limit
 *       (the value ceiling is looser than the mission ceiling);
 *     - direction MIN (at least): conflict iff value.limit < mission.limit
 *       (the value floor is lower than the mission floor).
 *   Same axis with DIFFERENT directions (a ceiling and a floor) never
 *   conflicts structurally: both can hold simultaneously; a cross-direction
 *   contradiction (mission MAX below mission MIN on the same axis) is a
 *   mission-content concern, not a value subordination concern.
 *   SOFT mission constraints (hard === false) never machine-veto value
 *   constraints: the brief and the lock scope deterministic rejection to
 *   HARD mission constraints; soft mission statements are preferences.
 *
 * POLICY at construction (see artifact.ts):
 *   - REJECT (default): any conflict throws ValueModelError — the value
 *     constraint is rejected at construction.
 *   - FLAG: construction succeeds, and the conflict is recorded as a
 *     CONFLICTS_WITH trace link (value model artifact -> mission artifact,
 *     one of the 17 frozen types) carrying per-conflict provenance.
 *   In BOTH policies the mission constraint stands: value can never outrank
 *   mission (asserted in tests; resolution is always MISSION_PREVAILS).
 */

import { createTraceLink } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { ValueModelError } from './errors.js';
import type { ValueModelContent } from './model.js';

/**
 * Structural view of a mission constraint as consumed by subordination.
 * Deliberately duck-typed (a structural subset of @sos-2/mission's
 * MissionConstraint) so @sos-2/value has NO runtime dependency on
 * @sos-2/mission — real mission constraint objects satisfy this shape
 * directly (proven in integration tests).
 */
export interface MissionConstraintView {
  id: string;
  statement: string;
  hard: boolean;
  bound: { axis: string; direction: 'MAX' | 'MIN'; limit: number } | null;
}

/** The mission surface value construction is checked against. */
export interface MissionView {
  /** The mission artifact id (trace-link target). */
  artifact_id: string;
  constraints: MissionConstraintView[];
}

export interface ValueMissionConflict {
  /** Which value element conflicts: 'constraint' | 'budget'. */
  value_element_kind: 'constraint' | 'budget';
  value_element_id: string;
  mission_constraint_id: string;
  axis: string;
  direction: 'MAX' | 'MIN';
  value_limit: number;
  mission_limit: number;
  explanation: string;
}

export type SubordinationStatus = 'SUBORDINATE' | 'CONFLICT';

export interface SubordinationResult {
  status: SubordinationStatus;
  conflicts: ValueMissionConflict[];
}

function exceeds(
  direction: 'MAX' | 'MIN',
  valueLimit: number,
  missionLimit: number,
): boolean {
  return direction === 'MAX' ? valueLimit > missionLimit : valueLimit < missionLimit;
}

/**
 * Check value content against a mission surface. Deterministic and total:
 * same inputs -> same result. Pure (no side effects, no links minted here).
 */
export function checkMissionSubordination(
  content: ValueModelContent,
  mission: MissionView,
): SubordinationResult {
  if (typeof mission !== 'object' || mission === null) {
    throw new ValueModelError('mission view must be an object { artifact_id, constraints }');
  }
  if (typeof mission.artifact_id !== 'string' || mission.artifact_id.length === 0) {
    throw new ValueModelError('mission view artifact_id must be a non-empty string');
  }
  if (!Array.isArray(mission.constraints)) {
    throw new ValueModelError('mission view constraints must be an array');
  }
  const hardBounds = mission.constraints.filter(
    (constraint): constraint is MissionConstraintView & { bound: { axis: string; direction: 'MAX' | 'MIN'; limit: number } } =>
      constraint !== null &&
      typeof constraint === 'object' &&
      constraint.hard === true &&
      constraint.bound !== null,
  );

  const conflicts: ValueMissionConflict[] = [];

  const checkBound = (
    valueElementKind: 'constraint' | 'budget',
    valueElementId: string,
    axis: string,
    direction: 'MAX' | 'MIN',
    limit: number,
  ): void => {
    for (const hard of hardBounds) {
      if (hard.bound.axis !== axis || hard.bound.direction !== direction) {
        continue;
      }
      if (exceeds(direction, limit, hard.bound.limit)) {
        conflicts.push({
          value_element_kind: valueElementKind,
          value_element_id: valueElementId,
          mission_constraint_id: hard.id,
          axis,
          direction,
          value_limit: limit,
          mission_limit: hard.bound.limit,
          explanation:
            direction === 'MAX'
              ? `${valueElementKind} ${valueElementId} permits up to ${limit} on axis "${axis}" but hard mission constraint ${hard.id} caps it at ${hard.bound.limit} (value never outranks mission)`
              : `${valueElementKind} ${valueElementId} requires only ${limit} on axis "${axis}" but hard mission constraint ${hard.id} demands at least ${hard.bound.limit} (value never outranks mission)`,
        });
      }
    }
  };

  for (const constraint of content.constraints) {
    if (constraint.bound !== null) {
      checkBound('constraint', constraint.id, constraint.bound.axis, constraint.bound.direction, constraint.bound.limit);
    }
  }
  // A budget is an implicit MAX bound on its resource axis.
  for (const budget of content.budgets) {
    checkBound('budget', budget.id, budget.resource, 'MAX', budget.limit);
  }

  return { status: conflicts.length > 0 ? 'CONFLICT' : 'SUBORDINATE', conflicts };
}

/**
 * Build the CONFLICTS_WITH trace link for a conflicted value model (FLAG
 * policy): source = the value model artifact id, target = the mission
 * artifact id, provenance = one entry per conflict. One link per
 * (value model, mission) pair — the spine's TraceLinkStore rejects duplicate
 * (source, target, type) triples, so all conflicts are carried in the
 * provenance of a single typed link.
 */
export function buildConflictLink(
  valueModelArtifactId: string,
  mission: MissionView,
  result: SubordinationResult,
  baseProvenance: string[],
): TraceLink {
  if (result.status !== 'CONFLICT') {
    throw new ValueModelError('buildConflictLink requires a CONFLICT subordination result');
  }
  return createTraceLink({
    source: valueModelArtifactId,
    target: mission.artifact_id,
    type: 'CONFLICTS_WITH',
    provenance: [
      ...baseProvenance,
      ...result.conflicts.map((conflict) => conflict.explanation),
    ],
  });
}
