/**
 * THE REFERENCE AUTHORITY APPROVAL (Work Order P13) — the deterministic
 * stand-in behind the AuthorityApprovalPort seam.
 *
 * "Approve required authority" (acceptance step 3) is a HUMAN action:
 * the journey surfaces its typed AuthorityRequirement and parks; the
 * user approves; the approval mints:
 *
 *   1. a SPINE AuthorityGrantArtifact (@sos-2/authority createGrant —
 *      the semantic authority every task node carries as authority_ref),
 *      stored durably in the P2 authority-grant repository; and
 *   2. the ACTION-TIME authority for the journey's acting principal —
 *      the grants the P9 gateway's AuthorityPort re-evaluates on EVERY
 *      consequential action (commit/push/pull-request/deployment/
 *      rollback, per family and scope).
 *
 * The port itself grants nothing implicitly: an approval is an explicit,
 * caller-supplied record naming WHO approved. A revoked or expired
 * action-time grant still fails closed at action time — a planning-time
 * approval is never sufficient (the P9 rule).
 */

import type { ActionFamily, ActorRef, AuthorityPort } from '@sos-2/action-gateway';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import type { AuthorityGrantRepository, Clock } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import type { AuthorityRequirement } from '../types.js';

/** The approval surface the journey calls after the user decides. */
export interface AuthorityApprovalPort {
  /**
   * Mint the authority for an approved requirement: the spine grant
   * (semantic) + the action-time grants (gateway). Returns the grant
   * artifact.
   */
  approve(input: {
    readonly requirement: AuthorityRequirement;
    readonly actor: ActorRef;
    readonly approvedBy: string;
  }): Promise<AuthorityGrantArtifact>;
}

/**
 * The P9 reference authority port split: evaluation (AuthorityPort) plus
 * GRANT REGISTRATION. The InMemoryAuthority of @sos-2/action-gateway
 * implements both (grant/revoke + evaluateCurrent); the journey's
 * composition injects it here so approvals register action-time grants
 * through the SAME object the gateway re-evaluates at action time.
 */
export interface GrantingAuthorityPort extends AuthorityPort {
  /** Register a grant for actor|family|scope (the reference port's grant()). */
  grantFor(actorId: string, family: ActionFamily, scope: string, options?: { grantId?: string }): string;
}

/** Reference approval dependencies. */
export interface ReferenceAuthorityApprovalDeps {
  /** The durable P2 authority-grant repository (the spine grant's home). */
  readonly authorityGrants: AuthorityGrantRepository;
  /** The P9 granting authority port (action-time re-evaluation + registration). */
  readonly gatewayAuthority: GrantingAuthorityPort;
  readonly clock: Clock;
  /** Grant duration in milliseconds (default 24h from the injected clock). */
  readonly grantDurationMs?: number;
  /** Provenance stamped on the minted grant. */
  readonly provenance?: readonly string[];
}

export class ReferenceAuthorityApproval implements AuthorityApprovalPort {
  private readonly authorityGrants: AuthorityGrantRepository;
  private readonly gatewayAuthority: GrantingAuthorityPort;
  private readonly clock: Clock;
  private readonly grantDurationMs: number;
  private readonly provenance: readonly string[];

  constructor(deps: ReferenceAuthorityApprovalDeps) {
    if (
      typeof deps !== 'object' ||
      deps === null ||
      typeof deps.authorityGrants !== 'object' ||
      deps.authorityGrants === null ||
      typeof deps.gatewayAuthority !== 'object' ||
      deps.gatewayAuthority === null ||
      typeof deps.gatewayAuthority.grantFor !== 'function' ||
      typeof deps.clock !== 'object' ||
      deps.clock === null ||
      typeof deps.clock.nowEpochMs !== 'function'
    ) {
      throw new TypeError('ReferenceAuthorityApproval requires the P2 grant repository, the P9 granting authority port and an injected clock');
    }
    this.authorityGrants = deps.authorityGrants;
    this.gatewayAuthority = deps.gatewayAuthority;
    this.clock = deps.clock;
    this.grantDurationMs = deps.grantDurationMs ?? 86_400_000;
    this.provenance = [...(deps.provenance ?? ['p13-reference-authority-approval'])];
  }

  async approve(input: {
    readonly requirement: AuthorityRequirement;
    readonly actor: ActorRef;
    readonly approvedBy: string;
  }): Promise<AuthorityGrantArtifact> {
    if (typeof input.approvedBy !== 'string' || input.approvedBy.length === 0) {
      throw new TypeError('an approval must name WHO approved it (the human/authority identity) — never an anonymous grant');
    }
    const now = this.clock.nowEpochMs();

    // 1. The spine grant — the semantic authority the task nodes carry.
    const grant = createGrant({
      grantee: `journey-acting-principal:${input.actor.id}`,
      scope: { kind: 'KIND', artifact_kind: 'Mission' },
      permissions: ['READ', 'REVISE'],
      expiry: { kind: 'TIME', at: formatRfc3339(now + this.grantDurationMs) },
      provenance: [...this.provenance, `approved-by:${input.approvedBy}`],
      created_at: formatRfc3339(now),
      status: 'ACTIVE',
    });
    const put = await this.authorityGrants.put(grant);
    if (put.kind !== 'STORED' && put.kind !== 'IDENTICAL') {
      throw new Error(`the authority grant write lost the durable race (${put.kind}) — the approval is not recorded; retry`);
    }

    // 2. The action-time grants (per family + scope) for the acting
    //    principal — re-evaluated by the gateway on EVERY action.
    for (const entry of input.requirement.scopes) {
      this.gatewayAuthority.grantFor(input.actor.id, entry.family, entry.scope);
    }

    return grant;
  }
}
