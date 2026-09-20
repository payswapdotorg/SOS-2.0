/**
 * The autonomy POLICY TABLE — the default required autonomy level for each
 * (action kind x blast radius) pair.
 *
 * ACTION KINDS are the frozen @sos-2/authority grant permissions (READ,
 * REVISE, RETIRE, PROMOTE, DELEGATE) — CONSUMED, never redefined: these are
 * the authority-relevant acts an autonomous actor can request, and using the
 * frozen permission vocabulary means one action vocabulary, not two (no
 * second authority — AGENTS.md section 4).
 *
 * The table (documented, frozen; blast radii ordered COMPONENT < SERVICE <
 * SYSTEM < ORGANIZATION):
 *
 *   action    COMPONENT              SERVICE               SYSTEM          ORGANIZATION
 *   READ      AUTONOMOUS_LOW_RISK    AUTONOMOUS_LOW_RISK   BOUNDED         BOUNDED
 *   REVISE    BOUNDED                BOUNDED               BOUNDED         SUPERVISED
 *   RETIRE    BOUNDED                BOUNDED               SUPERVISED      SUPERVISED
 *   PROMOTE   BOUNDED                BOUNDED               SUPERVISED      SUPERVISED
 *   DELEGATE  BOUNDED                BOUNDED               SUPERVISED      SUPERVISED
 *
 * Rationale (documented):
 *   - READ is the least consequential act: autonomous at small blast radii
 *     while the risk profile stays low (the escalation matrix still applies),
 *     bounded once the blast radius reaches the whole system/organization.
 *   - REVISE creates new artifact revisions: bounded at every sub-organization
 *     scope (a grant bounds the revision rights), supervised at organization
 *     breadth.
 *   - RETIRE, PROMOTE and DELEGATE are terminal/lifecycle/authority-flowing
 *     acts: bounded at component/service scope, supervised at system and
 *     organization breadth — every execution needs its own authority
 *     decision there.
 *
 * An action's EFFECTIVE required level is the table default RAISED by any
 * applicable, grant-backed autonomy raise artifact (raise.ts); raises only
 * ever increase autonomy and never outlive their authorizing grant.
 */

import { GRANT_PERMISSIONS, isGrantPermission } from '@sos-2/authority';
import type { GrantPermission } from '@sos-2/authority';
import { AutonomyError } from './errors.js';
import { BLAST_RADII, isBlastRadius } from './levels.js';
import type { AutonomyLevel, BlastRadius } from './levels.js';

/** The action-kind vocabulary is authority's frozen permission set (consumed). */
export const AUTONOMY_ACTION_KINDS = GRANT_PERMISSIONS;

export type AutonomyActionKind = GrantPermission;

export type AutonomyPolicyTable = Readonly<
  Record<AutonomyActionKind, Readonly<Record<BlastRadius, AutonomyLevel>>>
>;

/** The frozen default required-level table (see module doc for rationale). */
export const REQUIRED_LEVEL_TABLE: AutonomyPolicyTable = {
  READ: {
    COMPONENT: 'AUTONOMOUS_LOW_RISK',
    SERVICE: 'AUTONOMOUS_LOW_RISK',
    SYSTEM: 'BOUNDED',
    ORGANIZATION: 'BOUNDED',
  },
  REVISE: {
    COMPONENT: 'BOUNDED',
    SERVICE: 'BOUNDED',
    SYSTEM: 'BOUNDED',
    ORGANIZATION: 'SUPERVISED',
  },
  RETIRE: {
    COMPONENT: 'BOUNDED',
    SERVICE: 'BOUNDED',
    SYSTEM: 'SUPERVISED',
    ORGANIZATION: 'SUPERVISED',
  },
  PROMOTE: {
    COMPONENT: 'BOUNDED',
    SERVICE: 'BOUNDED',
    SYSTEM: 'SUPERVISED',
    ORGANIZATION: 'SUPERVISED',
  },
  DELEGATE: {
    COMPONENT: 'BOUNDED',
    SERVICE: 'BOUNDED',
    SYSTEM: 'SUPERVISED',
    ORGANIZATION: 'SUPERVISED',
  },
};

/**
 * The DEFAULT required autonomy level for an (action kind, blast radius)
 * pair. Throws AutonomyError on out-of-vocabulary input (loud, total).
 */
export function requiredLevel(actionKind: AutonomyActionKind, blastRadius: BlastRadius): AutonomyLevel {
  if (!isGrantPermission(actionKind)) {
    throw new AutonomyError(
      `action kind must be one of the frozen authority permissions [${GRANT_PERMISSIONS.join(', ')}], received: ${JSON.stringify(actionKind)}`,
    );
  }
  if (!isBlastRadius(blastRadius)) {
    throw new AutonomyError(
      `blast radius must be one of [${BLAST_RADII.join(', ')}], received: ${JSON.stringify(blastRadius)}`,
    );
  }
  return REQUIRED_LEVEL_TABLE[actionKind][blastRadius];
}
