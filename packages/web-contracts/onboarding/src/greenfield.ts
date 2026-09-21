/**
 * The greenfield journey model (Work Order P4): purpose → outcomes →
 * stakeholders → measures → constraints → review → authority
 * confirmation → GitHub connection — each step a typed stage with
 * inputs, validation results, uncertainty and the next allowed action.
 *
 * Progressive formalization, not an engineering form (docs/ux
 * user-journey-simulation: "Mission onboarding: Progressive
 * formalization"). The user never needs to know SOS artifact names: the
 * stage inputs use product language and the journey maps them onto the
 * frozen Mission vocabulary (@sos-2/mission's MissionContent — imported,
 * never redefined) at the review step, where the DOMAIN's own
 * validateMissionContent is the single validation authority.
 *
 * Pure model + pure functions only: no DOM, no clocks, no randomness.
 */

import { validateMissionContent } from '@sos-2/mission';
import type { MissionContent } from '@sos-2/mission';

/** The greenfield journey stages, in the Work Order's exact order. */
export const GREENFIELD_STAGES = [
  'PURPOSE',
  'OUTCOMES',
  'STAKEHOLDERS',
  'MEASURES',
  'CONSTRAINTS',
  'REVIEW',
  'AUTHORITY_CONFIRMATION',
  'GITHUB_CONNECTION',
  'PERSISTED',
] as const;

export type GreenfieldStage = (typeof GREENFIELD_STAGES)[number];

const STAGE_ORDER: ReadonlyMap<GreenfieldStage, number> = new Map(
  GREENFIELD_STAGES.map((stage, index) => [stage, index]),
);

/** The order of a stage in the journey (0-based; stable for progress indicators). */
export function greenfieldStageOrder(stage: GreenfieldStage): number {
  const order = STAGE_ORDER.get(stage);
  if (order === undefined) {
    throw new Error(`unknown greenfield stage: ${JSON.stringify(stage)}`);
  }
  return order;
}

/** The user-facing label of a stage (presentation, not vocabulary). */
export function greenfieldStageLabel(stage: GreenfieldStage): string {
  switch (stage) {
    case 'PURPOSE':
      return 'Purpose';
    case 'OUTCOMES':
      return 'Outcomes';
    case 'STAKEHOLDERS':
      return 'Stakeholders';
    case 'MEASURES':
      return 'Measures';
    case 'CONSTRAINTS':
      return 'Constraints';
    case 'REVIEW':
      return 'Review';
    case 'AUTHORITY_CONFIRMATION':
      return 'Authority confirmation';
    case 'GITHUB_CONNECTION':
      return 'GitHub connection';
    case 'PERSISTED':
      return 'Persisted';
  }
}

/** One outcome input (product language: what should be true afterwards). */
export interface GreenfieldOutcomeInput {
  /** The outcome statement, e.g. 'Checkout completes under 250ms in the EU region'. */
  description: string;
  /** The goal statements this outcome drives (free text here; formalized into MissionGoal records at review). */
  goals: string[];
}

/** One stakeholder input. */
export interface GreenfieldStakeholderInput {
  name: string;
  /** What this stakeholder needs from the mission, or null when not yet stated. */
  interest: string | null;
}

/** One measure input (how a goal is observed). */
export interface GreenfieldMeasureInput {
  description: string;
  /** The target expression, e.g. '<= 250ms p95', or null while unformalized. */
  target: string | null;
  /** The unit label, e.g. 'ms', or null. */
  unit: string | null;
}

/** One constraint input. */
export interface GreenfieldConstraintInput {
  statement: string;
  /** True when the constraint is hard (violating it fails the mission), false when a preference. */
  hard: boolean;
}

/** The repository selection captured at the GitHub connection stage. */
export interface GreenfieldRepositorySelection {
  owner: string;
  name: string;
  /** True when the discovered repository is empty (the greenfield flagship path). */
  is_empty: boolean;
  /** The selected branch, or null while the repository is empty. */
  branch: string | null;
  /** The exact revision (commit sha) at selection time, or null while empty. */
  head_sha: string | null;
}

/**
 * The greenfield journey draft — the accumulated, resumable journey
 * state. All fields are optional-in-progress; validation decides what
 * is complete. The draft is pure data (persistable through the live
 * store's development state; rendered from search params by the
 * surface).
 */
export interface GreenfieldJourneyDraft {
  purpose: string | null;
  outcomes: GreenfieldOutcomeInput[];
  stakeholders: GreenfieldStakeholderInput[];
  measures: GreenfieldMeasureInput[];
  constraints: GreenfieldConstraintInput[];
  /** The explicit authority confirmation (the gate — never implied by reaching the stage). */
  authority_confirmed: boolean;
  /** The repository selection from the GitHub connection stage, or null while unselected. */
  repository: GreenfieldRepositorySelection | null;
}

/** The empty draft (a fresh journey). */
export function emptyGreenfieldDraft(): GreenfieldJourneyDraft {
  return {
    purpose: null,
    outcomes: [],
    stakeholders: [],
    measures: [],
    constraints: [],
    authority_confirmed: false,
    repository: null,
  };
}

/** The typed validation error of one stage (field-level, honest, user-actionable). */
export interface GreenfieldValidationError {
  stage: GreenfieldStage;
  /** The field the error binds to (a stable id, e.g. 'purpose', 'outcomes[0].description'). */
  field: string;
  /** The typed error code (a closed vocabulary). */
  code: GreenfieldValidationCode;
  /** One honest, actionable sentence. */
  message: string;
}

/** The closed validation-error vocabulary of the greenfield journey. */
export const GREENFIELD_VALIDATION_CODES = [
  'MISSING_INPUT',
  'EMPTY_STATEMENT',
  'UNFORMALIZED_CONTENT',
  'DOMAIN_REJECTED',
  'AUTHORITY_NOT_CONFIRMED',
  'REPOSITORY_NOT_SELECTED',
] as const;

export type GreenfieldValidationCode = (typeof GREENFIELD_VALIDATION_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set<string>(GREENFIELD_VALIDATION_CODES);

/** Is this a well-formed greenfield validation code? */
export function isGreenfieldValidationCode(value: unknown): value is GreenfieldValidationCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

const MAX_PURPOSE_LENGTH = 600;

/** Validate one stage of the draft (typed errors; the review stage defers to the domain validator). */
export function validateGreenfieldStage(stage: GreenfieldStage, draft: GreenfieldJourneyDraft): GreenfieldValidationError[] {
  const errors: GreenfieldValidationError[] = [];
  switch (stage) {
    case 'PURPOSE': {
      if (draft.purpose === null) {
        errors.push({ stage, field: 'purpose', code: 'MISSING_INPUT', message: 'State the purpose in one sentence — why does this mission exist?' });
      } else if (draft.purpose.trim().length === 0) {
        errors.push({ stage, field: 'purpose', code: 'EMPTY_STATEMENT', message: 'The purpose is blank — one honest sentence is enough.' });
      } else if (draft.purpose.length > MAX_PURPOSE_LENGTH) {
        errors.push({ stage, field: 'purpose', code: 'EMPTY_STATEMENT', message: `The purpose is very long (${draft.purpose.length} characters) — keep it under ${MAX_PURPOSE_LENGTH} for the formal mission statement.` });
      }
      return errors;
    }
    case 'OUTCOMES': {
      if (draft.outcomes.length === 0) {
        errors.push({ stage, field: 'outcomes', code: 'MISSING_INPUT', message: 'Add at least one outcome — what should be true afterwards?' });
      }
      draft.outcomes.forEach((outcome, index) => {
        if (outcome.description.trim().length === 0) {
          errors.push({ stage, field: `outcomes[${index}].description`, code: 'EMPTY_STATEMENT', message: `Outcome ${index + 1} has no description.` });
        }
      });
      return errors;
    }
    case 'STAKEHOLDERS': {
      if (draft.stakeholders.length === 0) {
        errors.push({ stage, field: 'stakeholders', code: 'MISSING_INPUT', message: 'Add at least one stakeholder — who does this mission serve?' });
      }
      draft.stakeholders.forEach((stakeholder, index) => {
        if (stakeholder.name.trim().length === 0) {
          errors.push({ stage, field: `stakeholders[${index}].name`, code: 'EMPTY_STATEMENT', message: `Stakeholder ${index + 1} has no name.` });
        }
      });
      return errors;
    }
    case 'MEASURES': {
      if (draft.measures.length === 0) {
        errors.push({ stage, field: 'measures', code: 'MISSING_INPUT', message: 'Add at least one measure — how will you know the mission is working?' });
      }
      draft.measures.forEach((measure, index) => {
        if (measure.description.trim().length === 0) {
          errors.push({ stage, field: `measures[${index}].description`, code: 'EMPTY_STATEMENT', message: `Measure ${index + 1} has no description.` });
        }
      });
      return errors;
    }
    case 'CONSTRAINTS': {
      draft.constraints.forEach((constraint, index) => {
        if (constraint.statement.trim().length === 0) {
          errors.push({ stage, field: `constraints[${index}].statement`, code: 'EMPTY_STATEMENT', message: `Constraint ${index + 1} has no statement.` });
        }
      });
      return errors;
    }
    case 'REVIEW': {
      // The DOMAIN validator is the single validation authority here:
      // the review stage maps the draft onto MissionContent and asks
      // @sos-2/mission's own validateMissionContent.
      const formalization = formalizeMissionContent(draft);
      if (!formalization.valid) {
        for (const problem of formalization.problems) {
          errors.push({ stage, field: problem.field, code: 'DOMAIN_REJECTED', message: problem.message });
        }
      }
      return errors;
    }
    case 'AUTHORITY_CONFIRMATION': {
      if (!draft.authority_confirmed) {
        errors.push({ stage, field: 'authority_confirmed', code: 'AUTHORITY_NOT_CONFIRMED', message: 'Formalizing the mission requires your explicit authority confirmation — the gate never closes itself.' });
      }
      return errors;
    }
    case 'GITHUB_CONNECTION': {
      if (draft.repository === null) {
        errors.push({ stage, field: 'repository', code: 'REPOSITORY_NOT_SELECTED', message: 'Select a GitHub repository for this mission — an empty repository starts the mission from scratch.' });
      }
      return errors;
    }
    case 'PERSISTED': {
      return errors;
    }
  }
}

/** Is a stage complete (validation passes)? */
export function isGreenfieldStageComplete(stage: GreenfieldStage, draft: GreenfieldJourneyDraft): boolean {
  return validateGreenfieldStage(stage, draft).length === 0;
}

/** The current stage of a draft: the first incomplete stage (PERSISTED when everything is complete). */
export function greenfieldCurrentStage(draft: GreenfieldJourneyDraft): GreenfieldStage {
  for (const stage of GREENFIELD_STAGES) {
    if (stage === 'PERSISTED') {
      return stage;
    }
    if (!isGreenfieldStageComplete(stage, draft)) {
      return stage;
    }
  }
  return 'PERSISTED';
}

/**
 * The next allowed transition of a draft: the current stage, whether it
 * may advance (all prior stages complete) and what blocks it (the
 * current stage's typed validation errors). The authority gate and the
 * repository selection are explicit blockers — never skipped.
 */
export function greenfieldNextTransition(draft: GreenfieldJourneyDraft): {
  current: GreenfieldStage;
  may_advance: boolean;
  blocked_by: GreenfieldValidationError[];
} {
  const current = greenfieldCurrentStage(draft);
  if (current === 'PERSISTED') {
    return { current, may_advance: false, blocked_by: [] };
  }
  const blockedBy = validateGreenfieldStage(current, draft);
  return { current, may_advance: blockedBy.length === 0, blocked_by: blockedBy };
}

/** One formalization problem surfaced at the review stage (field + honest message). */
export interface GreenfieldFormalizationProblem {
  field: string;
  message: string;
}

/**
 * Map the draft onto the frozen MissionContent vocabulary. The mapping
 * is mechanical and honest: every draft input maps to the corresponding
 * Mission field with deterministic local ids (the Mission local-id
 * pattern is consumed from @sos-2/mission's own rules — kebab-case,
 * unique across the content).
 */
export function formalizeMissionContent(
  draft: GreenfieldJourneyDraft,
): { valid: boolean; content: MissionContent | null; problems: GreenfieldFormalizationProblem[] } {
  const problems: GreenfieldFormalizationProblem[] = [];
  if (draft.purpose === null || draft.purpose.trim().length === 0) {
    problems.push({ field: 'purpose', message: 'The mission needs a purpose before it can be formalized.' });
    return { valid: false, content: null, problems };
  }
  const usedIds = new Set<string>();
  const mintId = (base: string): string => {
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return id;
  };
  const slugify = (text: string, max: number): string => {
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max);
    return slug.length > 0 ? slug : 'item';
  };

  // Goals are minted per outcome (in outcome order), so the link back is
  // positional and deterministic.
  const goals: MissionContent['goals'] = [];
  const outcomeGoals: string[][] = draft.outcomes.map((outcome) => {
    const ids: string[] = [];
    for (const goalStatement of outcome.goals) {
      const id = mintId(slugify(goalStatement, 32));
      goals.push({ id, statement: goalStatement, status: 'PROPOSED', measures: [] });
      ids.push(id);
    }
    return ids;
  });
  const outcomes = draft.outcomes.map((outcome, index) => ({
    id: mintId(`outcome-${slugify(outcome.description, 24) || index + 1}`),
    description: outcome.description,
    goal_refs: outcomeGoals[index] ?? [],
  }));
  const stakeholders = draft.stakeholders.map((stakeholder, index) => ({
    id: mintId(`stakeholder-${slugify(stakeholder.name, 24) || index + 1}`),
    name: stakeholder.name,
    interest: stakeholder.interest,
  }));
  const measures = draft.measures.map((measure, index) => ({
    id: mintId(`measure-${slugify(measure.description, 24) || index + 1}`),
    description: measure.description,
    target: measure.target,
    unit: measure.unit,
  }));
  const constraints = draft.constraints.map((constraint, index) => ({
    id: mintId(`constraint-${slugify(constraint.statement, 24) || index + 1}`),
    statement: constraint.statement,
    hard: constraint.hard,
    bound: null,
  }));

  // Bind each outcome's first goal to the measure the user added for the
  // same slot (positional, deterministic): a goal with a measure becomes
  // MEASURABLE (the frozen MissionGoalStatus vocabulary — imported state
  // names, never redefined).
  draft.outcomes.forEach((_outcome, index) => {
    const ids = outcomeGoals[index] ?? [];
    const measure = measures[index];
    const firstGoalId = ids[0];
    if (measure !== undefined && firstGoalId !== undefined) {
      const goal = goals.find((candidate) => candidate.id === firstGoalId);
      if (goal !== undefined) {
        goal.measures = [...goal.measures, measure.id];
        goal.status = 'MEASURABLE';
      }
    }
  });

  const content: MissionContent = {
    purpose: draft.purpose,
    goals,
    outcomes,
    stakeholders,
    measures,
    assumptions: [],
    ambiguities: [],
    constraints,
  };
  try {
    validateMissionContent(content);
    return { valid: true, content, problems: [] };
  } catch (cause) {
    problems.push({ field: 'content', message: `The mission domain validator rejected this content: ${(cause as Error).message}` });
    return { valid: false, content: null, problems };
  }
}
