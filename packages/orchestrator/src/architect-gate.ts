/**
 * THE ARCHITECT GATE (Work Order P6) — the architect role as a GOVERNED
 * SOS CONTROL FUNCTION.
 *
 * Consequential transitions (merge / promote / deploy-class — including
 * mission completion) pass through a typed ArchitectGateRecord carrying
 * THE AUTHORITY REFERENCE THE GATE ACTED UNDER. The gate itself is
 * governed:
 *
 *   - RECORDED: every decision lands in an append-only log (auditable);
 *   - BOUNDED: the gate approves ONLY under an authority reference that
 *     resolves in the durable AuthorityGrantRepository and is VALID at
 *     the injected instant (the @sos-2/authority evaluateGrant
 *     discipline, consumed — never re-implemented);
 *   - CANNOT MINT AUTHORITY: an unresolvable, expired or revoked
 *     authority reference is a typed ArchitectGateViolationError naming
 *     the rule and the field — the gate never invents, widens or carries
 *     authority it was not granted.
 */

import { evaluateGrant } from '@sos-2/authority';
import type { AuthorityGrantRepository } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import { contentHash } from '@sos-2/semantic-spine';
import { ArchitectGateViolationError } from './errors.js';

/** The consequential transition classes the gate governs. */
export const ARCHITECT_GATE_TRANSITIONS = ['MERGE', 'PROMOTE', 'DEPLOY', 'MISSION_COMPLETION'] as const;
export type ArchitectGateTransition = (typeof ARCHITECT_GATE_TRANSITIONS)[number];

/** The typed architect gate record (governed control function). */
export interface ArchitectGateRecord {
  /** Content-derived deterministic id ('gate:' + 24 hex). */
  readonly gate_id: string;
  readonly transition: ArchitectGateTransition;
  /** What the gate governs (mission ref / task id / subject ref). */
  readonly subject_ref: string;
  /** THE authority reference the gate acted under (required — never minted). */
  readonly authority_ref: string;
  readonly decision: 'APPROVED' | 'DENIED';
  readonly rationale: string;
  readonly recorded_at: string;
  /** STRUCTURAL marker: the decision is recorded, bounded and non-minting. */
  readonly governed: true;
}

/** Gate dependencies: the durable authority store + the injected clock. */
export interface ArchitectGateDeps {
  readonly authorityGrants: AuthorityGrantRepository;
  readonly clock: Clock;
}

/** The approval request input. */
export interface GateApprovalRequest {
  readonly transition: ArchitectGateTransition;
  readonly subject_ref: string;
  readonly authority_ref: string;
  readonly rationale: string;
}

/**
 * THE ARCHITECT GATE.
 */
export class ArchitectGate {
  private readonly authorityGrants: AuthorityGrantRepository;
  private readonly clock: Clock;
  private readonly log: ArchitectGateRecord[] = [];

  constructor(deps: ArchitectGateDeps) {
    if (
      typeof deps !== 'object' ||
      deps === null ||
      typeof deps.authorityGrants !== 'object' ||
      deps.authorityGrants === null ||
      typeof deps.clock !== 'object' ||
      deps.clock === null ||
      typeof deps.clock.nowEpochMs !== 'function'
    ) {
      throw new ArchitectGateViolationError('gate-ports-required', 'deps', 'the ArchitectGate requires the durable authority grant repository and an injected clock');
    }
    this.authorityGrants = deps.authorityGrants;
    this.clock = deps.clock;
  }

  /** The decision log (append-only audit, deterministic order). */
  decisions(): readonly ArchitectGateRecord[] {
    return this.log.map((record) => ({ ...record }));
  }

  /**
   * Request approval for a consequential transition. The gate CANNOT
   * mint authority: the authority reference must resolve in the durable
   * store and be VALID at the injected instant — otherwise a typed
   * violation naming the rule ('architect-authority-required').
   */
  async requestApproval(request: GateApprovalRequest): Promise<ArchitectGateRecord> {
    if (!ARCHITECT_GATE_TRANSITIONS.includes(request.transition)) {
      throw new ArchitectGateViolationError(
        'gate-transition-vocabulary',
        'transition',
        `the gate governs ${ARCHITECT_GATE_TRANSITIONS.join(' | ')} transitions, received ${JSON.stringify(request.transition)}`,
      );
    }
    if (typeof request.subject_ref !== 'string' || request.subject_ref.length === 0) {
      throw new ArchitectGateViolationError('gate-subject-required', 'subject_ref', 'the gate requires the subject it governs');
    }
    if (typeof request.rationale !== 'string' || request.rationale.length === 0) {
      throw new ArchitectGateViolationError('gate-rationale-required', 'rationale', 'every gate decision carries a non-empty rationale (auditable)');
    }
    if (typeof request.authority_ref !== 'string' || request.authority_ref.length === 0) {
      throw new ArchitectGateViolationError(
        'architect-authority-required',
        'authority_ref',
        'the architect gate REQUIRES the authority reference it acts under — the gate cannot mint, widen or carry authority it was not granted',
      );
    }
    // The authority resolves from the DURABLE store ONLY.
    const grant = await this.authorityGrants.get(request.authority_ref);
    if (grant === undefined) {
      throw new ArchitectGateViolationError(
        'architect-authority-required',
        'authority_ref',
        `authority ${JSON.stringify(request.authority_ref)} is not in the durable authority store — a forged or minted reference authorizes nothing (the gate cannot mint authority)`,
      );
    }
    const now = formatRfc3339(this.clock.nowEpochMs());
    const status = evaluateGrant(grant, { kind: 'TIME', now });
    if (status === 'EXPIRED') {
      throw new ArchitectGateViolationError(
        'architect-authority-required',
        'authority_ref',
        `authority ${JSON.stringify(request.authority_ref)} is EXPIRED at ${JSON.stringify(now)} — expired grants never authorize, and the gate cannot revive them`,
      );
    }
    if (status === 'REVOKED') {
      throw new ArchitectGateViolationError(
        'architect-authority-required',
        'authority_ref',
        `authority ${JSON.stringify(request.authority_ref)} is REVOKED — revoked grants never authorize, and the gate cannot revive them`,
      );
    }
    const record: ArchitectGateRecord = {
      gate_id: `gate:${contentHash({
        transition: request.transition,
        subject_ref: request.subject_ref,
        authority_ref: request.authority_ref,
        rationale: request.rationale,
        recorded_at: now,
      }).slice(0, 24)}`,
      transition: request.transition,
      subject_ref: request.subject_ref,
      authority_ref: request.authority_ref,
      decision: 'APPROVED',
      rationale: request.rationale,
      recorded_at: now,
      governed: true,
    };
    this.log.push(record);
    return { ...record };
  }
}

/** Validate an ArchitectGateRecord (throws typed on forged shapes). */
export function assertValidArchitectGateRecord(value: unknown): asserts value is ArchitectGateRecord {
  if (typeof value !== 'object' || value === null) {
    throw new ArchitectGateViolationError('gate-record-shape', 'record', 'an architect gate record must be an object');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 8 ||
    typeof record['gate_id'] !== 'string' ||
    !String(record['gate_id']).startsWith('gate:') ||
    !ARCHITECT_GATE_TRANSITIONS.includes(record['transition'] as ArchitectGateTransition) ||
    typeof record['subject_ref'] !== 'string' ||
    typeof record['authority_ref'] !== 'string' ||
    (record['decision'] !== 'APPROVED' && record['decision'] !== 'DENIED') ||
    typeof record['rationale'] !== 'string' ||
    typeof record['recorded_at'] !== 'string' ||
    record['governed'] !== true
  ) {
    throw new ArchitectGateViolationError(
      'gate-record-shape',
      'record',
      'an architect gate record must be { gate_id, transition, subject_ref, authority_ref, decision, rationale, recorded_at, governed: true } — governed control decisions are recorded, bounded and non-minting',
    );
  }
}
