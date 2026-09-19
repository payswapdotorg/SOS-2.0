/**
 * Authority precedence — realization of spec/architecture.md §3:
 *
 *     "Constitution > Mission > approved Value commitments > hard constraints
 *      > assurance policy > architecture hypothesis > candidate >
 *      implementation detail."
 *
 * Index 0 is the STRONGEST authority. This ordering is FROZEN
 * (spec/architecture-lock.md: "Value precedence" may not be redefined by
 * ordinary implementation); this module realizes it 1:1 and never redefines
 * it. It exists so that Mission-over-Value subordination is machine-checkable
 * (spec/architecture.md §7) and assertable in tests:
 *
 *     value can never outrank mission.
 */

export const AUTHORITY_PRECEDENCE_CHAIN = [
  'CONSTITUTION',
  'MISSION',
  'APPROVED_VALUE_COMMITMENT',
  'HARD_CONSTRAINT',
  'ASSURANCE_POLICY',
  'ARCHITECTURE_HYPOTHESIS',
  'CANDIDATE',
  'IMPLEMENTATION_DETAIL',
] as const;

export type PrecedenceClass = (typeof AUTHORITY_PRECEDENCE_CHAIN)[number];

const PRECEDENCE_INDEX: ReadonlyMap<string, number> = new Map(
  AUTHORITY_PRECEDENCE_CHAIN.map((label, index) => [label, index] as const),
);

export function isPrecedenceClass(value: unknown): value is PrecedenceClass {
  return typeof value === 'string' && PRECEDENCE_INDEX.has(value);
}

/**
 * Rank of a precedence class: SMALLER ranks are stronger authorities.
 * Throws on unknown labels (loud discipline — the chain is frozen).
 */
export function precedenceRank(label: PrecedenceClass): number {
  const rank = PRECEDENCE_INDEX.get(label);
  if (rank === undefined) {
    throw new TypeError(
      `unknown precedence class: ${JSON.stringify(label)} (the chain from spec/architecture.md §3 is frozen)`,
    );
  }
  return rank;
}

/** Whether `a` outranks `b` under the frozen §3 chain. */
export function outranks(a: PrecedenceClass, b: PrecedenceClass): boolean {
  return precedenceRank(a) < precedenceRank(b);
}

/**
 * The only possible resolution of a Mission/Value conflict. Value never
 * outranks Mission: a conflicting value constraint is rejected at
 * construction (policy REJECT) or flagged CONFLICTS_WITH via a typed trace
 * link (policy FLAG) — in neither case does the value constraint survive as
 * authoritative.
 */
export const MISSION_PREVAILS = 'MISSION_PREVAILS' as const;
export type MissionValueConflictResolution = typeof MISSION_PREVAILS;
