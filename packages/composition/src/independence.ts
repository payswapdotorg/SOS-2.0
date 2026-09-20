/**
 * Independence discipline for composed success probabilities
 * (docs/probabilistic-learning.md: "Never assume P(A+B) = P(A)P(B) unless
 * independence is justified"; spec/architecture.md §12; the lock forbids
 * "composition probabilities multiplied without justified independence").
 *
 * MACHINE-ENFORCED RULE: there is NO code path that combines member
 * probabilities without an explicit, non-empty IndependenceJustification.
 * `combineMemberProbabilities(members)` WITHOUT a justification is
 * REJECTED loudly — never P(A+B)=P(A)P(B) by default. WITH a justification,
 * the product is returned carrying the justification and the method mark
 * 'INDEPENDENCE_JUSTIFIED_PRODUCT' — the combined value is always
 * traceable to WHY independence was claimed, and the justification bases
 * are a frozen vocabulary of defensible grounds.
 *
 * The composition CONTENT may carry the resulting records (independence
 * assessments) — validated to reference THIS composition's members only.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import { CompositionError } from './errors.js';

/** The frozen vocabulary of independence-justification grounds. */
export const INDEPENDENCE_BASES = [
  /** Members were designed to fail independently (separate failure domains by design). */
  'DESIGNED_ISOLATION',
  /** Non-correlation was MEASURED across the relevant contexts (cited evidence). */
  'MEASURED_NON_CORRELATION',
  /** The members' failure modes are disjoint by mechanism (documented analysis). */
  'DISJOINT_FAILURE_MODES',
  /** Architectural partition guarantees isolation (physical/logical partition). */
  'ARCHITECTURAL_PARTITION',
] as const;

export type IndependenceBasis = (typeof INDEPENDENCE_BASES)[number];

const INDEPENDENCE_BASE_SET: ReadonlySet<string> = new Set(INDEPENDENCE_BASES);

export function isIndependenceBasis(value: unknown): value is IndependenceBasis {
  return typeof value === 'string' && INDEPENDENCE_BASE_SET.has(value);
}

/** An explicit justification for treating member outcomes as independent. */
export interface IndependenceJustification {
  /** One of the 4 frozen grounds. */
  basis: IndependenceBasis;
  /** The justification statement (non-empty — WHO concluded WHAT, on what grounds). */
  justification: string;
  /** Optional evidence artifact id backing the justification. */
  evidence_ref?: string;
}

/** A member probability entering a justified combination. */
export interface MemberProbability {
  /** The member package id (must be a member of the composition being assessed). */
  package_id: string;
  /** The member's calibrated success probability in [0, 1]. */
  probability: number;
}

/** A justified combined probability (never minted without its justification). */
export interface JustifiedCombinedProbability {
  /** The combined value (product of the member probabilities). */
  value: number;
  /** Always 'INDEPENDENCE_JUSTIFIED_PRODUCT' — unjustified products do not exist. */
  method: 'INDEPENDENCE_JUSTIFIED_PRODUCT';
  /** The justification that authorized the combination. */
  justification: IndependenceJustification;
  /** The members combined (order preserved). */
  members: MemberProbability[];
}

function assertValidJustification(value: unknown): asserts value is IndependenceJustification {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CompositionError(`independence justification must be an object { basis, justification, evidence_ref? }, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const hasEvidenceRef = 'evidence_ref' in record;
  if (Object.keys(record).length !== (hasEvidenceRef ? 3 : 2)) {
    throw new CompositionError('independence justification must have the exact field set { basis, justification [, evidence_ref] }');
  }
  if (!isIndependenceBasis(record['basis'])) {
    throw new CompositionError(
      `independence justification basis must be one of ${INDEPENDENCE_BASES.join(', ')}, received: ${JSON.stringify(record['basis'])}`,
    );
  }
  if (typeof record['justification'] !== 'string' || record['justification'].length === 0) {
    throw new CompositionError(
      `independence justification statement must be a non-empty string, received: ${JSON.stringify(record['justification'])}`,
    );
  }
  if (hasEvidenceRef && record['evidence_ref'] !== undefined) {
    if (!isArtifactId(record['evidence_ref'])) {
      throw new CompositionError(
        `independence justification evidence_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['evidence_ref'])}`,
      );
    }
  }
}

function assertValidMembers(value: unknown): asserts value is MemberProbability[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new CompositionError(
      `combining probabilities requires at least 2 member probabilities (a composition composes packages), received: ${JSON.stringify(value)}`,
    );
  }
  for (const member of value) {
    if (typeof member !== 'object' || member === null || Array.isArray(member)) {
      throw new CompositionError(`member probability must be an object { package_id, probability }, received: ${JSON.stringify(member)}`);
    }
    const record = member as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || !('package_id' in record) || !('probability' in record)) {
      throw new CompositionError('member probability must have the exact field set { package_id, probability }');
    }
    if (!isArtifactId(record['package_id'])) {
      throw new CompositionError(
        `member probability package_id must be a well-formed spine artifact id, received: ${JSON.stringify(record['package_id'])}`,
      );
    }
    const probability = record['probability'];
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new CompositionError(
        `member probability must be a finite number in [0, 1], received: ${JSON.stringify(probability)}`,
      );
    }
  }
}

/**
 * Combine member success probabilities into a composition-level probability.
 *
 * WITHOUT a justification: REJECTED — never P(A+B)=P(A)P(B) by default.
 * WITH a justification: returns the product, marked with the method
 * 'INDEPENDENCE_JUSTIFIED_PRODUCT' and carrying the justification.
 */
export function combineMemberProbabilities(
  members: readonly MemberProbability[],
  justification?: IndependenceJustification,
): JustifiedCombinedProbability {
  assertValidMembers(members);
  if (justification === undefined || justification === null) {
    throw new CompositionError(
      'unjustified probability multiplication rejected: combining member probabilities requires an explicit ' +
        'independence justification — never P(A+B)=P(A)P(B) by default ' +
        '(docs/probabilistic-learning.md; spec/architecture-lock.md)',
    );
  }
  assertValidJustification(justification);
  let value = 1;
  for (const member of members) {
    value *= member.probability;
  }
  return {
    value,
    method: 'INDEPENDENCE_JUSTIFIED_PRODUCT',
    justification,
    members: members.map((member) => ({ ...member })),
  };
}

/** Validate a recorded independence assessment (throws CompositionError). */
export function assertValidIndependenceAssessment(
  value: unknown,
  memberPackageIds: readonly string[],
): asserts value is JustifiedCombinedProbability {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CompositionError(`independence assessment must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4 || !('value' in record) || !('method' in record) || !('justification' in record) || !('members' in record)) {
    throw new CompositionError(
      'independence assessment must have the exact field set { value, method, justification, members }',
    );
  }
  if (record['method'] !== 'INDEPENDENCE_JUSTIFIED_PRODUCT') {
    throw new CompositionError(
      `independence assessment method must be INDEPENDENCE_JUSTIFIED_PRODUCT, received: ${JSON.stringify(record['method'])} ` +
        '(unjustified products are never recorded)',
    );
  }
  assertValidJustification(record['justification']);
  const members = record['members'];
  if (!Array.isArray(members) || members.length < 2) {
    throw new CompositionError('independence assessment must combine at least 2 member probabilities');
  }
  const memberSet = new Set(memberPackageIds);
  for (const member of members) {
    const memberRecord = member as Record<string, unknown>;
    if (typeof memberRecord !== 'object' || memberRecord === null || Array.isArray(memberRecord)) {
      throw new CompositionError(`independence assessment member must be an object, received: ${JSON.stringify(member)}`);
    }
    if (Object.keys(memberRecord).length !== 2 || !('package_id' in memberRecord) || !('probability' in memberRecord)) {
      throw new CompositionError('independence assessment member must have the exact field set { package_id, probability }');
    }
    if (!isArtifactId(memberRecord['package_id'])) {
      throw new CompositionError(
        `independence assessment member package_id must be a well-formed spine id, received: ${JSON.stringify(memberRecord['package_id'])}`,
      );
    }
    if (!memberSet.has(memberRecord['package_id'] as string)) {
      throw new CompositionError(
        `independence assessment references a package that is NOT a member of this composition: ${JSON.stringify(memberRecord['package_id'])}`,
      );
    }
    const probability = memberRecord['probability'];
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new CompositionError(
        `independence assessment member probability must be a finite number in [0, 1], received: ${JSON.stringify(probability)}`,
      );
    }
  }
  const recordValue = record['value'];
  let expected = 1;
  for (const member of members as MemberProbability[]) {
    expected *= member.probability;
  }
  if (typeof recordValue !== 'number' || !Number.isFinite(recordValue) || Math.abs(recordValue - expected) > 1e-12) {
    throw new CompositionError(
      `independence assessment value must equal the product of its member probabilities (${expected}), received: ${JSON.stringify(recordValue)}`,
    );
  }
}
