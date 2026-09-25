/**
 * TYPED ASK RECORDS (Work Order P13) — the P6 ASK discipline applied to
 * the mission-to-implementation pipeline.
 *
 * spec/productization-execution-architecture.md (the P6 first-class-ASK
 * rule, carried into P13): whenever authority or evidence is insufficient
 * to proceed, the pipeline emits a TYPED ASK — never a guess, never a
 * silent default, never an invented approval. An ASK is a SUCCESS STATE:
 * emitting one is a valid, first-class outcome of a pipeline stage (the
 * journey parks and waits for a decision), never an exception class.
 *
 * The record is DATA a decision authority can inspect: the stage that
 * produced it, a typed reason code, a human-readable detail, the concrete
 * open questions and a content digest of the context it arose from. The
 * ask id is content-addressed (deterministic — the same situation mints
 * the same ask id, so re-deriving a journey reproduces its asks).
 */

import { contentAddress } from '@sos-2/action-gateway';

/** The pipeline stages that can ask. */
export const PIPELINE_ASK_STAGES = ['FORMALIZATION', 'PLANNING', 'REALIZATION', 'COMPLETION'] as const;
export type PipelineAskStage = (typeof PIPELINE_ASK_STAGES)[number];

/**
 * Typed reason codes (extensible vocabulary owned by this package; each
 * stage's producers document theirs).
 */
export const PIPELINE_ASK_REASONS = [
  // FORMALIZATION
  'EMPTY_MISSION',
  'IRRESOLVABLE_AMBIGUITY',
  // PLANNING
  'MISSION_NOT_FORMALIZED',
  'NO_FEASIBLE_CANDIDATE',
  // REALIZATION (authority + repository)
  'AUTHORITY_REQUIRED',
  'AUTHORITY_REVOKED',
  'REPOSITORY_NOT_EMPTY',
  'REPOSITORY_NOT_CONNECTED',
  'NO_BODY_AVAILABLE',
  // COMPLETION (evaluation gates)
  'EVALUATION_REPAIR_EXHAUSTED',
  'REPAIR_UNAVAILABLE',
  'RUNTIME_VERIFICATION_NOT_PASSED',
  'CERTIFICATION_DENIED',
] as const;
export type PipelineAskReason = (typeof PIPELINE_ASK_REASONS)[number];

/** The typed, content-addressed ASK record. */
export interface PipelineAsk {
  /** Content-derived deterministic id ('pipeline-ask:<16 hex>'). */
  readonly askId: string;
  readonly stage: PipelineAskStage;
  readonly reasonCode: PipelineAskReason;
  readonly detail: string;
  readonly openQuestions: readonly string[];
  /** Content address of the context the ask arose from (inspectable evidence). */
  readonly contextDigest: string;
  /** RFC3339 creation instant (caller-supplied; no hidden clocks). */
  readonly createdAt: string;
}

/** Input for minting a typed ask. */
export interface MintPipelineAskInput {
  readonly stage: PipelineAskStage;
  readonly reasonCode: PipelineAskReason;
  readonly detail: string;
  readonly openQuestions: readonly string[];
  /** The context the ask arose from (any canonical-JSON value). */
  readonly context: unknown;
  readonly createdAt: string;
}

/** Mint a typed ASK (deterministic id — identical situations mint identical ids). */
export function mintPipelineAsk(input: MintPipelineAskInput): PipelineAsk {
  if (!PIPELINE_ASK_STAGES.includes(input.stage)) {
    throw new TypeError(`pipeline ask stage must be one of ${PIPELINE_ASK_STAGES.join(', ')}, received: ${JSON.stringify(input.stage)}`);
  }
  if (!PIPELINE_ASK_REASONS.includes(input.reasonCode)) {
    throw new TypeError(`pipeline ask reasonCode must be one of the typed reasons, received: ${JSON.stringify(input.reasonCode)}`);
  }
  if (typeof input.detail !== 'string' || input.detail.length === 0) {
    throw new TypeError('pipeline ask detail must be a non-empty string');
  }
  if (
    !Array.isArray(input.openQuestions) ||
    input.openQuestions.some((question) => typeof question !== 'string' || question.length === 0)
  ) {
    throw new TypeError('pipeline ask openQuestions must be an array of non-empty strings');
  }
  if (typeof input.createdAt !== 'string' || input.createdAt.length === 0) {
    throw new TypeError('pipeline ask createdAt must be a non-empty RFC3339 string');
  }
  const contextDigest = contentAddress(input.context, 'pipeline-ask-context');
  return {
    askId: contentAddress(
      {
        stage: input.stage,
        reasonCode: input.reasonCode,
        detail: input.detail,
        openQuestions: [...input.openQuestions],
        contextDigest,
        createdAt: input.createdAt,
      },
      'pipeline-ask',
    ),
    stage: input.stage,
    reasonCode: input.reasonCode,
    detail: input.detail,
    openQuestions: [...input.openQuestions],
    contextDigest,
    createdAt: input.createdAt,
  };
}
