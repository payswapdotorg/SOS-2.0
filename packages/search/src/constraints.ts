/**
 * Typed hard constraints (Work Order W7: "hard constraints filter candidates
 * BEFORE evaluation"; spec/architecture.md §18 "Hard constraints outrank
 * preferences"; requirement R11).
 *
 * SOURCE OF THE CONSTRAINT TYPE (no sibling packages modified): the typed
 * constraint set is CONSUMED from the mission/value models' exported types
 * through a duck-typed STRUCTURAL VIEW — exactly the pattern
 * @sos-2/value established for mission constraints (MissionConstraintView):
 * real @sos-2/mission MissionConstraint objects satisfy this shape DIRECTLY
 * (proven in the integration test), and @sos-2/search carries NO runtime
 * dependency on the sibling.
 *
 * FILTER SEMANTICS (documented, deterministic, honest):
 *   - only HARD (`hard === true`) constraints participate; SOFT mission
 *     constraints are preferences, never machine vetoes;
 *   - only BOUNDED hard constraints (axis + direction + limit) are
 *     MACHINE-CHECKABLE; unbounded hard constraints are carried verbatim as
 *     prose obligations (they cannot filter, and that is recorded, never
 *     hidden);
 *   - a candidate is checked per axis against its ESTIMATED measures
 *     (predictions supplied with the candidate — NOT evaluation results);
 *     MAX means "at most", MIN means "at least";
 *   - a candidate WITHOUT an estimate on a checked axis is UNCHECKED for
 *     that constraint — distinct from SATISFIED and from VIOLATED
 *     (spec/architecture.md §18: "Unknown, failed, unavailable and
 *     unsupported remain distinct"; missing data is never silently
 *     treated as satisfaction or violation);
 *   - a candidate SURVIVES the filter iff it has NO VIOLATED check
 *     (UNCHECKED does not fail — it is surfaced in the report).
 */

import { SearchError } from './errors.js';
import type { SearchCandidate } from './candidate.js';

/** The structural view of a mission constraint (duck-typed; see module doc). */
export interface HardConstraintView {
  id: string;
  statement: string;
  hard: boolean;
  bound: { axis: string; direction: 'MAX' | 'MIN'; limit: number } | null;
}

/** A typed set of hard constraints (the machine-checkable authority surface). */
export interface HardConstraintSet {
  /** Provenance of the set (e.g. the mission artifact id or a note). */
  source: string;
  /** ALL hard constraints (verbatim views; soft constraints are excluded). */
  constraints: HardConstraintView[];
  /** The bounded subset — the machine-checkable constraints (subset of constraints). */
  machine_checkable: HardConstraintView[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate one hard-constraint view (throws SearchError). */
export function assertValidHardConstraintView(value: unknown): asserts value is HardConstraintView {
  if (!isPlainObject(value)) {
    throw new SearchError(`hard constraint must be an object { id, statement, hard, bound }, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4 || !('id' in record) || !('statement' in record) || !('hard' in record) || !('bound' in record)) {
    throw new SearchError('hard constraint must have the exact field set { id, statement, hard, bound }');
  }
  if (typeof record['id'] !== 'string' || record['id'].length === 0) {
    throw new SearchError(`hard constraint id must be a non-empty string, received: ${JSON.stringify(record['id'])}`);
  }
  if (typeof record['statement'] !== 'string' || record['statement'].length === 0) {
    throw new SearchError(`hard constraint ${JSON.stringify(record['id'])} statement must be a non-empty string`);
  }
  if (typeof record['hard'] !== 'boolean') {
    throw new SearchError(`hard constraint ${JSON.stringify(record['id'])} hard must be a boolean`);
  }
  const bound = record['bound'];
  if (bound === null) {
    return;
  }
  if (!isPlainObject(bound) || Object.keys(bound).length !== 3 || !('axis' in bound) || !('direction' in bound) || !('limit' in bound)) {
    throw new SearchError(
      `hard constraint ${JSON.stringify(record['id'])} bound must be null or { axis, direction, limit }`,
    );
  }
  const boundRecord = bound as Record<string, unknown>;
  if (typeof boundRecord['axis'] !== 'string' || boundRecord['axis'].length === 0) {
    throw new SearchError(`hard constraint ${JSON.stringify(record['id'])} bound axis must be a non-empty string`);
  }
  if (boundRecord['direction'] !== 'MAX' && boundRecord['direction'] !== 'MIN') {
    throw new SearchError(
      `hard constraint ${JSON.stringify(record['id'])} bound direction must be MAX or MIN, received: ${JSON.stringify(boundRecord['direction'])}`,
    );
  }
  if (typeof boundRecord['limit'] !== 'number' || !Number.isFinite(boundRecord['limit'])) {
    throw new SearchError(
      `hard constraint ${JSON.stringify(record['id'])} bound limit must be a finite number, received: ${JSON.stringify(boundRecord['limit'])}`,
    );
  }
}

/**
 * Build a hard-constraint set from a mission-shaped view: { artifact_id,
 * constraints } — real @sos-2/mission mission content (or any structural
 * mirror) satisfies this directly. SOFT constraints are excluded (they are
 * preferences); bounded hard constraints are separated as machine-checkable.
 */
export function hardConstraintsFromMission(mission: {
  artifact_id: string;
  constraints: HardConstraintView[];
}): HardConstraintSet {
  if (!isPlainObject(mission)) {
    throw new SearchError(`mission view must be an object { artifact_id, constraints }, received: ${JSON.stringify(mission)}`);
  }
  if (typeof mission.artifact_id !== 'string' || mission.artifact_id.length === 0) {
    throw new SearchError(`mission view artifact_id must be a non-empty string, received: ${JSON.stringify(mission.artifact_id)}`);
  }
  if (!Array.isArray(mission.constraints)) {
    throw new SearchError('mission view constraints must be an array of constraint views');
  }
  const seen = new Set<string>();
  const hard: HardConstraintView[] = [];
  for (const constraint of mission.constraints) {
    assertValidHardConstraintView(constraint);
    if (seen.has(constraint.id)) {
      throw new SearchError(`duplicate constraint id in mission view: ${JSON.stringify(constraint.id)}`);
    }
    seen.add(constraint.id);
    if (constraint.hard) {
      hard.push({ ...constraint, bound: constraint.bound === null ? null : { ...constraint.bound } });
    }
  }
  return {
    source: mission.artifact_id,
    constraints: hard,
    machine_checkable: hard.filter((constraint) => constraint.bound !== null),
  };
}

/** Validate a hard-constraint set (throws SearchError). */
export function assertValidHardConstraintSet(value: unknown): asserts value is HardConstraintSet {
  if (!isPlainObject(value)) {
    throw new SearchError(`hard constraint set must be an object { source, constraints, machine_checkable }, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !('source' in record) || !('constraints' in record) || !('machine_checkable' in record)) {
    throw new SearchError('hard constraint set must have the exact field set { source, constraints, machine_checkable }');
  }
  if (typeof record['source'] !== 'string' || record['source'].length === 0) {
    throw new SearchError(`hard constraint set source must be a non-empty string, received: ${JSON.stringify(record['source'])}`);
  }
  const rebuilt = hardConstraintsFromMission({
    artifact_id: record['source'] as string,
    constraints: (record['constraints'] as HardConstraintView[]) ?? [],
  });
  // machine_checkable must be exactly the bounded subset (recomputed, not trusted).
  const expectedCheckable = canonicalCheckable(rebuilt.machine_checkable);
  if (canonicalCheckable((record['machine_checkable'] as HardConstraintView[]) ?? []) !== expectedCheckable) {
    throw new SearchError(
      'hard constraint set machine_checkable must be exactly the bounded subset of constraints (never a hand-edited list)',
    );
  }
}

function canonicalCheckable(constraints: readonly HardConstraintView[]): string {
  return JSON.stringify(
    [...constraints]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((constraint) => [constraint.id, constraint.bound]),
  );
}

/** The verdict of one constraint check against one candidate estimate. */
export type ConstraintVerdict = 'SATISFIED' | 'VIOLATED' | 'UNCHECKED';

/** One machine check: a bounded hard constraint against a candidate's estimate. */
export interface ConstraintCheck {
  constraint_id: string;
  axis: string;
  direction: 'MAX' | 'MIN';
  limit: number;
  /** The candidate's estimated value on the axis, or null when it has none. */
  estimate: number | null;
  verdict: ConstraintVerdict;
}

/** The per-candidate constraint report. */
export interface CandidateConstraintReport {
  candidate_id: string;
  checks: ConstraintCheck[];
  violated: ConstraintCheck[];
  unchecked: ConstraintCheck[];
  /** True iff no check is VIOLATED (UNCHECKED does not fail). */
  passes: boolean;
}

/** Check one candidate against the machine-checkable hard constraints. */
export function checkCandidate(candidate: SearchCandidate, set: HardConstraintSet): CandidateConstraintReport {
  const checks: ConstraintCheck[] = set.machine_checkable.map((constraint) => {
    const bound = constraint.bound!;
    const estimate = candidate.estimates[bound.axis];
    if (estimate === undefined) {
      return {
        constraint_id: constraint.id,
        axis: bound.axis,
        direction: bound.direction,
        limit: bound.limit,
        estimate: null,
        verdict: 'UNCHECKED' as const,
      };
    }
    if (typeof estimate !== 'number' || !Number.isFinite(estimate)) {
      throw new SearchError(
        `candidate ${JSON.stringify(candidate.id)} carries a non-finite estimate on axis ${JSON.stringify(bound.axis)}: ${JSON.stringify(estimate)}`,
      );
    }
    const satisfied = bound.direction === 'MAX' ? estimate <= bound.limit : estimate >= bound.limit;
    return {
      constraint_id: constraint.id,
      axis: bound.axis,
      direction: bound.direction,
      limit: bound.limit,
      estimate,
      verdict: satisfied ? ('SATISFIED' as const) : ('VIOLATED' as const),
    };
  });
  return {
    candidate_id: candidate.id,
    checks,
    violated: checks.filter((check) => check.verdict === 'VIOLATED'),
    unchecked: checks.filter((check) => check.verdict === 'UNCHECKED'),
    passes: checks.every((check) => check.verdict !== 'VIOLATED'),
  };
}

/** The result of filtering candidates by hard constraints (before evaluation). */
export interface ConstraintFilterResult {
  survivors: { candidate: SearchCandidate; report: CandidateConstraintReport }[];
  rejected: { candidate: SearchCandidate; report: CandidateConstraintReport }[];
}

/**
 * Filter candidates by the machine-checkable hard constraints — BEFORE any
 * evaluation. Survivors have no VIOLATED check; every rejection carries its
 * violated checks; UNCHECKED constraints are surfaced, never conflated.
 */
export function filterByHardConstraints(
  candidates: readonly SearchCandidate[],
  set: HardConstraintSet,
): ConstraintFilterResult {
  assertValidHardConstraintSet(set);
  const survivors: ConstraintFilterResult['survivors'] = [];
  const rejected: ConstraintFilterResult['rejected'] = [];
  for (const candidate of candidates) {
    const report = checkCandidate(candidate, set);
    if (report.passes) {
      survivors.push({ candidate, report });
    } else {
      rejected.push({ candidate, report });
    }
  }
  return { survivors, rejected };
}
