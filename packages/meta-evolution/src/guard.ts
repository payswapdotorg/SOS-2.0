/**
 * THE GOVERNANCE GUARD (W16 stage 3) — NON-DISABLEABLE.
 *
 * spec/architecture.md §16: "Meta-adaptation cannot disable the mechanism
 * that judges meta-adaptation." This guard is that mechanism for the meta
 * loop. It is a PURE function over (patch, current parameters) and the
 * FROZEN invariant list below:
 *
 *   - There is NO MetaProcess parameter that touches the guard (the guard
 *     is outside the evolvable surface — parameters.ts carries no
 *     governance knobs at all), so no legitimate meta-change can weaken it.
 *   - Any patch key outside the frozen EVOLVABLE_KEYS set is REJECTED with a
 *     typed rejection. Attempts to disable authority gates, remove
 *     traceability, weaken ASK or bypass decision records all manifest as
 *     non-evolvable keys and are rejected here — as is any attempt to
 *     remove or reconfigure the guard itself.
 *   - Value-level governance invariants inside the evolvable surface:
 *     the VALIDATED altitude weights must stay strictly positive (search
 *     must be able to start at the highest safe validated reasoning
 *     altitude), and the per-family candidate floor must stay >= 1
 *     (diversity is intentional — the repertoire may not collapse to a
 *     single winner).
 *   - The guard verdict does not depend on any accumulated state, so
 *     accumulated meta-changes cannot vote it away (pinned by property
 *     tests: interleaved governance-weakening attempts are rejected at
 *     every step of arbitrary applied-change sequences).
 *
 * Rejections are TYPED RECORDS retained in the stage record (never thrown,
 * never dropped); the only throw paths are the structural BYPASS attempts
 * (applyParametersPatch / applyMetaChange re-run the guard and throw
 * GUARD_BYPASS_ATTEMPT).
 */

import { RETRIEVAL_ALTITUDES } from '@sos-2/registry';
import { EVOLVABLE_KEYS, nonEvolvableKeys, patchKeys, assertValidMetaProcessParameters } from './parameters.js';
import type { MetaProcessParameters, MetaProcessPatch } from './parameters.js';
import type { MetaChangeArtifact } from './change.js';

/** The frozen governance invariant vocabulary (W16; add-only by contract). */
export const GOVERNANCE_INVARIANT_IDS = [
  'AUTHORITY_GATES_NON_DISABLEABLE',
  'TRACEABILITY_MANDATORY',
  'ASK_FIRST_CLASS',
  'DECISION_RECORDS_MANDATORY',
  'VALIDATED_ALTITUDE_FLOOR',
  'DIVERSITY_FLOOR',
  'META_EVOLVABLE_SURFACE',
] as const;

export type GovernanceInvariantId = (typeof GOVERNANCE_INVARIANT_IDS)[number];

export const GUARD_REJECTION_CODES = [
  'NON_EVOLVABLE_KEY',
  'VALIDATED_ALTITUDE_ZEROED',
  'DIVERSITY_COLLAPSE',
] as const;

export type GuardRejectionCode = (typeof GUARD_REJECTION_CODES)[number];

/** The typed rejection record (retained verbatim; never dropped). */
export interface GuardRejection {
  /** The rejected MetaChange artifact id. */
  change_id: string;
  /** The frozen invariant the change would have violated. */
  invariant: GovernanceInvariantId;
  /** The machine-checkable rejection code. */
  code: GuardRejectionCode;
  /** Human-readable reason (non-empty). */
  reason: string;
  /** The exact patch keys that caused the rejection (sorted; may be empty for value-level rejections). */
  attempted_keys: string[];
}

export interface GuardVerdict {
  /** True iff the change passed every governance invariant. */
  passed: boolean;
  /** The rejection record — null iff passed. */
  rejection: GuardRejection | null;
  /** The invariants checked (the full frozen list, in canonical order). */
  invariants_checked: GovernanceInvariantId[];
}

/**
 * Key-classification for non-evolvable keys: maps an attempted key to the
 * governance invariant it attacks. Recognized governance surfaces map to
 * their specific invariant; anything else is a plain evolvable-surface
 * violation.
 */
function classifyForeignKey(key: string): GovernanceInvariantId {
  if (/(governance|authority|guard|autonomy|permission|grant)/i.test(key)) {
    return 'AUTHORITY_GATES_NON_DISABLEABLE';
  }
  if (/(trace|provenance|link|spine)/i.test(key)) {
    return 'TRACEABILITY_MANDATORY';
  }
  if (/(ask|escalat)/i.test(key)) {
    return 'ASK_FIRST_CLASS';
  }
  if (/(decision|record|audit)/i.test(key)) {
    return 'DECISION_RECORDS_MANDATORY';
  }
  return 'META_EVOLVABLE_SURFACE';
}

/**
 * Compute the WOULD-BE parameters of a guard-passing patch WITHOUT the full
 * parameter validation (the guard classifies value-level governance
 * violations itself, in its own canonical order, before delegating the
 * remaining validity checks to the parameter validator).
 */
function computeCandidateParameters(base: MetaProcessParameters, patch: MetaProcessPatch): MetaProcessParameters {
  const strategy = (patch.strategy ?? {}) as Record<string, unknown>;
  const weights = (patch.retrieval_weights ?? {}) as Record<string, unknown>;
  return {
    strategy: {
      // Assigned values are preserved VERBATIM (an invalid value on an
      // evolvable key must be REJECTED by the guard's delegated validation,
      // never silently replaced with the base value).
      search_policy: (strategy['search_policy'] !== undefined ? strategy['search_policy'] : base.strategy.search_policy) as MetaProcessParameters['strategy']['search_policy'],
      exploration_rate: (strategy['exploration_rate'] !== undefined ? strategy['exploration_rate'] : base.strategy.exploration_rate) as number,
      max_candidates_per_family: (strategy['max_candidates_per_family'] !== undefined ? strategy['max_candidates_per_family'] : base.strategy.max_candidates_per_family) as number,
    },
    retrieval_weights: { ...base.retrieval_weights, ...weights },
  };
}

/**
 * THE GOVERNANCE GUARD. Pure, deterministic, total: every MetaChange yields
 * either a pass or exactly one typed rejection (the first violation in the
 * canonical check order: surface keys -> validated altitude floor ->
 * diversity floor -> evolvable-surface value validity).
 */
export function evaluateGovernanceGuard(
  change: MetaChangeArtifact,
  currentParameters: MetaProcessParameters,
): GuardVerdict {
  const invariants_checked: GovernanceInvariantId[] = [...GOVERNANCE_INVARIANT_IDS];
  const patch: MetaProcessPatch = change.content.patch;

  // 1. THE EVOLVABLE SURFACE: every attempted key must be evolvable.
  const foreign = nonEvolvableKeys(patch);
  if (foreign.length > 0) {
    const invariant = classifyForeignKey(foreign[0] ?? '');
    return {
      passed: false,
      rejection: {
        change_id: change.envelope.id,
        invariant,
        code: 'NON_EVOLVABLE_KEY',
        reason:
          `the patch attempts to set non-evolvable key(s) [${foreign.join(', ')}] — ` +
          `the governance surface (authority gates, traceability, ASK escalation, decision records, the guard itself) is OUTSIDE the evolvable surface ` +
          `(${EVOLVABLE_KEYS.length} frozen evolvable keys) and cannot be weakened by meta-adaptation (spec/architecture.md §16)`,
        attempted_keys: foreign,
      },
      invariants_checked,
    };
  }

  // 2. Compute the would-be parameters (raw merge; guard-passing patches
  //    touch only evolvable keys, so the merge is exact).
  const candidate = computeCandidateParameters(currentParameters, patch);

  // 3. VALIDATED ALTITUDE FLOOR: search must always be able to START at the
  //    highest safe validated reasoning altitude (§10). Zeroing the
  //    validated altitudes weakens the governance posture — rejected.
  if (candidate.retrieval_weights['VALIDATED_COMPOSITION'] <= 0 || candidate.retrieval_weights['VALIDATED_PACKAGE'] <= 0) {
    const zeroed = RETRIEVAL_ALTITUDES.filter(
      (altitude) =>
        (altitude === 'VALIDATED_COMPOSITION' || altitude === 'VALIDATED_PACKAGE') && candidate.retrieval_weights[altitude] <= 0,
    );
    return {
      passed: false,
      rejection: {
        change_id: change.envelope.id,
        invariant: 'VALIDATED_ALTITUDE_FLOOR',
        code: 'VALIDATED_ALTITUDE_ZEROED',
        reason:
          `the patch would zero the validated retrieval altitude weight(s) [${zeroed.join(', ')}] — ` +
          'package search must always be able to start at the highest safe validated reasoning altitude (spec/architecture.md §10); weakening it is a governance regression',
        attempted_keys: zeroed.map((altitude) => `retrieval_weights.${altitude}`),
      },
      invariants_checked,
    };
  }

  // 4. DIVERSITY FLOOR: the repertoire may not collapse (R12/R28 — diversity
  //    is intentional; a universal winner is a forbidden shortcut).
  if (candidate.strategy.max_candidates_per_family < 1) {
    return {
      passed: false,
      rejection: {
        change_id: change.envelope.id,
        invariant: 'DIVERSITY_FLOOR',
        code: 'DIVERSITY_COLLAPSE',
        reason:
          `the patch would set strategy.max_candidates_per_family to ${String(candidate.strategy.max_candidates_per_family)} — ` +
          'collapsing the candidate repertoire to fewer than one per family removes intentional diversity (R12/R28)',
        attempted_keys: ['strategy.max_candidates_per_family'],
      },
      invariants_checked,
    };
  }

  // 5. Remaining evolvable-surface value validity (policy vocabulary,
  //    exploration bounds, weight finiteness) — delegated to the parameter
  //    validator; a violation is a typed evolvable-surface rejection.
  try {
    assertValidMetaProcessParameters(candidate);
  } catch (cause) {
    return {
      passed: false,
      rejection: {
        change_id: change.envelope.id,
        invariant: 'META_EVOLVABLE_SURFACE',
        code: 'NON_EVOLVABLE_KEY',
        reason: `the patched parameters are invalid on the evolvable surface: ${(cause as Error).message}`,
        attempted_keys: patchKeys(patch),
      },
      invariants_checked,
    };
  }

  return { passed: true, rejection: null, invariants_checked };
}

/** The guard object passed to applyMetaChange (re-evaluated internally — bypass-impossible). */
export const GOVERNANCE_GUARD = {
  evaluate: evaluateGovernanceGuard,
} as const;
