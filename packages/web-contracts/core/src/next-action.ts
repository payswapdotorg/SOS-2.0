/**
 * The next-allowed-action view and its gating rule — the single most
 * consequential element of the hero ("NEXT ALLOWED ACTION", P1 task packet)
 * and the "What can happen next?" product review question.
 *
 * The gating rule is a PURE PRESENTATION rule: it decides how an action is
 * PRESENTED (enabled navigation, needs-authority, needs-human-decision, or
 * not-yet-available), it never evaluates grants (that is @sos-2/authority's)
 * and never executes anything. Two honesty rules are structural:
 *
 *   - a pending ASK outranks every autonomous next step (a question SOS
 *     cannot answer with evidence is the first thing the user should see);
 *   - an EXECUTE action backed by the DEMO dataset is NEVER presented as
 *     executable — real execution is wired by the execution-fabric Work
 *     Orders (P9 actions/evaluation, P12 continuous autonomy), so the demo
 *     presents it as an explanation with its authority requirements, never
 *     as a fake button.
 */

import type { GrantPermission } from '@sos-2/authority';
import type { DataSource } from './data-source.js';
import { WebContractError } from './errors.js';

/** The kinds of next actions a product surface can offer. */
export type NextActionKind = 'NAVIGATE' | 'REVIEW' | 'DECIDE' | 'EXECUTE';

/**
 * The next allowed action view carried by every consequential product view
 * model. `href` is an in-app route when the action is a navigation;
 * `rationale_ref` is the spine subject whose rationale view explains WHY
 * this is the next allowed action.
 */
export interface NextActionView {
  /** Stable action id (a11y references and tests). */
  action_id: string;
  /** The kind of action (drives gating). */
  kind: NextActionKind;
  /** User-facing label. */
  label: string;
  /** What happens when this action is taken (one honest sentence). */
  description: string;
  /** In-app route for navigation/review actions, or null. */
  href: string | null;
  /** The spine subject id whose rationale view explains this action, or null. */
  rationale_ref: string | null;
  /** The frozen permission this action requires, or null when none is required. */
  requires_authority: GrantPermission | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate a NextActionView (throws WebContractError). */
export function assertValidNextActionView(value: unknown): asserts value is NextActionView {
  if (!isPlainObject(value)) {
    throw new WebContractError(`next action view must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['action_id', 'kind', 'label', 'description', 'href', 'rationale_ref', 'requires_authority']);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new WebContractError(
      'next action view must have the exact field set { action_id, kind, label, description, href, rationale_ref, requires_authority }',
    );
  }
  if (!isNonEmptyString(record['action_id'])) {
    throw new WebContractError('next action view action_id must be a non-empty stable id');
  }
  const kind = record['kind'];
  if (kind !== 'NAVIGATE' && kind !== 'REVIEW' && kind !== 'DECIDE' && kind !== 'EXECUTE') {
    throw new WebContractError(
      `next action view kind must be NAVIGATE, REVIEW, DECIDE or EXECUTE, received: ${JSON.stringify(kind)}`,
    );
  }
  if (!isNonEmptyString(record['label']) || !isNonEmptyString(record['description'])) {
    throw new WebContractError('next action view label and description must be non-empty strings');
  }
  if (record['href'] !== null && !isNonEmptyString(record['href'])) {
    throw new WebContractError('next action view href must be null or a non-empty in-app route');
  }
  if (record['rationale_ref'] !== null && !isNonEmptyString(record['rationale_ref'])) {
    throw new WebContractError('next action view rationale_ref must be null or a spine subject id');
  }
  if (record['requires_authority'] !== null && typeof record['requires_authority'] !== 'string') {
    throw new WebContractError('next action view requires_authority must be a permission string or null');
  }
}

/** How an action is presented after gating (a presentation state, never an execution). */
export type ActionAvailability =
  | { kind: 'ENABLED'; reason: string }
  | { kind: 'NEEDS_HUMAN_DECISION'; ask_ref: string; reason: string }
  | { kind: 'NEEDS_AUTHORITY'; required_permission: GrantPermission; reason: string }
  | { kind: 'NOT_AVAILABLE_IN_DEMO'; reason: string };

/**
 * The pure gating rule (deterministic, total). Priority order:
 *   1. DECIDE actions with a pending ASK -> NEEDS_HUMAN_DECISION (an
 *      irreducible question outranks everything);
 *   2. EXECUTE actions on a DEMO-backed surface -> NOT_AVAILABLE_IN_DEMO
 *      (never a fake button; the reason names what the action needs);
 *   3. EXECUTE/DECIDE actions requiring a permission -> NEEDS_AUTHORITY;
 *   4. NAVIGATE/REVIEW -> ENABLED.
 */
export function gateNextAction(input: {
  action: NextActionView;
  data_source: DataSource;
  pending_ask_ref?: string | null;
  grant_held?: boolean;
}): ActionAvailability {
  assertValidNextActionView(input.action);
  const { action } = input;
  if (action.kind === 'DECIDE' && input.pending_ask_ref) {
    return {
      kind: 'NEEDS_HUMAN_DECISION',
      ask_ref: input.pending_ask_ref,
      reason: 'A question SOS cannot answer with evidence is waiting for a human decision.',
    };
  }
  if (action.kind === 'EXECUTE') {
    if (input.data_source.kind === 'DEMO') {
      return {
        kind: 'NOT_AVAILABLE_IN_DEMO',
        reason:
          'This surface shows simulated data. Real execution is wired when the live execution fabric is connected; the authority requirement is shown so the real action can be prepared.',
      };
    }
    if (action.requires_authority !== null && input.grant_held !== true) {
      return {
        kind: 'NEEDS_AUTHORITY',
        required_permission: action.requires_authority,
        reason: `This action requires the ${action.requires_authority} permission; no active grant covers it yet.`,
      };
    }
  }
  return {
    kind: 'ENABLED',
    reason: action.kind === 'NAVIGATE' || action.kind === 'REVIEW'
      ? 'Navigation and review are always available.'
      : 'The required authority is held; the action can proceed.',
  };
}

/** The distinct user-facing label of an availability kind. */
export function actionAvailabilityLabel(availability: ActionAvailability): string {
  switch (availability.kind) {
    case 'ENABLED':
      return 'Available now';
    case 'NEEDS_HUMAN_DECISION':
      return 'Needs your decision';
    case 'NEEDS_AUTHORITY':
      return `Needs ${availability.required_permission} authority`;
    case 'NOT_AVAILABLE_IN_DEMO':
      return 'Explained, not executable in the demo';
  }
}
