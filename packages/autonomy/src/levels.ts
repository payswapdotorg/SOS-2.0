/**
 * The autonomy LEVEL ladder and its typed scope vocabulary.
 *
 * FROZEN LADDER (documented, total order by rank):
 *
 *   rank 0  SUPERVISED           — the most restrictive level. An action
 *                                  requiring SUPERVISED may be permitted ONLY
 *                                  by a currently-valid grant covering it AND
 *                                  an EXPLICIT authority decision for this
 *                                  specific request (a spine-referenced
 *                                  Decision taken by the competent authority).
 *                                  Grants alone NEVER permit a SUPERVISED
 *                                  action: they bound it, but every single
 *                                  execution needs its own decision.
 *
 *   rank 1  BOUNDED              — an action requiring BOUNDED is permitted by
 *                                  a currently-valid AuthorityGrant covering
 *                                  it (scope + permission) — autonomy is
 *                                  bounded by the grant's explicit scope,
 *                                  permission set and expiry. This is the
 *                                  W1/R15 model ("autonomy is bounded by
 *                                  explicit, evaluable grants").
 *
 *   rank 2  AUTONOMOUS_LOW_RISK  — the least restrictive level. Identical
 *                                  grant requirement to BOUNDED, PLUS the
 *                                  action's risk profile must sit in the
 *                                  autonomous-safe region of the risk x
 *                                  irreversibility matrix (risk LOW and
 *                                  reversibility REVERSIBLE). Autonomy is
 *                                  conditional on the risk profile staying
 *                                  low: any departure escalates.
 *
 * The ESCALATION MATRIX (escalation.ts) applies at EVERY level — including
 * AUTONOMOUS_LOW_RISK — because it encodes the locked invariant "confidence
 * alone never authorizes risky changes" (spec/architecture-lock.md). A higher
 * autonomy level never disarms safety escalation.
 *
 * Scope vocabulary:
 *   - BLAST RADII: the breadth of potential effect if the action misfires
 *     (COMPONENT < SERVICE < SYSTEM < ORGANIZATION). Frozen, ordered.
 *   - REVERSIBILITY: how hard the action is to undo (REVERSIBLE >
 *     PARTIALLY_REVERSIBLE > IRREVERSIBLE in difficulty). Frozen.
 *   - RISK and UNCERTAINTY classes are CONSUMED from @sos-2/authority's
 *     frozen ASK contract vocabulary (ASK_RISK_SEVERITIES, UNCERTAINTY_CLASSES)
 *     — never redefined here (no second vocabulary authority).
 */

import { ASK_RISK_SEVERITIES } from '@sos-2/authority';
import type { AskRiskSeverity } from '@sos-2/authority';

/** The frozen autonomy level ladder (rank order: SUPERVISED < BOUNDED < AUTONOMOUS_LOW_RISK). */
export const AUTONOMY_LEVELS = ['SUPERVISED', 'BOUNDED', 'AUTONOMOUS_LOW_RISK'] as const;

export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

const AUTONOMY_LEVEL_SET: ReadonlySet<string> = new Set(AUTONOMY_LEVELS);

/** Structural check: is this one of the frozen autonomy levels? */
export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return typeof value === 'string' && AUTONOMY_LEVEL_SET.has(value);
}

/** Total rank order over the ladder (higher rank = more autonomous). */
export const AUTONOMY_LEVEL_RANKS: Readonly<Record<AutonomyLevel, number>> = {
  SUPERVISED: 0,
  BOUNDED: 1,
  AUTONOMOUS_LOW_RISK: 2,
};

/** Compare two levels: negative when `a` is LESS autonomous than `b`. */
export function compareAutonomyLevels(a: AutonomyLevel, b: AutonomyLevel): number {
  return AUTONOMY_LEVEL_RANKS[a] - AUTONOMY_LEVEL_RANKS[b];
}

/** Is `level` at least as autonomous as `floor`? */
export function levelSatisfies(level: AutonomyLevel, floor: AutonomyLevel): boolean {
  return AUTONOMY_LEVEL_RANKS[level] >= AUTONOMY_LEVEL_RANKS[floor];
}

/** The frozen blast-radius vocabulary (ordered by breadth of potential effect). */
export const BLAST_RADII = ['COMPONENT', 'SERVICE', 'SYSTEM', 'ORGANIZATION'] as const;

export type BlastRadius = (typeof BLAST_RADII)[number];

const BLAST_RADIUS_SET: ReadonlySet<string> = new Set(BLAST_RADII);

/** Structural check: is this one of the frozen blast radii? */
export function isBlastRadius(value: unknown): value is BlastRadius {
  return typeof value === 'string' && BLAST_RADIUS_SET.has(value);
}

/** Total rank order over blast radii (higher = broader potential effect). */
export const BLAST_RADIUS_RANKS: Readonly<Record<BlastRadius, number>> = {
  COMPONENT: 0,
  SERVICE: 1,
  SYSTEM: 2,
  ORGANIZATION: 3,
};

/** The frozen reversibility vocabulary (how hard the action is to undo). */
export const REVERSIBILITY_CLASSES = ['REVERSIBLE', 'PARTIALLY_REVERSIBLE', 'IRREVERSIBLE'] as const;

export type ReversibilityClass = (typeof REVERSIBILITY_CLASSES)[number];

const REVERSIBILITY_SET: ReadonlySet<string> = new Set(REVERSIBILITY_CLASSES);

/** Structural check: is this one of the frozen reversibility classes? */
export function isReversibilityClass(value: unknown): value is ReversibilityClass {
  return typeof value === 'string' && REVERSIBILITY_SET.has(value);
}

/**
 * The risk vocabulary is CONSUMED from @sos-2/authority's frozen ASK contract
 * (ASK_RISK_SEVERITIES: LOW, MODERATE, HIGH, SEVERE). Re-exported for caller
 * convenience — the authority remains the single vocabulary owner.
 */
export const RISK_SEVERITIES = ASK_RISK_SEVERITIES;

export type RiskSeverity = AskRiskSeverity;

/** Re-export of authority's severity predicate (single vocabulary owner). */
export { isAskRiskSeverity as isRiskSeverity } from '@sos-2/authority';
