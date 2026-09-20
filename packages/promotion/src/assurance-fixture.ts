/**
 * AssuranceCase fixture — the W9 realization of the AssuranceCase INPUT
 * CONTRACT SHAPE for the promotion gate.
 *
 * W9 PARALLELIZATION RULE (spec/work-orders/W9-experimentation.md): W9 must
 * be implementable WITHOUT W7/W8 source dependencies; assurance results are
 * consumed through contract fixtures/stubs. This module pins the
 * AssuranceCase-shaped input: a well-formed spine id under the FROZEN core
 * kind "AssuranceCase" plus the three fields the promotion gate evaluates
 * (spec/architecture.md §5: "Assurance Case: claims, assumptions, hazards,
 * controls, evidence, validity conditions, objections and verdict";
 * docs/assurance-model.md: "Promotion requires current authority +
 * assurance + evidence + compatible current System State"):
 *
 *   claims    the argued claims (>= 1, each with an id and statement —
 *             mirroring the W8 assurance claim semantics; the full
 *             claims/assumptions/hazards/controls/objections argument
 *             structure is W8's to build — this fixture carries the
 *             claims + verdict + validity surface the gate needs, shaped so
 *             W8 integrates without contract changes)
 *   verdict   the case verdict — exactly one of SATISFIED (the claims are
 *             argued and hold), REFUTED (a claim is actively disproven) or
 *             INCOMPLETE (the case has not been argued to a verdict)
 *   validity  the case validity — exactly one of CURRENT, EXPIRED,
 *             SUPERSEDED, VIOLATED (docs/assurance-model.md: assurance can
 *             become invalid when implementation changes, dependencies
 *             change, environment changes, evidence expires, runtime
 *             monitors detect anomalies, or assumptions are violated),
 *             evaluated at the promotion instant `now` (a case claiming
 *             CURRENT whose expires_at has passed is truthfully evaluated
 *             EXPIRED — validity is NEVER assumed)
 *
 * The gate NEVER assumes an assurance case is valid: structurally invalid
 * cases and REFUTED verdicts REJECT promotion; INCOMPLETE verdicts and
 * non-CURRENT validity block it (GATHER_EVIDENCE — refresh/revalidate the
 * case). Every rule is pinned by tests.
 */

import { isArtifactId, parseArtifactId, RFC3339_PATTERN } from '@sos-2/semantic-spine';
import { PromotionError } from './errors.js';

/** The (core, frozen) artifact kind segment used for assurance fixture ids. */
export const ASSURANCE_CASE_KIND = 'AssuranceCase';

// ---------------------------------------------------------------------------
// Verdict and validity vocabularies
// ---------------------------------------------------------------------------

export const ASSURANCE_VERDICTS = ['SATISFIED', 'REFUTED', 'INCOMPLETE'] as const;

export type AssuranceVerdict = (typeof ASSURANCE_VERDICTS)[number];

const VERDICT_SET: ReadonlySet<string> = new Set(ASSURANCE_VERDICTS);

/** Structural check: is this one of the three assurance verdicts? */
export function isAssuranceVerdict(value: unknown): value is AssuranceVerdict {
  return typeof value === 'string' && VERDICT_SET.has(value);
}

export const ASSURANCE_VALIDITY_STATUSES = ['CURRENT', 'EXPIRED', 'SUPERSEDED', 'VIOLATED'] as const;

export type AssuranceValidityStatus = (typeof ASSURANCE_VALIDITY_STATUSES)[number];

const VALIDITY_SET: ReadonlySet<string> = new Set(ASSURANCE_VALIDITY_STATUSES);

/** Structural check: is this one of the four assurance validity statuses? */
export function isAssuranceValidityStatus(value: unknown): value is AssuranceValidityStatus {
  return typeof value === 'string' && VALIDITY_SET.has(value);
}

// ---------------------------------------------------------------------------
// The fixture contract
// ---------------------------------------------------------------------------

/** One argued claim of the assurance case. */
export interface AssuranceClaim {
  /** Claim id, unique within the case (non-empty). */
  id: string;
  /** The claim statement (non-empty). */
  statement: string;
}

/** The case validity, evaluated at a promotion instant. */
export interface AssuranceValidity {
  status: AssuranceValidityStatus;
  /** RFC3339 instant after which the case is stale, or null (no declared expiry). */
  expires_at: string | null;
  /** Why the status is what it is (non-empty). */
  reason: string;
}

/**
 * The AssuranceCase-shaped fixture input consumed by the promotion gate —
 * claims + verdict + validity (NOT assumed valid; the gate validates and
 * evaluates it, and blocks promotion on every invalid shape).
 */
export interface AssuranceCaseFixture {
  /** Well-formed spine artifact id of the frozen kind AssuranceCase. */
  id: string;
  /** The argued claims (>= 1). */
  claims: AssuranceClaim[];
  /** The case verdict. */
  verdict: AssuranceVerdict;
  /** The case validity (evaluated at the promotion instant). */
  validity: AssuranceValidity;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the claims array (throws PromotionError). */
function assertValidClaims(value: unknown): asserts value is AssuranceClaim[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PromotionError('assurance claims must be a non-empty array of { id, statement }');
  }
  const ids = new Set<string>();
  for (const claim of value) {
    if (!isPlainObject(claim) || Object.keys(claim).length !== 2) {
      throw new PromotionError('assurance claims entries must have the exact field set { id, statement }');
    }
    if (!isNonEmptyString(claim['id'])) {
      throw new PromotionError(`claim id must be a non-empty string, received: ${JSON.stringify(claim['id'])}`);
    }
    if (ids.has(claim['id'])) {
      throw new PromotionError(`duplicate claim id rejected: ${JSON.stringify(claim['id'])}`);
    }
    ids.add(claim['id']);
    if (!isNonEmptyString(claim['statement'])) {
      throw new PromotionError(`claim statement must be a non-empty string, received: ${JSON.stringify(claim['statement'])}`);
    }
  }
}

/** Validate an AssuranceValidity (throws PromotionError). */
export function assertValidAssuranceValidity(value: unknown): asserts value is AssuranceValidity {
  if (!isPlainObject(value) || Object.keys(value).length !== 3) {
    throw new PromotionError('assurance validity must have the exact field set { status, expires_at, reason }');
  }
  if (typeof value['status'] !== 'string' || !VALIDITY_SET.has(value['status'])) {
    throw new PromotionError(
      `assurance validity status must be one of ${ASSURANCE_VALIDITY_STATUSES.join(', ')}, received: ${JSON.stringify(value['status'])}`,
    );
  }
  if (value['expires_at'] !== null && (typeof value['expires_at'] !== 'string' || !RFC3339_PATTERN.test(value['expires_at']))) {
    throw new PromotionError(
      `assurance validity expires_at must be null or an RFC3339 timestamp, received: ${JSON.stringify(value['expires_at'])}`,
    );
  }
  if (!isNonEmptyString(value['reason'])) {
    throw new PromotionError(`assurance validity reason must be a non-empty string, received: ${JSON.stringify(value['reason'])}`);
  }
}

/**
 * Full validation of an AssuranceCase fixture (throws PromotionError):
 * exact field set, well-formed AssuranceCase-kind spine id, >= 1 claim with
 * unique ids, verdict from the vocabulary, valid validity block.
 */
export function assertValidAssuranceCase(value: unknown): asserts value is AssuranceCaseFixture {
  if (!isPlainObject(value)) {
    throw new PromotionError(`assurance case fixture must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = ['id', 'claims', 'verdict', 'validity'];
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new PromotionError(`assurance case fixture must have the exact field set { ${keys.join(', ')} }`);
  }
  if (!isArtifactId(record['id'])) {
    throw new PromotionError(
      `assurance case id must be a well-formed spine artifact id, received: ${JSON.stringify(record['id'])}`,
    );
  }
  const parsed = parseArtifactId(record['id']);
  if (parsed.kind !== ASSURANCE_CASE_KIND) {
    throw new PromotionError(
      `assurance case id must reference the frozen kind AssuranceCase, received kind "${parsed.kind}"`,
    );
  }
  assertValidClaims(record['claims']);
  if (typeof record['verdict'] !== 'string' || !VERDICT_SET.has(record['verdict'])) {
    throw new PromotionError(
      `assurance verdict must be one of ${ASSURANCE_VERDICTS.join(', ')}, received: ${JSON.stringify(record['verdict'])}`,
    );
  }
  assertValidAssuranceValidity(record['validity']);
}

/** Predicate form of assertValidAssuranceCase. */
export function validateAssuranceCase(value: unknown): value is AssuranceCaseFixture {
  try {
    assertValidAssuranceCase(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Truthful evaluation at a promotion instant
// ---------------------------------------------------------------------------

export interface AssuranceGateEvaluation {
  /** Structural validity of the fixture. */
  structurally_valid: boolean;
  /** The verdict as declared. */
  verdict: AssuranceVerdict | null;
  /** The EFFECTIVE validity status at `now` (EXPIRED when expires_at passed). */
  effective_validity: AssuranceValidityStatus | null;
  /** Whether the case passes the assurance gate (verdict SATISFIED + validity CURRENT at now). */
  passes: boolean;
  reasons: string[];
}

function epochMs(timestamp: string): number {
  const millis = Date.parse(timestamp);
  if (Number.isNaN(millis)) {
    throw new PromotionError(`unparseable RFC3339 timestamp: ${JSON.stringify(timestamp)}`);
  }
  return millis;
}

/**
 * Evaluate an assurance case at a promotion instant — validity is NEVER
 * assumed: a case declaring CURRENT whose expires_at closed before `now`
 * is truthfully evaluated EXPIRED (the same deterministic instant
 * comparison @sos-2/authority uses for grants).
 */
export function evaluateAssuranceCase(
  assuranceCase: unknown,
  now: string,
): AssuranceGateEvaluation {
  if (typeof now !== 'string' || !RFC3339_PATTERN.test(now)) {
    throw new PromotionError(`now must be an RFC3339 timestamp, received: ${JSON.stringify(now)}`);
  }
  if (!validateAssuranceCase(assuranceCase)) {
    return {
      structurally_valid: false,
      verdict: null,
      effective_validity: null,
      passes: false,
      reasons: ['assurance case is structurally invalid — promotion is rejected (an assurance case is never assumed valid)'],
    };
  }
  const cases = assuranceCase as AssuranceCaseFixture;
  const reasons: string[] = [];
  let effectiveValidity = cases.validity.status;
  if (
    cases.validity.status === 'CURRENT' &&
    cases.validity.expires_at !== null &&
    epochMs(now) >= epochMs(cases.validity.expires_at)
  ) {
    effectiveValidity = 'EXPIRED';
    reasons.push(
      `assurance case ${cases.id} declares CURRENT but its validity expired at ${cases.validity.expires_at} (before ${now}) — truthfully evaluated EXPIRED`,
    );
  }
  let passes = true;
  if (cases.verdict === 'REFUTED') {
    passes = false;
    reasons.push(`assurance case ${cases.id} verdict is REFUTED — a refuted case blocks promotion`);
  } else if (cases.verdict === 'INCOMPLETE') {
    passes = false;
    reasons.push(
      `assurance case ${cases.id} verdict is INCOMPLETE — the case has not been argued to a verdict; promotion is blocked until the case is completed (gather the evidence to argue it)`,
    );
  }
  if (effectiveValidity !== 'CURRENT') {
    passes = false;
    reasons.push(
      `assurance case ${cases.id} validity is ${effectiveValidity} at ${now} — a non-CURRENT case blocks promotion ` +
        '(refresh/revalidate the case against the current implementation, dependencies and environment)',
    );
  }
  if (passes) {
    reasons.push(
      `assurance case ${cases.id} verdict is SATISFIED and validity is CURRENT at ${now}`,
    );
  }
  return {
    structurally_valid: true,
    verdict: cases.verdict,
    effective_validity: effectiveValidity,
    passes,
    reasons,
  };
}
