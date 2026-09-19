/**
 * ValueModel content — realization of spec/architecture.md §5 "Value Model":
 *
 *     "Value Model: economic objectives, budgets, incentives, opportunities
 *      and typed constraints."
 *
 * Separation of the Value Model from the Mission is a frozen requirement
 * (spec/requirements.md R4 "Separate Value Model"). Value content carries:
 *   - objectives: economic objectives (MAXIMIZE / MINIMIZE / MAINTAIN a metric)
 *   - budgets: resource budgets (implicit MAX bounds on a resource axis)
 *   - incentives: incentives aligned with objectives
 *   - opportunities: opportunities with optional expected value
 *   - constraints: typed constraints (see constraints.ts)
 *   - approved: whether these value commitments are APPROVED — only approved
 *     value commitments enter the §3 precedence tier
 *     ("approved Value commitments" outrank hard constraints and are
 *     outranked by Mission).
 */

import { ValueModelError } from './errors.js';
import { validateValueConstraint } from './constraints.js';
import type { ValueConstraint, ValueConstraintTypeRegistry } from './constraints.js';

export const VALUE_OBJECTIVE_DIRECTIONS = ['MAXIMIZE', 'MINIMIZE', 'MAINTAIN'] as const;

export type ValueObjectiveDirection = (typeof VALUE_OBJECTIVE_DIRECTIONS)[number];

const OBJECTIVE_DIRECTION_SET: ReadonlySet<string> = new Set(VALUE_OBJECTIVE_DIRECTIONS);

export function isValueObjectiveDirection(value: unknown): value is ValueObjectiveDirection {
  return typeof value === 'string' && OBJECTIVE_DIRECTION_SET.has(value);
}

export interface ValueObjective {
  id: string;
  statement: string;
  direction: ValueObjectiveDirection;
  /** Metric being optimized (e.g. "revenue-per-tenant"). */
  metric: string;
}

export interface ValueBudget {
  id: string;
  /** Resource axis this budget caps (e.g. "monthly-cost"). */
  resource: string;
  /** Budget limit (finite, >= 0). */
  limit: number;
  /** Unit of the resource (e.g. "USD"). */
  unit: string;
}

export interface ValueIncentive {
  id: string;
  statement: string;
  /** Objective ids this incentive aligns with (must resolve). */
  aligns_with: string[];
}

export interface ValueOpportunity {
  id: string;
  statement: string;
  /** Optional quantified expected value (finite). */
  expected_value: number | null;
}

export interface ValueModelContent {
  objectives: ValueObjective[];
  budgets: ValueBudget[];
  incentives: ValueIncentive[];
  opportunities: ValueOpportunity[];
  constraints: ValueConstraint[];
  /** Whether these value commitments are approved (§3: "approved Value commitments"). */
  approved: boolean;
}

const CONTENT_KEYS = ['objectives', 'budgets', 'incentives', 'opportunities', 'constraints', 'approved'] as const;
const OBJECTIVE_KEYS = ['id', 'statement', 'direction', 'metric'] as const;
const BUDGET_KEYS = ['id', 'resource', 'limit', 'unit'] as const;
const INCENTIVE_KEYS = ['id', 'statement', 'aligns_with'] as const;
const OPPORTUNITY_KEYS = ['id', 'statement', 'expected_value'] as const;

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function requireSlug(value: Record<string, unknown>, what: string): string {
  const id = value['id'];
  if (!isNonEmptyString(id) || !/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new ValueModelError(`${what} id must be a lowercase slug, received: ${JSON.stringify(id)}`);
  }
  return id;
}

function validateCollection(
  value: unknown,
  what: string,
  validateElement: (element: Record<string, unknown>, id: string) => void,
): string[] {
  if (!Array.isArray(value)) {
    throw new ValueModelError(`${what} must be an array, received: ${JSON.stringify(value)}`);
  }
  const ids: string[] = [];
  for (const element of value) {
    if (!isPlainObject(element)) {
      throw new ValueModelError(`${what} entries must be objects`);
    }
    const id = requireSlug(element, what.slice(0, -1));
    ids.push(id);
    validateElement(element, id);
  }
  return ids;
}

/**
 * Full value-model content validation (throws ValueModelError): exact field
 * set, flat unique local-id namespace, resolvable references, and typed
 * constraints validated against the constraint-type registry.
 */
export function validateValueModelContent(
  content: unknown,
  registry?: ValueConstraintTypeRegistry,
): asserts content is ValueModelContent {
  if (!isPlainObject(content)) {
    throw new ValueModelError(`value model content must be an object, received: ${JSON.stringify(content)}`);
  }
  if (!hasExactKeys(content, CONTENT_KEYS)) {
    throw new ValueModelError(
      `value model content must have the exact field set { ${CONTENT_KEYS.join(', ')} } (spec/architecture.md §5 Value Model)`,
    );
  }
  if (typeof content['approved'] !== 'boolean') {
    throw new ValueModelError(`value model approved must be a boolean, received: ${JSON.stringify(content['approved'])}`);
  }

  const allIds = new Set<string>();
  const remember = (ids: string[], what: string): void => {
    for (const id of ids) {
      if (allIds.has(id)) {
        throw new ValueModelError(`duplicate local id "${id}" in value model content (${what})`);
      }
      allIds.add(id);
    }
  };

  const objectives = validateCollection(content['objectives'], 'objectives', (element, id) => {
    if (!hasExactKeys(element, OBJECTIVE_KEYS)) {
      throw new ValueModelError(`objective must have exact fields { ${OBJECTIVE_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['statement'])) {
      throw new ValueModelError(`objective ${JSON.stringify(id)} statement must be a non-empty string`);
    }
    if (!isValueObjectiveDirection(element['direction'])) {
      throw new ValueModelError(
        `objective ${JSON.stringify(id)} direction must be one of ${VALUE_OBJECTIVE_DIRECTIONS.join(', ')}, received: ${JSON.stringify(element['direction'])}`,
      );
    }
    if (!isNonEmptyString(element['metric'])) {
      throw new ValueModelError(`objective ${JSON.stringify(id)} metric must be a non-empty string`);
    }
  });
  remember(objectives, 'objectives');
  const objectiveIds = new Set(objectives);

  const budgets = validateCollection(content['budgets'], 'budgets', (element, id) => {
    if (!hasExactKeys(element, BUDGET_KEYS)) {
      throw new ValueModelError(`budget must have exact fields { ${BUDGET_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['resource']) || !/^[a-z][a-z0-9_.-]*$/.test(element['resource'])) {
      throw new ValueModelError(`budget ${JSON.stringify(id)} resource must be a lowercase axis name`);
    }
    const limit = element['limit'];
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
      throw new ValueModelError(`budget ${JSON.stringify(id)} limit must be a finite number >= 0, received: ${JSON.stringify(limit)}`);
    }
    if (!isNonEmptyString(element['unit'])) {
      throw new ValueModelError(`budget ${JSON.stringify(id)} unit must be a non-empty string`);
    }
  });
  remember(budgets, 'budgets');

  const incentives = validateCollection(content['incentives'], 'incentives', (element, id) => {
    if (!hasExactKeys(element, INCENTIVE_KEYS)) {
      throw new ValueModelError(`incentive must have exact fields { ${INCENTIVE_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['statement'])) {
      throw new ValueModelError(`incentive ${JSON.stringify(id)} statement must be a non-empty string`);
    }
    if (!isStringArray(element['aligns_with'])) {
      throw new ValueModelError(`incentive ${JSON.stringify(id)} aligns_with must be an array of strings`);
    }
    for (const ref of element['aligns_with']) {
      if (!objectiveIds.has(ref)) {
        throw new ValueModelError(`incentive ${JSON.stringify(id)} references unknown objective ${JSON.stringify(ref)}`);
      }
    }
  });
  remember(incentives, 'incentives');

  const opportunities = validateCollection(content['opportunities'], 'opportunities', (element, id) => {
    if (!hasExactKeys(element, OPPORTUNITY_KEYS)) {
      throw new ValueModelError(`opportunity must have exact fields { ${OPPORTUNITY_KEYS.join(', ')} }`);
    }
    if (!isNonEmptyString(element['statement'])) {
      throw new ValueModelError(`opportunity ${JSON.stringify(id)} statement must be a non-empty string`);
    }
    const expected = element['expected_value'];
    if (expected !== null && (typeof expected !== 'number' || !Number.isFinite(expected))) {
      throw new ValueModelError(`opportunity ${JSON.stringify(id)} expected_value must be a finite number or null`);
    }
  });
  remember(opportunities, 'opportunities');

  if (!Array.isArray(content['constraints'])) {
    throw new ValueModelError('constraints must be an array');
  }
  const constraintIds: string[] = [];
  for (const constraint of content['constraints']) {
    validateValueConstraint(constraint, registry);
    constraintIds.push((constraint as ValueConstraint).id);
  }
  remember(constraintIds, 'constraints');
}

/** Predicate form of validateValueModelContent. */
export function isValidValueModelContent(
  value: unknown,
  registry?: ValueConstraintTypeRegistry,
): value is ValueModelContent {
  try {
    validateValueModelContent(value, registry);
    return true;
  } catch {
    return false;
  }
}
