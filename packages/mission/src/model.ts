/**
 * Mission content model — realization of spec/architecture.md §5 "Mission":
 *
 *     "Mission: purpose, goals, outcomes, stakeholders, measures, assumptions,
 *      ambiguities, constraints and revision history."
 *
 * The first eight elements are carried by MissionContent (exact field set).
 * Revision history is carried by the versioned envelope chain (`supersedes`)
 * and made complete/queryable by MissionStore (see revision.ts).
 *
 * Progressive formalization (spec/requirements.md R2): a mission may start
 * informal — every collection may be empty except `purpose`, which is the
 * single mandatory semantic anchor. Formalization proceeds by attaching
 * measures and marking goals MEASURABLE/ACHIEVED; the measurable-goal
 * invariant below is enforced at construction time (machine-checked, per
 * spec/architecture.md §7 "architecture as executable constraint").
 */

import { MissionError } from './errors.js';

/** Goal status vocabulary (W1 realization; progressive formalization states). */
export const MISSION_GOAL_STATUSES = ['PROPOSED', 'MEASURABLE', 'ACHIEVED'] as const;

export type MissionGoalStatus = (typeof MISSION_GOAL_STATUSES)[number];

const GOAL_STATUS_SET: ReadonlySet<string> = new Set(MISSION_GOAL_STATUSES);

export function isMissionGoalStatus(value: unknown): value is MissionGoalStatus {
  return typeof value === 'string' && GOAL_STATUS_SET.has(value);
}

/**
 * Local ids identify elements WITHIN a mission content (goals, measures, ...).
 * They are deliberately distinct from Semantic Spine artifact ids: the mission
 * artifact as a whole carries the sos:// identity. Lowercase slugs keep local
 * references readable and canonical-serialization friendly.
 */
export const MISSION_LOCAL_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Machine-checkable formalization of a mission constraint bound
 * (progressive formalization, R2). `axis` names the measured quantity
 * (e.g. "monthly-cost", "uptime", "p95-latency"); direction MAX means "at
 * most", MIN means "at least". A bound is OPTIONAL on a mission constraint —
 * unbounded constraints remain prose statements; bounded HARD mission
 * constraints are the authority surface that typed Value constraints are
 * checked against (see @sos-2/value subordination).
 */
export const MISSION_BOUND_DIRECTIONS = ['MAX', 'MIN'] as const;

export type MissionBoundDirection = (typeof MISSION_BOUND_DIRECTIONS)[number];

const BOUND_DIRECTION_SET: ReadonlySet<string> = new Set(MISSION_BOUND_DIRECTIONS);

export function isMissionBoundDirection(value: unknown): value is MissionBoundDirection {
  return typeof value === 'string' && BOUND_DIRECTION_SET.has(value);
}

export const MISSION_AXIS_PATTERN = /^[a-z][a-z0-9_.-]*$/;

export interface MissionBound {
  /** Measured quantity, e.g. "monthly-cost". */
  axis: string;
  /** MAX = at most; MIN = at least. */
  direction: MissionBoundDirection;
  /** Numeric bound on the axis (finite). */
  limit: number;
}

export interface MissionMeasure {
  id: string;
  description: string;
  /** Target expression, or null while still unformalized. */
  target: string | null;
  /** Unit of measurement, or null. */
  unit: string | null;
}

export interface MissionGoal {
  id: string;
  statement: string;
  status: MissionGoalStatus;
  /** References to MissionMeasure ids (may be empty for PROPOSED goals). */
  measures: string[];
}

export interface MissionOutcome {
  id: string;
  description: string;
  /** References to MissionGoal ids this outcome expresses (may be empty). */
  goal_refs: string[];
}

export interface MissionStakeholder {
  id: string;
  name: string;
  interest: string | null;
}

export interface MissionAssumption {
  id: string;
  statement: string;
}

export interface MissionAmbiguity {
  id: string;
  statement: string;
  /** How the ambiguity was resolved, or null while open (progressive formalization). */
  resolution: string | null;
}

export interface MissionConstraint {
  id: string;
  statement: string;
  /**
   * Hard constraints outrank preferences (spec/architecture.md §18) and are
   * the machine-checkable authority surface for value subordination.
   */
  hard: boolean;
  /** Optional machine-checkable bound (progressive formalization). */
  bound: MissionBound | null;
}

export interface MissionContent {
  purpose: string;
  goals: MissionGoal[];
  outcomes: MissionOutcome[];
  stakeholders: MissionStakeholder[];
  measures: MissionMeasure[];
  assumptions: MissionAssumption[];
  ambiguities: MissionAmbiguity[];
  constraints: MissionConstraint[];
}

const CONTENT_KEYS = [
  'purpose',
  'goals',
  'outcomes',
  'stakeholders',
  'measures',
  'assumptions',
  'ambiguities',
  'constraints',
] as const;

const MEASURE_KEYS = ['id', 'description', 'target', 'unit'] as const;
const GOAL_KEYS = ['id', 'statement', 'status', 'measures'] as const;
const OUTCOME_KEYS = ['id', 'description', 'goal_refs'] as const;
const STAKEHOLDER_KEYS = ['id', 'name', 'interest'] as const;
const ASSUMPTION_KEYS = ['id', 'statement'] as const;
const AMBIGUITY_KEYS = ['id', 'statement', 'resolution'] as const;
const CONSTRAINT_KEYS = ['id', 'statement', 'hard', 'bound'] as const;
const BOUND_KEYS = ['axis', 'direction', 'limit'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function requireLocalId(value: Record<string, unknown>, what: string): string {
  const id = value['id'];
  if (!isNonEmptyString(id) || !MISSION_LOCAL_ID_PATTERN.test(id)) {
    throw new MissionError(`${what} id must match ${MISSION_LOCAL_ID_PATTERN.toString()}, received: ${JSON.stringify(id)}`);
  }
  return id;
}

interface CollectionResult {
  ids: string[];
}

function validateCollection<T>(
  value: unknown,
  what: string,
  validateElement: (element: Record<string, unknown>, id: string) => T,
): CollectionResult {
  if (!Array.isArray(value)) {
    throw new MissionError(`${what} must be an array, received: ${JSON.stringify(value)}`);
  }
  const ids: string[] = [];
  for (const element of value) {
    if (!isPlainObject(element)) {
      throw new MissionError(`${what} entries must be objects, received: ${JSON.stringify(element)}`);
    }
    const id = requireLocalId(element, what.slice(0, -1));
    ids.push(id);
    validateElement(element, id);
  }
  return { ids };
}

/** Validate a MissionBound-shaped value (throws MissionError). */
function validateBound(value: unknown, context: string): MissionBound {
  if (!isPlainObject(value) || !hasExactKeys(value, BOUND_KEYS)) {
    throw new MissionError(`${context} bound must be an object with exact fields { axis, direction, limit }`);
  }
  const axis = value['axis'];
  if (!isNonEmptyString(axis) || !MISSION_AXIS_PATTERN.test(axis)) {
    throw new MissionError(`${context} bound axis must match ${MISSION_AXIS_PATTERN.toString()}, received: ${JSON.stringify(axis)}`);
  }
  const direction = value['direction'];
  if (!isMissionBoundDirection(direction)) {
    throw new MissionError(`${context} bound direction must be MAX or MIN, received: ${JSON.stringify(direction)}`);
  }
  const limit = value['limit'];
  if (!isFiniteNumber(limit)) {
    throw new MissionError(`${context} bound limit must be a finite number, received: ${JSON.stringify(limit)}`);
  }
  return { axis, direction, limit };
}

/**
 * Full mission-content validation with precise error messages
 * (throws MissionError). Enforces the exact field set, the flat local-id
 * namespace and every mission-level invariant, including the progressive
 * formalization invariant: a goal marked MEASURABLE or ACHIEVED must
 * reference at least one existing measure.
 */
export function validateMissionContent(content: unknown): asserts content is MissionContent {
  if (!isPlainObject(content)) {
    throw new MissionError(`mission content must be an object, received: ${JSON.stringify(content)}`);
  }
  if (!hasExactKeys(content, CONTENT_KEYS)) {
    throw new MissionError(
      `mission content must have the exact field set { ${CONTENT_KEYS.join(', ')} } (spec/architecture.md §5 Mission)`,
    );
  }
  if (!isNonEmptyString(content['purpose'])) {
    throw new MissionError('mission purpose must be a non-empty string (the single mandatory semantic anchor)');
  }

  const allIds = new Set<string>();
  const remember = (ids: string[], what: string): void => {
    for (const id of ids) {
      if (allIds.has(id)) {
        throw new MissionError(`duplicate local id "${id}" in mission content (${what}): local ids are unique across the whole mission content`);
      }
      allIds.add(id);
    }
  };

  const measures = validateCollection(content['measures'], 'measures', (element) => {
    if (!hasExactKeys(element, MEASURE_KEYS)) {
      throw new MissionError(`measure must have exact fields { ${MEASURE_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['description'])) {
      throw new MissionError(`measure ${JSON.stringify(element['id'])} description must be a non-empty string`);
    }
    if (!isNullableString(element['target'])) {
      throw new MissionError(`measure ${JSON.stringify(element['id'])} target must be a string or null`);
    }
    if (!isNullableString(element['unit'])) {
      throw new MissionError(`measure ${JSON.stringify(element['id'])} unit must be a string or null`);
    }
  });
  remember(measures.ids, 'measures');
  const measureIds = new Set(measures.ids);

  const goals = validateCollection(content['goals'], 'goals', (element, id) => {
    if (!hasExactKeys(element, GOAL_KEYS)) {
      throw new MissionError(`goal must have exact fields { ${GOAL_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['statement'])) {
      throw new MissionError(`goal ${JSON.stringify(id)} statement must be a non-empty string`);
    }
    if (!isMissionGoalStatus(element['status'])) {
      throw new MissionError(
        `goal ${JSON.stringify(id)} status must be one of ${MISSION_GOAL_STATUSES.join(', ')}, received: ${JSON.stringify(element['status'])}`,
      );
    }
    if (!isStringArray(element['measures'])) {
      throw new MissionError(`goal ${JSON.stringify(id)} measures must be an array of strings`);
    }
    for (const ref of element['measures']) {
      if (!measureIds.has(ref)) {
        throw new MissionError(`goal ${JSON.stringify(id)} references unknown measure ${JSON.stringify(ref)}`);
      }
    }
    // Progressive formalization invariant (spec/requirements.md R2):
    if (element['status'] !== 'PROPOSED' && element['measures'].length === 0) {
      throw new MissionError(
        `goal ${JSON.stringify(id)} is marked ${String(element['status'])} but references no measure: a measurable goal must reference at least one existing measure`,
      );
    }
  });
  remember(goals.ids, 'goals');
  const goalIds = new Set(goals.ids);

  const outcomes = validateCollection(content['outcomes'], 'outcomes', (element, id) => {
    if (!hasExactKeys(element, OUTCOME_KEYS)) {
      throw new MissionError(`outcome must have exact fields { ${OUTCOME_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['description'])) {
      throw new MissionError(`outcome ${JSON.stringify(id)} description must be a non-empty string`);
    }
    if (!isStringArray(element['goal_refs'])) {
      throw new MissionError(`outcome ${JSON.stringify(id)} goal_refs must be an array of strings`);
    }
    for (const ref of element['goal_refs']) {
      if (!goalIds.has(ref)) {
        throw new MissionError(`outcome ${JSON.stringify(id)} references unknown goal ${JSON.stringify(ref)}`);
      }
    }
  });
  remember(outcomes.ids, 'outcomes');

  const stakeholders = validateCollection(content['stakeholders'], 'stakeholders', (element, id) => {
    if (!hasExactKeys(element, STAKEHOLDER_KEYS)) {
      throw new MissionError(`stakeholder must have exact fields { ${STAKEHOLDER_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['name'])) {
      throw new MissionError(`stakeholder ${JSON.stringify(id)} name must be a non-empty string`);
    }
    if (!isNullableString(element['interest'])) {
      throw new MissionError(`stakeholder ${JSON.stringify(id)} interest must be a string or null`);
    }
  });
  remember(stakeholders.ids, 'stakeholders');

  const assumptions = validateCollection(content['assumptions'], 'assumptions', (element, id) => {
    if (!hasExactKeys(element, ASSUMPTION_KEYS)) {
      throw new MissionError(`assumption must have exact fields { ${ASSUMPTION_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['statement'])) {
      throw new MissionError(`assumption ${JSON.stringify(id)} statement must be a non-empty string`);
    }
  });
  remember(assumptions.ids, 'assumptions');

  const ambiguities = validateCollection(content['ambiguities'], 'ambiguities', (element, id) => {
    if (!hasExactKeys(element, AMBIGUITY_KEYS)) {
      throw new MissionError(`ambiguity must have exact fields { ${AMBIGUITY_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['statement'])) {
      throw new MissionError(`ambiguity ${JSON.stringify(id)} statement must be a non-empty string`);
    }
    if (!isNullableString(element['resolution'])) {
      throw new MissionError(`ambiguity ${JSON.stringify(id)} resolution must be a string or null`);
    }
  });
  remember(ambiguities.ids, 'ambiguities');

  const constraints = validateCollection(content['constraints'], 'constraints', (element, id) => {
    if (!hasExactKeys(element, CONSTRAINT_KEYS)) {
      throw new MissionError(`constraint must have exact fields { ${CONSTRAINT_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['statement'])) {
      throw new MissionError(`constraint ${JSON.stringify(id)} statement must be a non-empty string`);
    }
    if (typeof element['hard'] !== 'boolean') {
      throw new MissionError(`constraint ${JSON.stringify(id)} hard must be a boolean`);
    }
    if (element['bound'] !== null) {
      validateBound(element['bound'], `constraint ${JSON.stringify(id)}`);
    }
  });
  remember(constraints.ids, 'constraints');
}

/** Predicate form of validateMissionContent. */
export function isValidMissionContent(value: unknown): value is MissionContent {
  try {
    validateMissionContent(value);
    return true;
  } catch {
    return false;
  }
}
