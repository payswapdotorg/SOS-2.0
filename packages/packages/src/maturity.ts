/**
 * Package maturity lifecycle (docs/package-ecology.md; the frozen
 * vocabulary is imported from @sos-2/contracts PACKAGE_MATURITIES — never
 * redefined; spec/architecture-lock.md places Package maturity outside
 * ordinary redefinition, so this module is a REALIZATION of the frozen
 * lifecycle, not a redefinition).
 *
 * STRICT transition graph (docs/package-ecology.md:
 * "DISCOVERED -> FORMING -> VALIDATED -> MATURE -> CONTEXTUALIZED ->
 * SUPERSEDED/RETIRED"):
 *
 *     DISCOVERED    -> FORMING, RETIRED
 *     FORMING       -> VALIDATED, RETIRED
 *     VALIDATED     -> MATURE, SUPERSEDED, RETIRED
 *     MATURE        -> CONTEXTUALIZED, SUPERSEDED, RETIRED
 *     CONTEXTUALIZED -> SUPERSEDED, RETIRED
 *     SUPERSEDED    -> (terminal)
 *     RETIRED       -> (terminal)
 *
 * No skipping (DISCOVERED -> VALIDATED is REJECTED), no going backwards,
 * no leaving terminal states. Abandonment before validation is RETIREMENT;
 * SUPERSEDED (replaced by a successor) is reachable only once the package
 * has been validated.
 *
 * PROMOTION GATES (frozen requirements; evidence-gated maturity —
 * spec/architecture.md §14 "Promotion is evidence gated" and the lock's
 * forbidden shortcut "package promoted after one lucky success"):
 *
 *     DISCOVERED -> FORMING        >= 1 resolvable evidence ref (observed at all)
 *     FORMING -> VALIDATED         >= 1 success AND NOT one-lucky-success
 *                                  (>= 2 successes OR >= 1 comparative/
 *                                  interventional evidence) AND >= 1 realization
 *     VALIDATED -> MATURE          >= 4 evidence refs, >= 2 successes,
 *                                  >= 1 comparative or interventional
 *     MATURE -> CONTEXTUALIZED     MATURE requirements AND >= 1 CALIBRATED
 *                                  applicability estimate (context-conditioned
 *                                  numeric estimates with calibration)
 *     * -> SUPERSEDED              administrative: requires the replacement id
 *     * -> RETIRED                 administrative
 *
 * Every evidence ref cited by the promoting revision must RESOLVE to an
 * actual record in the provided evidence set — evidence outranks assertion
 * about system reality (spec/architecture.md §18); dangling refs reject the
 * promotion. LLM-produced evidence still counts as evidence of observation
 * but never as calibrated truth (the W3 confidence discipline owns that
 * distinction; the gates here never mint confidence).
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import type { PackageMaturity } from '@sos-2/semantic-spine';
import { isPackageMaturity, PACKAGE_MATURITIES } from '@sos-2/semantic-spine';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { isOneLuckySuccess } from './evidence-classes.js';
import type { EvidenceSetSummary } from './evidence-classes.js';
import { summarizeEvidenceSet } from './evidence-classes.js';
import { PackageError } from './errors.js';

/** Strict maturity transition table (see module doc). */
export const ALLOWED_MATURITY_TRANSITIONS: Readonly<Record<PackageMaturity, readonly PackageMaturity[]>> = {
  DISCOVERED: ['FORMING', 'RETIRED'],
  FORMING: ['VALIDATED', 'RETIRED'],
  VALIDATED: ['MATURE', 'SUPERSEDED', 'RETIRED'],
  MATURE: ['CONTEXTUALIZED', 'SUPERSEDED', 'RETIRED'],
  CONTEXTUALIZED: ['SUPERSEDED', 'RETIRED'],
  SUPERSEDED: [],
  RETIRED: [],
};

/** Total order over the LIVE maturity states (terminal states rank last, equal). */
export const MATURITY_RANK: Readonly<Record<PackageMaturity, number>> = {
  DISCOVERED: 0,
  FORMING: 1,
  VALIDATED: 2,
  MATURE: 3,
  CONTEXTUALIZED: 4,
  SUPERSEDED: 5,
  RETIRED: 5,
};

/** True iff the maturity is a validated-or-beyond live state. */
export function isValidatedMaturity(maturity: PackageMaturity): boolean {
  return (
    maturity === 'VALIDATED' ||
    maturity === 'MATURE' ||
    maturity === 'CONTEXTUALIZED'
  );
}

/** True iff the maturity is terminal (SUPERSEDED or RETIRED). */
export function isTerminalMaturity(maturity: PackageMaturity): boolean {
  return maturity === 'SUPERSEDED' || maturity === 'RETIRED';
}

/** Is `from -> to` an allowed strict transition? */
export function canTransitionMaturity(from: PackageMaturity, to: PackageMaturity): boolean {
  if (!isPackageMaturity(from) || !isPackageMaturity(to)) {
    return false;
  }
  return ALLOWED_MATURITY_TRANSITIONS[from]!.includes(to);
}

/** Validate and return the target maturity; throws PackageError on invalid transitions. */
export function transitionMaturity(from: PackageMaturity, to: PackageMaturity): PackageMaturity {
  if (!isPackageMaturity(from)) {
    throw new PackageError(`unknown package maturity: ${JSON.stringify(from)} (frozen vocabulary: ${PACKAGE_MATURITIES.join(', ')})`);
  }
  if (!isPackageMaturity(to)) {
    throw new PackageError(`unknown package maturity: ${JSON.stringify(to)} (frozen vocabulary: ${PACKAGE_MATURITIES.join(', ')})`);
  }
  if (!canTransitionMaturity(from, to)) {
    if (isTerminalMaturity(from)) {
      throw new PackageError(`invalid maturity transition: ${from} is terminal — no transitions leave it`);
    }
    throw new PackageError(
      `invalid maturity transition: ${from} -> ${to} (strict lifecycle; allowed: ${ALLOWED_MATURITY_TRANSITIONS[from]!.join(', ') || 'none'})`,
    );
  }
  return to;
}

/** Frozen evidence requirements for a live-state promotion. */
export interface MaturityRequirements {
  /** Minimum total resolvable evidence refs. */
  minEvidenceRefs: number;
  /** Minimum records with availability SUCCESS. */
  minSuccesses: number;
  /** Minimum comparative-or-interventional records. */
  minComparativeOrInterventional: number;
  /** The one-lucky-success gate applies (FORMING -> VALIDATED). */
  rejectOneLuckySuccess: boolean;
  /** A realization is required (validated capabilities are realized). */
  requiresRealizations: boolean;
  /** A CALIBRATED applicability estimate is required (CONTEXTUALIZED). */
  requiresCalibratedApplicability: boolean;
}

/** The frozen default requirements per promotion (see module doc). */
export const MATURITY_PROMOTION_REQUIREMENTS: Readonly<Record<'DISCOVERED_TO_FORMING' | 'FORMING_TO_VALIDATED' | 'VALIDATED_TO_MATURE' | 'MATURE_TO_CONTEXTUALIZED', MaturityRequirements>> = {
  DISCOVERED_TO_FORMING: {
    minEvidenceRefs: 1,
    minSuccesses: 0,
    minComparativeOrInterventional: 0,
    rejectOneLuckySuccess: false,
    requiresRealizations: false,
    requiresCalibratedApplicability: false,
  },
  FORMING_TO_VALIDATED: {
    minEvidenceRefs: 1,
    minSuccesses: 1,
    minComparativeOrInterventional: 0,
    rejectOneLuckySuccess: true,
    requiresRealizations: true,
    requiresCalibratedApplicability: false,
  },
  VALIDATED_TO_MATURE: {
    minEvidenceRefs: 4,
    minSuccesses: 2,
    minComparativeOrInterventional: 1,
    rejectOneLuckySuccess: false,
    requiresRealizations: true,
    requiresCalibratedApplicability: false,
  },
  MATURE_TO_CONTEXTUALIZED: {
    minEvidenceRefs: 4,
    minSuccesses: 2,
    minComparativeOrInterventional: 1,
    rejectOneLuckySuccess: false,
    requiresRealizations: true,
    requiresCalibratedApplicability: true,
  },
};

function requirementsFor(from: PackageMaturity, to: PackageMaturity): MaturityRequirements | null {
  if (to === 'SUPERSEDED' || to === 'RETIRED') {
    return null; // administrative transitions — no evidence-count requirements
  }
  if (from === 'DISCOVERED' && to === 'FORMING') {
    return MATURITY_PROMOTION_REQUIREMENTS.DISCOVERED_TO_FORMING;
  }
  if (from === 'FORMING' && to === 'VALIDATED') {
    return MATURITY_PROMOTION_REQUIREMENTS.FORMING_TO_VALIDATED;
  }
  if (from === 'VALIDATED' && to === 'MATURE') {
    return MATURITY_PROMOTION_REQUIREMENTS.VALIDATED_TO_MATURE;
  }
  if (from === 'MATURE' && to === 'CONTEXTUALIZED') {
    return MATURITY_PROMOTION_REQUIREMENTS.MATURE_TO_CONTEXTUALIZED;
  }
  return null;
}

/** Inputs to the maturity promotion gate. */
export interface PromotionGateInput {
  from: PackageMaturity;
  to: PackageMaturity;
  /** Evidence refs cited by the promoting revision (each must resolve). */
  evidence_refs: readonly string[];
  /** Resolved evidence records available to the gate (matched by id). */
  evidence: readonly EvidenceRecordW3[];
  /** Whether the promoting revision declares at least one realization. */
  hasRealizations: boolean;
  /** Whether the promoting revision declares at least one CALIBRATED applicability estimate. */
  hasCalibratedApplicability: boolean;
  /** REQUIRED for SUPERSEDED: the replacement package/composition id. */
  superseded_by?: string | null;
}

/** The outcome of a maturity promotion gate evaluation. */
export interface PromotionVerdict {
  allowed: boolean;
  from: PackageMaturity;
  to: PackageMaturity;
  /** Rejection reasons (empty iff allowed). */
  reasons: string[];
  /** Evidence summary of the RESOLVED cited records. */
  summary: EvidenceSetSummary;
  /** Cited refs that did not resolve to a provided record (dangling). */
  unresolved_refs: string[];
}

/**
 * Evaluate a maturity promotion against the frozen gates. PURE: a
 * deterministic function of the input; never throws for gate outcomes (a
 * verdict with reasons is returned; only malformed inputs throw).
 */
export function evaluateMaturityPromotion(input: PromotionGateInput): PromotionVerdict {
  if (typeof input !== 'object' || input === null) {
    throw new PackageError('promotion gate input must be an object');
  }
  const from = input.from;
  const to = input.to;
  transitionMaturity(from, to); // throws on invalid strict transitions

  const reasons: string[] = [];
  const byId = new Map<string, EvidenceRecordW3>();
  for (const record of input.evidence) {
    byId.set(record.id, record);
  }
  const unresolved: string[] = [];
  const resolved: EvidenceRecordW3[] = [];
  for (const ref of input.evidence_refs) {
    const record = byId.get(ref);
    if (record === undefined) {
      unresolved.push(ref);
    } else {
      resolved.push(record);
    }
  }

  const summary = summarizeEvidenceSet(resolved);

  // Administrative transitions (SUPERSEDED/RETIRED) carry no evidence-count
  // requirements and no dangling-ref rejection: supersession and retirement
  // are administrative acts, not evidence claims (the dangling discipline
  // guards EVIDENCE-GATED promotions, where evidence outranks assertion).
  if (to === 'SUPERSEDED') {
    const replacement = input.superseded_by ?? null;
    if (replacement === null || !isArtifactId(replacement)) {
      reasons.push(
        'supersession requires the replacement artifact id (superseded_by) — a well-formed spine id',
      );
    }
    return { allowed: reasons.length === 0, from, to, reasons, summary, unresolved_refs: unresolved };
  }
  if (to === 'RETIRED') {
    return { allowed: reasons.length === 0, from, to, reasons, summary, unresolved_refs: unresolved };
  }

  if (unresolved.length > 0) {
    reasons.push(
      `dangling evidence refs (evidence outranks assertion — every cited ref must resolve): ${unresolved
        .map((ref) => JSON.stringify(ref))
        .join(', ')}`,
    );
  }

  const requirements = requirementsFor(from, to);
  if (requirements === null) {
    // Unreachable for live transitions that passed transitionMaturity.
    reasons.push(`no frozen requirements defined for ${from} -> ${to}`);
    return { allowed: false, from, to, reasons, summary, unresolved_refs: unresolved };
  }

  if (input.evidence_refs.length < requirements.minEvidenceRefs) {
    reasons.push(
      `requires at least ${requirements.minEvidenceRefs} evidence refs, cited: ${input.evidence_refs.length}`,
    );
  }
  if (summary.successes < requirements.minSuccesses) {
    reasons.push(
      `requires at least ${requirements.minSuccesses} evidence records with availability SUCCESS, found: ${summary.successes}`,
    );
  }
  if (summary.comparativeOrInterventional < requirements.minComparativeOrInterventional) {
    reasons.push(
      `requires at least ${requirements.minComparativeOrInterventional} comparative or interventional evidence ` +
        `record(s), found: ${summary.comparativeOrInterventional}`,
    );
  }
  if (requirements.rejectOneLuckySuccess && isOneLuckySuccess(summary)) {
    reasons.push(
      'one lucky success rejected: a single SUCCESS evidence with no comparative/intervention evidence is ' +
        'not a validated outcome (spec/architecture-lock.md — packages are never promoted after one lucky success)',
    );
  }
  if (requirements.requiresRealizations && !input.hasRealizations) {
    reasons.push('a validated-or-beyond package must declare at least one realization');
  }
  if (requirements.requiresCalibratedApplicability && !input.hasCalibratedApplicability) {
    reasons.push(
      'contextualization requires at least one CALIBRATED applicability estimate ' +
        '(numeric probability with calibration, sample size, time window and context)',
    );
  }

  return { allowed: reasons.length === 0, from, to, reasons, summary, unresolved_refs: unresolved };
}

/** Throwing form of evaluateMaturityPromotion (throws PackageError with all reasons). */
export function assertMaturityPromotion(input: PromotionGateInput): PromotionVerdict {
  const verdict = evaluateMaturityPromotion(input);
  if (!verdict.allowed) {
    throw new PackageError(
      `maturity promotion ${verdict.from} -> ${verdict.to} rejected: ${verdict.reasons.join('; ')}`,
    );
  }
  return verdict;
}
