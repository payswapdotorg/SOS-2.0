/**
 * Body health lifecycle (Work Order P5).
 *
 * AVAILABLE -> SUSPENDED (broker suspends the body; its ACTIVE leases are
 * revoked — the TASK survives and takes a replacement body)
 * SUSPENDED -> AVAILABLE (resume)
 * AVAILABLE | SUSPENDED -> RELEASED (terminal: a released body never
 * returns; a replacement registers under a NEW body id).
 *
 * RELEASED is terminal — mirrored from the P2 lease discipline (a
 * released/revoked/expired lease never reactivates).
 */

import { InvalidBodyRecordError } from './errors.js';
import type { BodyHealth } from './body-identity.js';
import { BODY_HEALTH_STATES } from './body-identity.js';

/** The typed body health transition table (RELEASED terminal). */
export const ALLOWED_BODY_HEALTH_TRANSITIONS: Readonly<Record<BodyHealth, readonly BodyHealth[]>> = {
  AVAILABLE: ['SUSPENDED', 'RELEASED'],
  SUSPENDED: ['AVAILABLE', 'RELEASED'],
  RELEASED: [],
};

/** Is the from -> to health transition legal? */
export function canTransitionBodyHealth(from: BodyHealth, to: BodyHealth): boolean {
  return ALLOWED_BODY_HEALTH_TRANSITIONS[from]?.includes(to) === true;
}

/**
 * Validate a health transition and return the target state. Invalid
 * transitions (releasing a released body, "resurrecting" a released
 * body, unknown states) throw loudly.
 */
export function transitionBodyHealth(from: BodyHealth, to: BodyHealth): BodyHealth {
  if (!BODY_HEALTH_STATES.includes(from)) {
    throw new InvalidBodyRecordError('body-health', `unknown body health state: ${JSON.stringify(from)}`);
  }
  if (!BODY_HEALTH_STATES.includes(to)) {
    throw new InvalidBodyRecordError('body-health', `unknown body health state: ${JSON.stringify(to)}`);
  }
  if (!canTransitionBodyHealth(from, to)) {
    throw new InvalidBodyRecordError(
      'body-health',
      `invalid body health transition: ${from} -> ${to} (RELEASED is terminal — a released body never returns; register a replacement under a new body id)`,
    );
  }
  return to;
}

/** Is this health state one a task's lease may bind to? (Only AVAILABLE bodies are selectable.) */
export function isSelectableHealth(state: BodyHealth): boolean {
  return state === 'AVAILABLE';
}
