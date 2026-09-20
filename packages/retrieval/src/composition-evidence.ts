/**
 * Composition evidence independence — the retrieval-facing surface of the
 * W6 own-evidence and independence disciplines (consumed from
 * @sos-2/composition, NEVER duplicated — that package owns the locked
 * invariants; this module only delegates and surfaces).
 *
 * MACHINE-ENFORCED, LOCKED INVARIANTS (spec/architecture.md §18
 * "Compositions require their own evidence", §12 "Do not infer composition
 * success by multiplying member probabilities unless independence is
 * justified"; spec/architecture-lock.md):
 *   - a composition's evidence is evidence about THE COMPOSITION's chain;
 *     evidence about a MEMBER package is FOREIGN —
 *     `evaluateCompositionOwnEvidence` surfaces the W6 verdict, and a view
 *     citing member-subject evidence is INVALID (negative-tested here);
 *   - member probabilities are NEVER multiplied by default:
 *     `combinedCompositionProbability` delegates to the W6 authority and
 *     REJECTS the call without an explicit IndependenceJustification
 *     (negative-tested here).
 */

import {
  combineMemberProbabilities,
  evaluateOwnEvidence,
} from '@sos-2/composition';
import type {
  IndependenceJustification,
  JustifiedCombinedProbability,
  MemberProbability,
  OwnEvidenceVerdict,
} from '@sos-2/composition';
import type { EvidenceResolver } from '@sos-2/registry';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { RetrievalFacadeError } from './errors.js';
import type { ContextCandidate } from './facade.js';

/**
 * Evaluate a composition candidate's own-evidence discipline through the W6
 * authority. The candidate's OWN cited refs are resolved through the
 * caller's resolver; records about other subjects (in particular MEMBER
 * packages) are FOREIGN and make the verdict invalid — member success
 * never implies composition success.
 *
 * @param candidate  a composition ContextCandidate (own_evidence view required)
 * @param resolver   resolves evidence ids to records
 * @param chainIds   the composition's other chain ids (earlier revisions),
 *                   when known — pass them so evidence about an earlier
 *                   revision of the SAME composition counts as own evidence
 */
export function evaluateCompositionOwnEvidence(
  candidate: ContextCandidate,
  resolver: EvidenceResolver,
  chainIds: readonly string[] = [],
): OwnEvidenceVerdict {
  if (candidate.kind !== 'COMPOSITION' || candidate.own_evidence === null) {
    throw new RetrievalFacadeError(
      `own-evidence evaluation requires a composition candidate, received kind ${JSON.stringify(candidate.kind)} ` +
        `for ${candidate.id}`,
    );
  }
  const own = candidate.own_evidence;
  const resolved: EvidenceRecordW3[] = [];
  for (const ref of own.own_evidence_refs) {
    const record = resolver(ref);
    if (record !== undefined) {
      resolved.push(record);
    }
  }
  return evaluateOwnEvidence(own.own_evidence_refs, resolved, own.composition_id, [...chainIds]);
}

/**
 * Combine member probabilities into a composition-level probability —
 * DELEGATED to the W6 authority. WITHOUT an explicit
 * IndependenceJustification the call is REJECTED: never P(A+B)=P(A)P(B) by
 * default (docs/probabilistic-learning.md; spec/architecture-lock.md).
 * WITH a justification the result carries it verbatim
 * ('INDEPENDENCE_JUSTIFIED_PRODUCT').
 */
export function combinedCompositionProbability(
  members: readonly MemberProbability[],
  justification?: IndependenceJustification,
): JustifiedCombinedProbability {
  try {
    return combineMemberProbabilities(members, justification);
  } catch (cause) {
    throw new RetrievalFacadeError(
      `composition probability combination rejected by the independence discipline: ${(cause as Error).message}`,
      { cause },
    );
  }
}

/**
 * Is a candidate's own-evidence view substituting member evidence? (Always
 * false for views built by this package — the invariant is surfaced as
 * data; this predicate exists so downstream search can machine-check it.)
 */
export function memberEvidenceSubstituted(candidate: ContextCandidate): boolean {
  return candidate.kind === 'COMPOSITION' && candidate.own_evidence !== null
    ? !candidate.own_evidence.member_evidence_never_substitutes
    : false;
}
