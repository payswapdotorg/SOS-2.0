/**
 * The first-class state-block model (P1 task packet: "First-class state
 * components: loading, empty, unknown, unavailable, partial, error. Each
 * renders as a named state block — a page never shows a blank hole or a
 * fabricated default."; docs/ux/sharenet-inspired-design.md: "loading/error/
 * empty/unknown state blocks").
 *
 * Every product surface is in exactly one of two shapes:
 *   - READY with data (a projected view model), or
 *   - a named STATE BLOCK carrying what is known, what is NOT known, and
 *     what can happen next.
 *
 * THE EPISTEMIC DISCIPLINE (imported, never redefined): the frozen evidence
 * truth states from @sos-2/semantic-spine (SUCCESS, FAILURE, UNKNOWN,
 * UNAVAILABLE, UNSUPPORTED, PARTIAL) remain DISTINCT — the state-block kinds
 * UNKNOWN, UNAVAILABLE and PARTIAL mirror that distinctness on the UI side
 * and are never conflated with each other or with LOADING/EMPTY/ERROR. A
 * provider outage is UNAVAILABLE (the source cannot be reached); missing
 * knowledge is UNKNOWN (the answer is not known); incomplete coverage is
 * PARTIAL (some of the surface is present, some is missing — the missing
 * parts are LISTED, never silently dropped).
 *
 * STATUS TONES (docs/ux/sharenet-inspired-design.md "Status semantics"):
 * green = healthy/validated, amber = degraded/attention, red = blocked/
 * failure/rollback, neutral = inactive — and a SEPARATE epistemic treatment
 * (dashed outline, question glyph, explicit label) for UNKNOWN/UNAVAILABLE.
 * Tone is NEVER the only semantic channel: every chip and block renders a
 * text label and a glyph alongside the tone.
 *
 * Pure types + pure functions: deterministic, zero DOM dependencies.
 */

import { EVIDENCE_TRUTH_STATES } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { WebContractError } from './errors.js';

/** The six first-class state-block kinds (P1 task packet order). */
export const WEB_STATE_BLOCK_KINDS = [
  'LOADING',
  'EMPTY',
  'UNKNOWN',
  'UNAVAILABLE',
  'PARTIAL',
  'ERROR',
] as const;

export type WebStateBlockKind = (typeof WEB_STATE_BLOCK_KINDS)[number];

const STATE_BLOCK_KIND_SET: ReadonlySet<string> = new Set(WEB_STATE_BLOCK_KINDS);

export function isWebStateBlockKind(value: unknown): value is WebStateBlockKind {
  return typeof value === 'string' && STATE_BLOCK_KIND_SET.has(value);
}

/** The stable display order of state-block kinds (counts, legends, tests). */
export function stateBlockKindOrder(): WebStateBlockKind[] {
  return [...WEB_STATE_BLOCK_KINDS];
}

/** The surface tones of the warm-light design system (never color-only). */
export const WEB_STATUS_TONES = ['POSITIVE', 'CAUTION', 'NEGATIVE', 'NEUTRAL', 'EPISTEMIC'] as const;

export type WebStatusTone = (typeof WEB_STATUS_TONES)[number];

/**
 * The product-level condition vocabulary for summary chips (mission outcome
 * health, system condition). A PRESENTATION classification, not a domain
 * verdict: the domain vocabulary it summarizes (goal statuses, truth states)
 * is always displayed alongside, verbatim, with its basis. HEALTHY maps to
 * the green tone, DEGRADED to amber, BLOCKED to red, INACTIVE to neutral,
 * and UNKNOWN/UNAVAILABLE to the separate epistemic treatment — each with a
 * distinct label and glyph so no two conditions are distinguishable only by
 * color.
 */
export const PRODUCT_CONDITIONS = [
  'HEALTHY',
  'DEGRADED',
  'BLOCKED',
  'INACTIVE',
  'UNKNOWN',
  'UNAVAILABLE',
] as const;

export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number];

const PRODUCT_CONDITION_SET: ReadonlySet<string> = new Set(PRODUCT_CONDITIONS);

export function isProductCondition(value: unknown): value is ProductCondition {
  return typeof value === 'string' && PRODUCT_CONDITION_SET.has(value);
}

/** The tone of a product condition (never the only semantic channel). */
export function productConditionTone(condition: ProductCondition): WebStatusTone {
  switch (condition) {
    case 'HEALTHY':
      return 'POSITIVE';
    case 'DEGRADED':
      return 'CAUTION';
    case 'BLOCKED':
      return 'NEGATIVE';
    case 'INACTIVE':
      return 'NEUTRAL';
    case 'UNKNOWN':
    case 'UNAVAILABLE':
      return 'EPISTEMIC';
  }
}

/**
 * The tone of an evidence truth state. The truth state itself remains the
 * primary, displayed vocabulary (verbatim); the tone is an ADDITIONAL
 * channel. UNKNOWN, UNAVAILABLE and UNSUPPORTED all receive the separate
 * epistemic treatment while keeping their distinct labels and statements.
 */
export function evidenceTruthStateTone(state: EvidenceTruthState): WebStatusTone {
  switch (state) {
    case 'SUCCESS':
      return 'POSITIVE';
    case 'PARTIAL':
      return 'CAUTION';
    case 'FAILURE':
      return 'NEGATIVE';
    case 'UNKNOWN':
    case 'UNAVAILABLE':
    case 'UNSUPPORTED':
      return 'EPISTEMIC';
  }
}

/** The distinct, user-facing label of a truth state (displayed verbatim). */
export function evidenceTruthStateLabel(state: EvidenceTruthState): string {
  switch (state) {
    case 'SUCCESS':
      return 'Success';
    case 'FAILURE':
      return 'Failure';
    case 'UNKNOWN':
      return 'Unknown';
    case 'UNAVAILABLE':
      return 'Unavailable';
    case 'UNSUPPORTED':
      return 'Unsupported';
    case 'PARTIAL':
      return 'Partial';
  }
}

/** The distinct label of a product condition (displayed with tone + glyph). */
export function productConditionLabel(condition: ProductCondition): string {
  switch (condition) {
    case 'HEALTHY':
      return 'Healthy';
    case 'DEGRADED':
      return 'Needs attention';
    case 'BLOCKED':
      return 'Blocked';
    case 'INACTIVE':
      return 'Inactive';
    case 'UNKNOWN':
      return 'Unknown';
    case 'UNAVAILABLE':
      return 'Unavailable';
  }
}

/** All six truth states, in the frozen vocabulary order (legends, groups). */
export function allTruthStates(): EvidenceTruthState[] {
  return [...EVIDENCE_TRUTH_STATES];
}

/**
 * A named state block. `statement` says what IS known; for PARTIAL the
 * `present`/`missing` lists enumerate exactly what is there and what is not
 * (nothing silently dropped); `action` says what can happen next in this
 * state (never null for ERROR/UNAVAILABLE — an honest next step always
 * exists, even if it is only "retry" or "view what is known").
 */
export interface StateBlock {
  kind: WebStateBlockKind;
  /** The stable id of the surface this block stands in for (a11y + tests). */
  surface: string;
  /** What is known in this state (never fabricated, never blank). */
  statement: string;
  /** For PARTIAL only: the parts that are present (sorted, unique). */
  present: string[] | null;
  /** For PARTIAL only: the parts that are missing (sorted, unique; never empty). */
  missing: string[] | null;
  /** What can happen next from this state (a user-facing statement). */
  action: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Build a named state block (throws WebContractError). Total and validating:
 * PARTIAL requires non-empty present/missing lists; EMPTY/UNKNOWN/
 * UNAVAILABLE/ERROR require a non-empty statement; LOADING requires a
 * statement of what is being loaded. The result is always a complete,
 * nameable block — a surface can never render a blank hole.
 */
export function buildStateBlock(input: {
  kind: WebStateBlockKind;
  surface: string;
  statement: string;
  present?: readonly string[];
  missing?: readonly string[];
  action?: string | null;
}): StateBlock {
  if (!isWebStateBlockKind(input.kind)) {
    throw new WebContractError(
      `state block kind must be one of ${WEB_STATE_BLOCK_KINDS.join(', ')}, received: ${JSON.stringify(input.kind)}`,
    );
  }
  if (!isNonEmptyString(input.surface)) {
    throw new WebContractError('state block surface must be a non-empty surface id');
  }
  if (!isNonEmptyString(input.statement)) {
    throw new WebContractError(
      `state block statement for ${JSON.stringify(input.surface)} must be non-empty — a state block always says what is known`,
    );
  }
  let present: string[] | null = null;
  let missing: string[] | null = null;
  if (input.kind === 'PARTIAL') {
    if (!isStringArray(input.present) || input.present.length === 0) {
      throw new WebContractError('a PARTIAL state block must list at least one present part');
    }
    if (!isStringArray(input.missing) || input.missing.length === 0) {
      throw new WebContractError('a PARTIAL state block must list at least one missing part — partial coverage is never silent');
    }
    present = [...new Set(input.present)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    missing = [...new Set(input.missing)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  if (input.action !== undefined && input.action !== null && !isNonEmptyString(input.action)) {
    throw new WebContractError('state block action must be null or a non-empty statement');
  }
  if ((input.kind === 'ERROR' || input.kind === 'UNAVAILABLE') && (input.action === undefined || input.action === null)) {
    throw new WebContractError(
      `an ${input.kind} state block must carry an action — an honest next step always exists`,
    );
  }
  const block: StateBlock = {
    kind: input.kind,
    surface: input.surface,
    statement: input.statement,
    present,
    missing,
    action: input.action ?? null,
  };
  return block;
}

/** Validate a StateBlock (throws WebContractError). */
export function assertValidStateBlock(value: unknown): asserts value is StateBlock {
  if (!isPlainObject(value)) {
    throw new WebContractError(`state block must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['kind', 'surface', 'statement', 'present', 'missing', 'action']);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new WebContractError('state block must have the exact field set { kind, surface, statement, present, missing, action }');
  }
  if (!isWebStateBlockKind(record['kind'])) {
    throw new WebContractError(
      `state block kind must be one of ${WEB_STATE_BLOCK_KINDS.join(', ')}, received: ${JSON.stringify(record['kind'])}`,
    );
  }
  if (!isNonEmptyString(record['surface']) || !isNonEmptyString(record['statement'])) {
    throw new WebContractError('state block surface and statement must be non-empty strings');
  }
  if (record['kind'] === 'PARTIAL') {
    if (!isStringArray(record['present']) || record['present'].length === 0) {
      throw new WebContractError('a PARTIAL state block must carry a non-empty present list');
    }
    if (!isStringArray(record['missing']) || record['missing'].length === 0) {
      throw new WebContractError('a PARTIAL state block must carry a non-empty missing list');
    }
  } else {
    if (record['present'] !== null || record['missing'] !== null) {
      throw new WebContractError('only a PARTIAL state block carries present/missing lists');
    }
  }
  if (record['action'] !== null && !isNonEmptyString(record['action'])) {
    throw new WebContractError('state block action must be null or a non-empty string');
  }
}

/** The tone of a state-block kind (chips/legends; never color-only). */
export function stateBlockTone(kind: WebStateBlockKind): WebStatusTone {
  switch (kind) {
    case 'LOADING':
      return 'NEUTRAL';
    case 'EMPTY':
      return 'NEUTRAL';
    case 'UNKNOWN':
      return 'EPISTEMIC';
    case 'UNAVAILABLE':
      return 'EPISTEMIC';
    case 'PARTIAL':
      return 'CAUTION';
    case 'ERROR':
      return 'NEGATIVE';
  }
}

/** The distinct user-facing label of a state-block kind. */
export function stateBlockLabel(kind: WebStateBlockKind): string {
  switch (kind) {
    case 'LOADING':
      return 'Loading';
    case 'EMPTY':
      return 'Nothing here yet';
    case 'UNKNOWN':
      return 'Not known yet';
    case 'UNAVAILABLE':
      return 'Unavailable';
    case 'PARTIAL':
      return 'Partially available';
    case 'ERROR':
      return 'Something went wrong';
  }
}
