/**
 * Reconciliation — observed revisions vs System State claims.
 *
 * The System State is consumed through a READ-ONLY claims port (the
 * composition wires the real reader later; observation NEVER writes
 * semantic truth — work-order acceptance: "observation does not mutate
 * semantic truth outside authoritative domain stores").
 *
 * Every comparison produces a typed finding:
 *   ALIGNED     — the observation confirms the claim (fresh evidence)
 *   DIVERGED    — both present, revisions differ (expected vs observed)
 *   UNVERIFIED  — no observation exists for the claim's subject
 *   STALE       — an observation exists but is older than the freshness
 *                 window (stale is NEVER reported as aligned or as
 *                 diverged — it is its own truthful state)
 */

import type { FreshnessMark } from './projection.js';

/** A semantic claim about a subject's current revision (read-only view). */
export interface StateRevisionClaim {
  /** Subject key — the same key space the observation wiring uses. */
  readonly subject: string;
  /** The revision the System State claims is current. */
  readonly claimedRevision: string;
  /** Where the claim came from (provenance string). */
  readonly claimRef: string;
}

/** The read-only port through which claims enter reconciliation. */
export interface SystemStateClaimsPort {
  readClaims(): Promise<readonly StateRevisionClaim[]>;
}

/** What observation currently sees for a claim's subject (or nothing). */
export interface ObservedRevision {
  readonly subject: string;
  readonly revision: string | null;
  readonly lastEventAt: string | null;
  readonly freshness: FreshnessMark;
  /** Event ids that produced this observation (evidence binding). */
  readonly evidenceEventIds: readonly string[];
}

export type ReconciliationFindingKind = 'ALIGNED' | 'DIVERGED' | 'UNVERIFIED' | 'STALE';

export interface ReconciliationFinding {
  /** Deterministic finding id: `reconciliation:<subject>`. */
  readonly findingId: string;
  readonly kind: ReconciliationFindingKind;
  readonly subject: string;
  readonly claimedRevision: string;
  readonly observedRevision: string | null;
  readonly observedAt: string | null;
  readonly evidenceEventIds: readonly string[];
  readonly claimRef: string;
  readonly detectedAt: string;
}

/**
 * Reconcile every claim against its observed revision. Deterministic:
 * findings in claim order; UNVERIFIED when no observation is wired for
 * the claim's subject.
 */
export function reconcileClaims(claims: readonly StateRevisionClaim[], observed: readonly ObservedRevision[], detectedAt: string): readonly ReconciliationFinding[] {
  const bySubject = new Map(observed.map((entry) => [entry.subject, entry]));
  return claims.map((claim) => {
    const seen = bySubject.get(claim.subject);
    if (seen === undefined || seen.revision === null) {
      return finding(claim, null, null, [], 'UNVERIFIED', detectedAt);
    }
    if (seen.freshness.state === 'STALE') {
      return finding(claim, seen.revision, seen.lastEventAt, seen.evidenceEventIds, 'STALE', detectedAt);
    }
    if (seen.freshness.state === 'NO_DATA') {
      return finding(claim, null, null, [], 'UNVERIFIED', detectedAt);
    }
    if (seen.revision === claim.claimedRevision) {
      return finding(claim, seen.revision, seen.lastEventAt, seen.evidenceEventIds, 'ALIGNED', detectedAt);
    }
    return finding(claim, seen.revision, seen.lastEventAt, seen.evidenceEventIds, 'DIVERGED', detectedAt);
  });
}

function finding(
  claim: StateRevisionClaim,
  observedRevision: string | null,
  observedAt: string | null,
  evidenceEventIds: readonly string[],
  kind: ReconciliationFindingKind,
  detectedAt: string,
): ReconciliationFinding {
  return {
    findingId: `reconciliation:${claim.subject}`,
    kind,
    subject: claim.subject,
    claimedRevision: claim.claimedRevision,
    observedRevision,
    observedAt,
    evidenceEventIds,
    claimRef: claim.claimRef,
    detectedAt,
  };
}
