/**
 * Promotion DECISION records — the Decision-kind spine artifacts the
 * promotion gate produces (Work Order W9; spec/architecture.md §5:
 * "Decision: ACT, EXPERIMENT, GATHER_EVIDENCE, ASK, REJECT or ROLLBACK").
 *
 * The action vocabulary is the FROZEN six, CONSUMED from @sos-2/authority's
 * DECISION_ACTIONS (never redefined, never extended — spec/architecture-
 * lock.md places "Decision/ASK semantics" outside ordinary redefinition).
 * Every promotion evaluation produces exactly one decision artifact whose
 * content carries:
 *
 *   - the action (one of the frozen six),
 *   - the candidate under evaluation (spine id),
 *   - the authority grant, assurance case and evidence records the
 *     evaluation consulted (exact spine ids — R30 reproducibility),
 *   - the reasons (non-empty; every gate's verdict is auditable),
 *   - the BOUNDED RECOVERY declaration — REQUIRED when and only when the
 *     action is ACT (a live change declares its rollback mechanism,
 *     trigger, authority and evidence; docs/assurance-model.md),
 *   - the system state revision the compatibility gate used, and the wired
 *     live trigger rule ids (audit trail).
 *
 * Identity discipline: ids are ALWAYS minted by the spine (deterministic
 * content-addressing over the creation address), exactly like
 * @sos-2/causal. 'Decision' is one of the 19 frozen core kinds — no
 * registration is performed and none is needed.
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  RFC3339_PATTERN,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { isDecisionAction } from '@sos-2/authority';
import type { DecisionAction } from '@sos-2/authority';
import { assertValidBoundedRecovery } from './recovery.js';
import type { BoundedRecoveryDeclaration } from './recovery.js';
import { PromotionError } from './errors.js';

/** The (core, frozen) artifact kind segment used for promotion decision ids. */
export const PROMOTION_DECISION_KIND = 'Decision';

/** The full promotion decision content (the exact creation content). */
export interface PromotionDecisionContent {
  /** Exactly one of the frozen six decision actions. */
  action: DecisionAction;
  /** The candidate under evaluation (sos://CandidateState/<segment>). */
  candidate_ref: string;
  /** The authority grant consulted, or null (none presented). */
  authority_grant_ref: string | null;
  /** The assurance case consulted, or null. */
  assurance_case_ref: string | null;
  /** The evidence records that satisfied the evidence gate (exact spine ids). */
  evidence_refs: string[];
  /** The evaluation reasons (non-empty, auditable). */
  reasons: string[];
  /**
   * The bounded recovery declaration — REQUIRED when action is ACT (live
   * changes declare rollback mechanism, trigger, authority and evidence),
   * null otherwise.
   */
  recovery: BoundedRecoveryDeclaration | null;
  /** The system state revision the compatibility gate used, or null. */
  system_state_revision: string | null;
  /** The wired live trigger rule ids (audit trail). */
  live_trigger_rule_ids: string[];
}

export interface CreatePromotionDecisionInput {
  content: PromotionDecisionContent;
  /** REQUIRED non-empty provenance entries (spine discipline). */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied (no hidden clocks). */
  created_at: string;
  /** Authorizing artifact id, or null. */
  authority_ref?: string | null;
  /** Version (integer >= 1). Defaults to 1. */
  version?: number;
  /** DRAFT (default) or ACTIVE. */
  status?: ArtifactStatus;
  /** Decision artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
}

/**
 * The exact value a promotion decision id is derived from (exported so
 * tests reproduce ids bit-exactly — the W0.5 fixture discipline).
 */
export interface PromotionDecisionCreationAddress {
  kind: 'Decision';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: PromotionDecisionContent;
}

export interface PromotionDecisionArtifact {
  /** Semantic Spine envelope; kind is always "Decision" (frozen core kind). */
  envelope: ArtifactEnvelope;
  /** Promotion decision content (exact field set). */
  content: PromotionDecisionContent;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate promotion decision content (throws PromotionError): the action
 * is from the frozen six, ACT carries a valid bounded recovery declaration
 * (and only ACT does), the candidate reference is present, and the reasons
 * are non-empty.
 */
export function assertValidPromotionDecisionContent(
  value: unknown,
): asserts value is PromotionDecisionContent {
  if (!isPlainObject(value)) {
    throw new PromotionError(`promotion decision content must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = [
    'action',
    'candidate_ref',
    'authority_grant_ref',
    'assurance_case_ref',
    'evidence_refs',
    'reasons',
    'recovery',
    'system_state_revision',
    'live_trigger_rule_ids',
  ];
  if (
    Object.keys(record).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw new PromotionError(`promotion decision content must have the exact field set { ${keys.join(', ')} }`);
  }
  if (!isDecisionAction(record['action'])) {
    throw new PromotionError(
      `decision action must be one of the frozen six (ACT, EXPERIMENT, GATHER_EVIDENCE, ASK, REJECT, ROLLBACK) from @sos-2/authority, received: ${JSON.stringify(record['action'])}`,
    );
  }
  if (!isNonEmptyString(record['candidate_ref'])) {
    throw new PromotionError(`candidate_ref must be a non-empty spine artifact id, received: ${JSON.stringify(record['candidate_ref'])}`);
  }
  if (record['authority_grant_ref'] !== null && !isNonEmptyString(record['authority_grant_ref'])) {
    throw new PromotionError(
      `authority_grant_ref must be null or a non-empty spine artifact id, received: ${JSON.stringify(record['authority_grant_ref'])}`,
    );
  }
  if (record['assurance_case_ref'] !== null && !isNonEmptyString(record['assurance_case_ref'])) {
    throw new PromotionError(
      `assurance_case_ref must be null or a non-empty spine artifact id, received: ${JSON.stringify(record['assurance_case_ref'])}`,
    );
  }
  if (!isStringArray(record['evidence_refs'])) {
    throw new PromotionError('evidence_refs must be an array of spine artifact ids');
  }
  if (!isNonEmptyStringArray(record['reasons'])) {
    throw new PromotionError('reasons must be a non-empty array of non-empty strings (every decision is auditable)');
  }
  if (record['action'] === 'ACT') {
    if (record['recovery'] === null) {
      throw new PromotionError(
        'an ACT decision REQUIRES a bounded recovery declaration — live changes declare rollback mechanism, trigger, authority and evidence (docs/assurance-model.md; spec/architecture.md §13)',
      );
    }
    assertValidBoundedRecovery(record['recovery']);
  } else if (record['recovery'] !== null) {
    throw new PromotionError(
      `a ${JSON.stringify(record['action'])} decision carries no recovery declaration (only ACT promotes a live change)`,
    );
  }
  if (record['system_state_revision'] !== null && !isNonEmptyString(record['system_state_revision'])) {
    throw new PromotionError(
      `system_state_revision must be null or a non-empty string, received: ${JSON.stringify(record['system_state_revision'])}`,
    );
  }
  if (!isStringArray(record['live_trigger_rule_ids'])) {
    throw new PromotionError('live_trigger_rule_ids must be an array of rule ids');
  }
}

/** The creation address of a promotion decision (envelope fields + content). */
export function promotionDecisionCreationAddress(
  input: CreatePromotionDecisionInput,
  content: PromotionDecisionContent,
): PromotionDecisionCreationAddress {
  return {
    kind: PROMOTION_DECISION_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content,
  };
}

/** Derive the deterministic promotion decision id for a creation input + content. */
export function promotionDecisionId(
  input: CreatePromotionDecisionInput,
  content: PromotionDecisionContent,
): string {
  return deriveDeterministicArtifactId(PROMOTION_DECISION_KIND, promotionDecisionCreationAddress(input, content));
}

/** Create a promotion decision artifact (deterministic, content-addressed id). */
export function createPromotionDecision(input: CreatePromotionDecisionInput): PromotionDecisionArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new PromotionError('promotion decision creation input must be an object');
  }
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new PromotionError('provenance must be a non-empty array of non-empty strings');
  }
  if (typeof input.created_at !== 'string' || !RFC3339_PATTERN.test(input.created_at)) {
    throw new PromotionError(`created_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.created_at)}`);
  }
  assertValidPromotionDecisionContent(input.content);
  const content: PromotionDecisionContent = structuredClone(input.content);

  const address = promotionDecisionCreationAddress(input, content);
  const id = deriveDeterministicArtifactId(PROMOTION_DECISION_KIND, address);
  const envelope = createEnvelope({
    kind: PROMOTION_DECISION_KIND,
    version: address.version,
    status: address.status,
    authority_ref: address.authority_ref,
    provenance: address.provenance,
    created_at: address.created_at,
    supersedes: address.supersedes,
    id,
  });
  return { envelope, content };
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/**
 * Full semantic validation of a promotion decision artifact (throws
 * PromotionError): exact artifact shape, spine-valid envelope of frozen
 * kind Decision, valid content.
 */
export function assertValidPromotionDecision(value: unknown): asserts value is PromotionDecisionArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PromotionError('promotion decision artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new PromotionError('promotion decision artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new PromotionError(`promotion decision envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== PROMOTION_DECISION_KIND) {
    throw new PromotionError(
      `promotion decision envelope kind must be "${PROMOTION_DECISION_KIND}" (frozen core kind), received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidPromotionDecisionContent(record['content']);
}

/** Predicate form of assertValidPromotionDecision. */
export function validatePromotionDecision(value: unknown): value is PromotionDecisionArtifact {
  try {
    assertValidPromotionDecision(value);
    return true;
  } catch {
    return false;
  }
}
