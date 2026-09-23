import { scopeFor } from './actions.js';
import type { ActionFamily, ActionRequest } from './actions.js';
import type { ActorRef, Timestamp } from './types.js';

export type AuthorityReason =
  | 'GRANTED'
  | 'GRANT_REVOKED'
  | 'GRANT_EXPIRED'
  | 'GRANT_NEVER_HELD'
  | 'SCOPE_EXCEEDED';

export interface AuthoritySnapshot {
  readonly granted: boolean;
  readonly reason: AuthorityReason;
  readonly grantId: string | null;
  readonly evaluatedAt: Timestamp;
  readonly detail: string;
}

export interface AuthorityQuery {
  readonly actor: ActorRef;
  readonly family: ActionFamily;
  readonly scope: string;
  /**
   * Identifier of a grant cited at planning time, if any. INFORMATIONAL ONLY:
   * a grant held at planning time is NEVER sufficient — the snapshot returned
   * by evaluateCurrent at action time is the sole execution authority.
   */
  readonly planningGrantId?: string;
}

/** The P6 orchestrator surface hands this in; it carries no authority itself. */
export interface PlanningRef {
  readonly planId?: string;
  readonly planningGrantId?: string;
}

export type HardDenialReason = 'ACTION_AUTHORITY_DENIED' | 'ACTION_VALIDATION_REJECTED';

export interface ActionDenial {
  readonly reason: HardDenialReason;
  readonly authority: AuthoritySnapshot | null;
  readonly detail: string;
}

export interface AuthorityPort {
  evaluateCurrent(query: AuthorityQuery, now: Timestamp): AuthoritySnapshot;
}

export function authorityQueryFor(request: ActionRequest, planning: PlanningRef | undefined): AuthorityQuery {
  return {
    actor: request.actor,
    family: request.family,
    scope: scopeFor(request),
    ...(planning?.planningGrantId !== undefined ? { planningGrantId: planning.planningGrantId } : {}),
  };
}
