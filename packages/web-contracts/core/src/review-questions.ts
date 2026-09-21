/**
 * The six product review questions (ARCHITECT_START_HERE.md "Product
 * review" / user-journey-simulation.md "Global product requirement") and
 * the rationale view that answers them for any spine subject.
 *
 * Every consequential surface deep-links to a rationale view
 * (/rationale/<kind>/<segment>) that answers:
 *   What is happening? Why does SOS believe this? What evidence supports
 *   it? What uncertainty remains? What authority is required? What can
 *   happen next?
 */

import type { TraceLink } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { isArtifactId } from '@sos-2/semantic-spine';
import type { RationaleChain } from '@sos-2/ui-contracts';
import { buildRationaleChain } from '@sos-2/ui-contracts';
import { WebContractError } from './errors.js';

/** The six product review questions, in the frozen order. */
export const PRODUCT_REVIEW_QUESTIONS = [
  'WHAT_IS_HAPPENING',
  'WHY_DOES_SOS_BELIEVE_THIS',
  'WHAT_EVIDENCE_SUPPORTS_IT',
  'WHAT_UNCERTAINTY_REMAINS',
  'WHAT_AUTHORITY_IS_REQUIRED',
  'WHAT_CAN_HAPPEN_NEXT',
] as const;

export type ProductReviewQuestion = (typeof PRODUCT_REVIEW_QUESTIONS)[number];

export function isProductReviewQuestion(value: unknown): value is ProductReviewQuestion {
  return typeof value === 'string' && (PRODUCT_REVIEW_QUESTIONS as readonly string[]).includes(value);
}

/** The user-facing wording of each question (rendered as the rationale view's headings). */
export function productReviewQuestionLabel(question: ProductReviewQuestion): string {
  switch (question) {
    case 'WHAT_IS_HAPPENING':
      return 'What is happening?';
    case 'WHY_DOES_SOS_BELIEVE_THIS':
      return 'Why does SOS believe this?';
    case 'WHAT_EVIDENCE_SUPPORTS_IT':
      return 'What evidence supports it?';
    case 'WHAT_UNCERTAINTY_REMAINS':
      return 'What uncertainty remains?';
    case 'WHAT_AUTHORITY_IS_REQUIRED':
      return 'What authority is required?';
    case 'WHAT_CAN_HAPPEN_NEXT':
      return 'What can happen next?';
  }
}

/** The six answers, keyed by question (every answer non-empty — an unanswered question is not shipped). */
export type ReviewAnswers = Record<ProductReviewQuestion, string>;

/** One evidence row of the rationale view (the exact truth state preserved). */
export interface RationaleEvidenceRow {
  evidence_id: string;
  kind: string;
  availability: EvidenceTruthState;
  subject_ref: string;
  /** True when the record is model output — never authoritative by contract. */
  llm_output: boolean;
}

/** The rationale view model for one spine subject. */
export interface RationaleViewVM {
  subject_id: string;
  /** User-facing label of the subject (what the artifact IS, in product words). */
  subject_label: string;
  answers: ReviewAnswers;
  rationale: RationaleChain;
  evidence: RationaleEvidenceRow[];
  /** The upstream links rendered as "why" rows (already sorted by the chain builder). */
  upstream_links: TraceLink[];
  /** The downstream links rendered as consequence rows. */
  downstream_links: TraceLink[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Does the link pool carry ANY typed trace link mentioning this subject?
 * A rationale view requires at least one link (the W11 discipline: a
 * decision that explains nothing is not explainable); surfaces use this
 * predicate to render an honest state block instead of a broken view.
 */
export function hasRationaleFor(subjectId: string, links: readonly TraceLink[]): boolean {
  if (!isArtifactId(subjectId)) {
    throw new WebContractError(
      `rationale subjects must be well-formed spine artifact ids, received: ${JSON.stringify(subjectId)}`,
    );
  }
  return links.some((link) => link.source === subjectId || link.target === subjectId);
}

/**
 * Project the rationale view of one spine subject (deterministic, total).
 * The answers are assembled by the caller from the subject's view models
 * (every product view model structurally carries them); the chain and the
 * evidence rows are built here from the link/evidence pools. Throws
 * WebContractError for a malformed subject, a missing answer, or a subject
 * with no trace links in the pool (check hasRationaleFor first).
 */
export function projectRationaleView(input: {
  subject_id: string;
  subject_label: string;
  answers: ReviewAnswers;
  links: readonly TraceLink[];
  /** The subject's supporting evidence ids (from its view models), folded into the rendered rows. */
  evidence_refs?: readonly string[];
  evidence: readonly {
    id: string;
    kind: string;
    availability: EvidenceTruthState;
    subject_ref: string;
    llm_output: boolean;
  }[];
}): RationaleViewVM {
  if (!isArtifactId(input.subject_id)) {
    throw new WebContractError(
      `rationale view subjects must be well-formed spine artifact ids, received: ${JSON.stringify(input.subject_id)}`,
    );
  }
  if (!isNonEmptyString(input.subject_label)) {
    throw new WebContractError('rationale view subject_label must be a non-empty string');
  }
  for (const question of PRODUCT_REVIEW_QUESTIONS) {
    if (!isNonEmptyString(input.answers[question])) {
      throw new WebContractError(
        `rationale view for ${JSON.stringify(input.subject_id)} is missing the answer to ${question}`,
      );
    }
  }
  const chain = buildRationaleChain({
    subject_id: input.subject_id,
    links: input.links,
    evidence_refs: input.evidence_refs ?? [],
  });
  const relevant = new Set(chain.evidence_refs);
  for (const link of chain.upstream) {
    // Evidence links pointing at the subject surface their records too.
    if (link.type === 'VERIFIES' || link.type === 'OBSERVES' || link.type === 'SUPPORTS') {
      relevant.add(link.source);
    }
  }
  const evidence = input.evidence
    .filter((record) => relevant.has(record.id))
    .map((record) => ({
      evidence_id: record.id,
      kind: record.kind,
      availability: record.availability,
      subject_ref: record.subject_ref,
      llm_output: record.llm_output,
    }))
    .sort((a, b) => (a.evidence_id < b.evidence_id ? -1 : a.evidence_id > b.evidence_id ? 1 : 0));
  return {
    subject_id: input.subject_id,
    subject_label: input.subject_label,
    answers: { ...input.answers },
    rationale: chain,
    evidence,
    upstream_links: chain.upstream,
    downstream_links: chain.downstream,
  };
}
