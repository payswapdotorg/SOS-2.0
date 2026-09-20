/**
 * The RISK x IRREVERSIBILITY ESCALATION MATRIX (Work Order W10 acceptance:
 * "high-risk/low-reversibility escalation").
 *
 * FROZEN MATRIX (total over the 4x3 grid — risk in {LOW, MODERATE, HIGH,
 * SEVERE} x reversibility in {REVERSIBLE, PARTIALLY_REVERSIBLE,
 * IRREVERSIBLE}; 12 cells, every cell deterministic):
 *
 *                          reversibility
 *   risk        REVERSIBLE   PARTIALLY_REVERSIBLE   IRREVERSIBLE
 *   LOW         -            -                      -
 *   MODERATE    -            -                      ESCALATE
 *   HIGH        -            ESCALATE               ESCALATE
 *   SEVERE      ESCALATE     ESCALATE               ESCALATE
 *
 *   ("-" = no matrix escalation)
 *
 * Rules (in words — the table above IS the norm):
 *   1. SEVERE risk escalates at ANY reversibility: catastrophic-risk actions
 *      always need an explicit authority decision.
 *   2. HIGH risk escalates unless the action is fully REVERSIBLE (the
 *      high-risk/low-reversibility corner: HIGH or SEVERE together with
 *      PARTIALLY_REVERSIBLE or IRREVERSIBLE).
 *   3. MODERATE risk escalates only when IRREVERSIBLE (moderate but
 *      permanent).
 *   4. LOW risk never escalates by the matrix (the escalation-matrix
 *      dimension is not the only gate — authority and evidence still apply).
 *
 * LOCKED INVARIANT (spec/architecture-lock.md forbidden shortcut: "confidence
 * alone authorizing risky changes"): when this matrix escalates, NOTHING
 * except an authority decision can de-escalate — in particular NO confidence
 * value (calibrated or not, 0.99 or 0.999999) is ever consulted. The matrix
 * is a pure function of (risk, reversibility).
 */

import { isAskRiskSeverity } from '@sos-2/authority';
import { AutonomyError } from './errors.js';
import { isReversibilityClass } from './levels.js';
import type { ReversibilityClass, RiskSeverity } from './levels.js';

/** Why the matrix escalated (structured, one code per rule). */
export const ESCALATION_CODES = [
  'RISK_IRREVERSIBILITY_ESCALATION',
] as const;

export type EscalationCode = (typeof ESCALATION_CODES)[number];

export interface EscalationOutcome {
  /** True iff this (risk, reversibility) cell escalates to ASK. */
  escalates: boolean;
  /** The escalation code, or null when the cell does not escalate. */
  code: EscalationCode | null;
  /** Human-readable deterministic reason (non-empty). */
  reason: string;
}

/** The full matrix as a total, frozen table (row = risk, column = reversibility). */
export const ESCALATION_MATRIX: Readonly<Record<RiskSeverity, Readonly<Record<ReversibilityClass, boolean>>>> = {
  LOW: {
    REVERSIBLE: false,
    PARTIALLY_REVERSIBLE: false,
    IRREVERSIBLE: false,
  },
  MODERATE: {
    REVERSIBLE: false,
    PARTIALLY_REVERSIBLE: false,
    IRREVERSIBLE: true,
  },
  HIGH: {
    REVERSIBLE: false,
    PARTIALLY_REVERSIBLE: true,
    IRREVERSIBLE: true,
  },
  SEVERE: {
    REVERSIBLE: true,
    PARTIALLY_REVERSIBLE: true,
    IRREVERSIBLE: true,
  },
};

/** Does this (risk, reversibility) pair escalate? (Total, deterministic.) */
export function escalates(risk: RiskSeverity, reversibility: ReversibilityClass): boolean {
  if (!isAskRiskSeverity(risk)) {
    throw new AutonomyError(
      `risk must be one of @sos-2/authority's frozen ASK risk severities [LOW, MODERATE, HIGH, SEVERE], received: ${JSON.stringify(risk)}`,
    );
  }
  if (!isReversibilityClass(reversibility)) {
    throw new AutonomyError(
      `reversibility must be one of [REVERSIBLE, PARTIALLY_REVERSIBLE, IRREVERSIBLE], received: ${JSON.stringify(reversibility)}`,
    );
  }
  return ESCALATION_MATRIX[risk][reversibility];
}

/**
 * The full deterministic escalation outcome for a (risk, reversibility)
 * cell: escalates + structured code + reason. The reason ALWAYS notes that
 * confidence is not consulted (the locked invariant, restated at the point
 * of escalation).
 */
export function escalationOutcome(risk: RiskSeverity, reversibility: ReversibilityClass): EscalationOutcome {
  const escalatesNow = escalates(risk, reversibility);
  if (!escalatesNow) {
    return {
      escalates: false,
      code: null,
      reason: `no matrix escalation: risk ${risk} with reversibility ${reversibility} (authority and evidence gates still apply)`,
    };
  }
  return {
    escalates: true,
    code: 'RISK_IRREVERSIBILITY_ESCALATION',
    reason:
      `risk ${risk} with reversibility ${reversibility} is in the escalation region of the risk x irreversibility matrix — ` +
      'the action escalates to ASK regardless of confidence (confidence is not authorization; spec/architecture-lock.md)',
  };
}

/** All (risk, reversibility) cells that escalate (deterministic order — tests enumerate coverage). */
export function escalationCells(): { risk: RiskSeverity; reversibility: ReversibilityClass; escalates: boolean }[] {
  const cells: { risk: RiskSeverity; reversibility: ReversibilityClass; escalates: boolean }[] = [];
  for (const risk of ['LOW', 'MODERATE', 'HIGH', 'SEVERE'] as const) {
    for (const reversibility of ['REVERSIBLE', 'PARTIALLY_REVERSIBLE', 'IRREVERSIBLE'] as const) {
      cells.push({ risk, reversibility, escalates: escalates(risk, reversibility) });
    }
  }
  return cells;
}
