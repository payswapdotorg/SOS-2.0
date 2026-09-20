/**
 * DECISION RECORDS — the Decision-kind spine artifacts the engine produces.
 *
 * The action vocabulary is the FROZEN SIX, CONSUMED from @sos-2/authority's
 * DECISION_ACTIONS (never redefined, never extended — spec/architecture-
 * lock.md places "Decision/ASK semantics" outside ordinary redefinition).
 * Every record carries:
 *
 *   - action          : exactly one of the frozen six
 *   - engine_version  : the engine realization version (part of
 *                        reproducibility — same version + same input =
 *                        same record)
 *   - input_digest    : the canonical sha-256 of the exact request (the
 *                        R30 reproducibility anchor)
 *   - rule_trace      : the ORDERED trace of which rules fired, with each
 *                        rule's outcome (null = pass-through) and reason.
 *                        Non-empty by construction — a decision without a
 *                        rule trace is REJECTED by validation.
 *   - request_summary : the risk/impact profile snapshot (what was decided)
 *   - authority       : what authority was consulted (required/effective
 *                        levels, verdict code, grant refs, applied raises)
 *   - escalation      : non-null iff action is ASK (the structured
 *                        escalation code + message)
 *   - resolution      : non-null iff minted through the resolution path
 *                        (resolution.ts — an ASK resolved by an authority)
 *   - evidence_refs   : exact spine ids of the consulted evidence (sorted)
 *   - confidence      : the request's confidence mark, RECORDED and never
 *                        consulted (the W9 discipline)
 *   - reasons         : the non-empty audit trail
 *
 * Identity discipline: ids are ALWAYS minted by the spine (deterministic
 * content-addressing over the creation address), exactly like
 * @sos-2/promotion's decision records. 'Decision' is one of the 19 frozen
 * core kinds — no registration is performed and none is needed.
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
  RFC3339_PATTERN,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { DECISION_ACTIONS, isDecisionAction, isGrantPermission } from '@sos-2/authority';
import type { AuthorizationTarget, DecisionAction, UncertaintyStatement } from '@sos-2/authority';
import { isAutonomyLevel, isBlastRadius, isReversibilityClass } from '@sos-2/autonomy';
import type { AutonomyLevel, BlastRadius, ReversibilityClass } from '@sos-2/autonomy';
import { validateConfidence } from '@sos-2/evidence';
import type { Confidence } from '@sos-2/evidence';
import { DecisionError } from './errors.js';
import { isImpactClass } from './request.js';
import type { ImpactClass } from './request.js';

/** The (core, frozen) artifact kind segment used for decision record ids. */
export const DECISION_RECORD_KIND = 'Decision';

/** The engine realization version (part of the reproducible record identity). */
export const DECISION_ENGINE_VERSION = '1.0.0';

/** One rule-trace entry: which rule fired, in which order, with what outcome. */
export interface DecisionRuleTraceEntry {
  /** The rule that fired (R0_SHAPE, R1_AUTHORITY, R2_SAFETY, R3_EVIDENCE, R4_UNCERTAINTY, R5_ACT, RESOLUTION). */
  rule: string;
  /** 1-based position in the trace (matches evaluation order). */
  order: number;
  /** The decision this rule forced, or null when the rule passed control on. */
  outcome: DecisionAction | null;
  /** Structured detail code (authority verdict code, escalation code, ...), or null. */
  code: string | null;
  /** The human-readable reason this rule fired as it did (non-empty). */
  reason: string;
}

/** The risk/impact profile snapshot of what was decided. */
export interface DecisionRequestSummary {
  action_kind: string;
  action_description: string;
  target: AuthorizationTarget;
  blast_radius: BlastRadius;
  impact: ImpactClass;
  risk: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  reversibility: ReversibilityClass;
  causal_claim: boolean;
  uncertainty: UncertaintyStatement;
}

/** What authority was consulted for the decision. */
export interface DecisionAuthorityTrace {
  /** The policy-table default level. */
  required_level: AutonomyLevel;
  /** The default raised by applicable grant-backed raises. */
  effective_level: AutonomyLevel;
  /** The autonomy verdict code (PERMITTED | EXPIRED | REVOKED | NO_GRANT | ... | escalation codes). */
  verdict_code: string;
  /** The authorizing grant (spine id), or null. */
  grant_ref: string | null;
  /** All presented grant ids (sorted). */
  consulted_grant_refs: string[];
  /** Applied, grant-backed raise ids (sorted). */
  applied_raise_refs: string[];
}

/** The structured escalation block — REQUIRED when action is ASK. */
export interface DecisionEscalation {
  /** The escalation code (an @sos-2/autonomy verdict/escalation code or this engine's codes). */
  code: string;
  /** The message a decider needs to see (non-empty). */
  message: string;
}

/** The resolution block — REQUIRED when the record was minted via the resolution path. */
export interface DecisionResolution {
  /** WHO resolved the ask (non-empty; the human/authority identity). */
  resolved_by: string;
  /** The chosen alternative id (must be one of the ask's alternatives). */
  alternative_id: string;
  /** The resolved AskRequest (spine id). */
  ask_ref: string;
  /** The ASK decision record that produced the ask (spine id). */
  origin_decision_ref: string;
  /** The resolver's note (non-empty). */
  note: string;
}

/** The full decision record content (the exact creation content). */
export interface DecisionRecordContent {
  action: DecisionAction;
  engine_version: string;
  input_digest: string;
  rule_trace: DecisionRuleTraceEntry[];
  request_summary: DecisionRequestSummary;
  authority: DecisionAuthorityTrace;
  escalation: DecisionEscalation | null;
  resolution: DecisionResolution | null;
  evidence_refs: string[];
  confidence: Confidence | null;
  reasons: string[];
}

export interface DecisionRecord {
  /** Semantic Spine envelope; kind is always "Decision" (frozen core kind). */
  envelope: ArtifactEnvelope;
  content: DecisionRecordContent;
}

export interface DecisionMeta {
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

export interface DecisionRecordCreationAddress {
  kind: 'Decision';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: DecisionRecordContent;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

const CONTENT_KEYS = [
  'action',
  'engine_version',
  'input_digest',
  'rule_trace',
  'request_summary',
  'authority',
  'escalation',
  'resolution',
  'evidence_refs',
  'confidence',
  'reasons',
] as const;

function assertValidRuleTrace(value: unknown): asserts value is DecisionRuleTraceEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DecisionError('rule_trace must be a NON-EMPTY array — a decision without a rule trace is REJECTED (every decision is auditable, rule by rule)');
  }
  const orders: number[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      throw new DecisionError('rule_trace entries must be objects { rule, order, outcome, code, reason }');
    }
    if (
      Object.keys(entry).length !== 5 ||
      !isNonEmptyString(entry['rule']) ||
      typeof entry['order'] !== 'number' ||
      !Number.isInteger(entry['order']) ||
      entry['order'] < 1 ||
      (entry['outcome'] !== null && !isDecisionAction(entry['outcome'])) ||
      (entry['code'] !== null && !isNonEmptyString(entry['code'])) ||
      !isNonEmptyString(entry['reason'])
    ) {
      throw new DecisionError(
        'rule_trace entries must be { rule, order, outcome, code, reason } with a non-empty rule, 1-based integer order, an outcome from the frozen six or null, and a non-empty reason',
      );
    }
    orders.push(entry['order']);
  }
  if (!orders.every((order, index) => order === index + 1)) {
    throw new DecisionError('rule_trace orders must be exactly 1, 2, 3, ... in evaluation order (deterministic, contiguous)');
  }
}

/**
 * Validate decision record content (throws DecisionError): the action is
 * from the frozen six; the rule trace is non-empty and contiguous; the
 * escalation block is REQUIRED when and only when the action is ASK; the
 * resolution block is REQUIRED when and only when the record was minted
 * via the resolution path (the RESOLUTION rule); the digest is a sha-256
 * hex; evidence refs are spine ids.
 */
export function assertValidDecisionRecordContent(value: unknown): asserts value is DecisionRecordContent {
  if (!isPlainObject(value)) {
    throw new DecisionError(`decision record content must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== CONTENT_KEYS.length ||
    !CONTENT_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw new DecisionError(`decision record content must have the exact field set { ${CONTENT_KEYS.join(', ')} }`);
  }
  if (!isDecisionAction(record['action'])) {
    throw new DecisionError(
      `decision action must be one of the frozen six (ACT, EXPERIMENT, GATHER_EVIDENCE, ASK, REJECT, ROLLBACK) from @sos-2/authority, received: ${JSON.stringify(record['action'])}`,
    );
  }
  const action = record['action'];
  if (!isNonEmptyString(record['engine_version'])) {
    throw new DecisionError('engine_version must be a non-empty string (part of reproducibility)');
  }
  if (typeof record['input_digest'] !== 'string' || !/^[0-9a-f]{64}$/.test(record['input_digest'])) {
    throw new DecisionError(
      `input_digest must be the 64-hex canonical sha-256 of the exact decision input, received: ${JSON.stringify(record['input_digest'])}`,
    );
  }
  assertValidRuleTrace(record['rule_trace']);

  // The escalation block exists iff action is ASK.
  if (action === 'ASK') {
    if (record['escalation'] === null || !isPlainObject(record['escalation'])) {
      throw new DecisionError('an ASK decision REQUIRES a structured escalation block { code, message }');
    }
    if (
      Object.keys(record['escalation']).length !== 2 ||
      !isNonEmptyString(record['escalation']['code']) ||
      !isNonEmptyString(record['escalation']['message'])
    ) {
      throw new DecisionError('the escalation block must be exactly { code, message } with non-empty strings');
    }
  } else if (record['escalation'] !== null) {
    throw new DecisionError(`a ${JSON.stringify(action)} decision carries no escalation block (only ASK escalates)`);
  }

  // The resolution block exists iff the trace is a RESOLUTION trace.
  const trace = record['rule_trace'] as DecisionRuleTraceEntry[];
  const isResolution = trace.length === 1 && trace[0]!.rule === 'RESOLUTION';
  if (isResolution) {
    if (record['resolution'] === null || !isPlainObject(record['resolution'])) {
      throw new DecisionError('a resolution decision REQUIRES a resolution block { resolved_by, alternative_id, ask_ref, origin_decision_ref, note }');
    }
    const resolution = record['resolution'];
    if (
      Object.keys(resolution).length !== 5 ||
      !isNonEmptyString(resolution['resolved_by']) ||
      !isNonEmptyString(resolution['alternative_id']) ||
      !isNonEmptyString(resolution['ask_ref']) ||
      !isNonEmptyString(resolution['origin_decision_ref']) ||
      !isNonEmptyString(resolution['note'])
    ) {
      throw new DecisionError('the resolution block must be { resolved_by, alternative_id, ask_ref, origin_decision_ref, note } with non-empty strings');
    }
    if (record['action'] === 'ASK') {
      throw new DecisionError('a resolution decision cannot itself be ASK (re-asking is a new AskRequest, not a resolution)');
    }
  } else if (record['resolution'] !== null) {
    throw new DecisionError('an engine decision carries no resolution block (only resolution-path records do)');
  }

  // Request summary.
  const summary = record['request_summary'];
  if (!isPlainObject(summary)) {
    throw new DecisionError('request_summary must be an object (the risk/impact profile snapshot)');
  }
  if (
    Object.keys(summary).length !== 9 ||
    !isGrantPermission(summary['action_kind']) ||
    !isNonEmptyString(summary['action_description']) ||
    !isPlainObject(summary['target']) ||
    !isBlastRadius(summary['blast_radius']) ||
    !isImpactClass(summary['impact']) ||
    !['LOW', 'MODERATE', 'HIGH', 'SEVERE'].includes(summary['risk'] as string) ||
    !isReversibilityClass(summary['reversibility']) ||
    typeof summary['causal_claim'] !== 'boolean' ||
    !isPlainObject(summary['uncertainty'])
  ) {
    throw new DecisionError('request_summary must be the exact 9-field risk/impact profile snapshot with every frozen vocabulary respected');
  }

  // Authority trace.
  const authority = record['authority'];
  if (!isPlainObject(authority)) {
    throw new DecisionError('authority must be an object (the consulted-authority trace)');
  }
  if (
    Object.keys(authority).length !== 6 ||
    !isAutonomyLevel(authority['required_level']) ||
    !isAutonomyLevel(authority['effective_level']) ||
    !isNonEmptyString(authority['verdict_code']) ||
    (authority['grant_ref'] !== null && !isNonEmptyString(authority['grant_ref'])) ||
    !isStringArray(authority['consulted_grant_refs']) ||
    !isStringArray(authority['applied_raise_refs'])
  ) {
    throw new DecisionError('authority must be { required_level, effective_level, verdict_code, grant_ref, consulted_grant_refs, applied_raise_refs }');
  }

  if (!isStringArray(record['evidence_refs'])) {
    throw new DecisionError('evidence_refs must be an array of spine artifact ids');
  }
  if (record['confidence'] !== null && !validateConfidence(record['confidence'])) {
    throw new DecisionError('confidence must be null or a valid @sos-2/evidence Confidence (calibrated marks require a calibration artifact ref)');
  }
  if (!isNonEmptyStringArray(record['reasons'])) {
    throw new DecisionError('reasons must be a non-empty array of non-empty strings (every decision is auditable)');
  }
}

export function decisionRecordCreationAddress(
  meta: DecisionMeta,
  content: DecisionRecordContent,
): DecisionRecordCreationAddress {
  return {
    kind: DECISION_RECORD_KIND,
    version: meta.version ?? 1,
    status: meta.status ?? 'DRAFT',
    authority_ref: meta.authority_ref ?? null,
    provenance: [...meta.provenance],
    created_at: meta.created_at,
    supersedes: meta.supersedes ?? null,
    content,
  };
}

/** Derive the deterministic decision record id for a meta + content. */
export function decisionRecordId(meta: DecisionMeta, content: DecisionRecordContent): string {
  return deriveDeterministicArtifactId(DECISION_RECORD_KIND, decisionRecordCreationAddress(meta, content));
}

/** Mint a decision record artifact (deterministic, content-addressed id). */
export function createDecisionRecord(meta: DecisionMeta, content: DecisionRecordContent): DecisionRecord {
  if (typeof meta !== 'object' || meta === null) {
    throw new DecisionError('decision record meta must be an object');
  }
  if (!isNonEmptyStringArray(meta.provenance)) {
    throw new DecisionError('provenance must be a non-empty array of non-empty strings');
  }
  if (typeof meta.created_at !== 'string' || !RFC3339_PATTERN.test(meta.created_at)) {
    throw new DecisionError(`created_at must be an RFC3339 timestamp, received: ${JSON.stringify(meta.created_at)}`);
  }
  if (meta.authority_ref !== undefined && meta.authority_ref !== null && !isArtifactId(meta.authority_ref)) {
    throw new DecisionError(`authority_ref must be a well-formed spine artifact id or null, received: ${JSON.stringify(meta.authority_ref)}`);
  }
  assertValidDecisionRecordContent(content);
  const cloned: DecisionRecordContent = structuredClone(content);

  const address = decisionRecordCreationAddress(meta, cloned);
  const id = deriveDeterministicArtifactId(DECISION_RECORD_KIND, address);
  const envelope = createEnvelope({
    kind: DECISION_RECORD_KIND,
    version: address.version,
    status: address.status,
    authority_ref: address.authority_ref,
    provenance: address.provenance,
    created_at: address.created_at,
    supersedes: address.supersedes,
    id,
  });
  return { envelope, content: cloned };
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/**
 * Full semantic validation of a decision record artifact (throws
 * DecisionError): exact artifact shape, spine-valid envelope of frozen
 * kind Decision, valid content (frozen-six action, non-empty contiguous
 * rule trace, escalation iff ASK, resolution iff the resolution path).
 */
export function assertValidDecisionRecord(value: unknown): asserts value is DecisionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DecisionError('decision record artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new DecisionError('decision record artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new DecisionError(`decision record envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== DECISION_RECORD_KIND) {
    throw new DecisionError(
      `decision record envelope kind must be "${DECISION_RECORD_KIND}" (frozen core kind), received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidDecisionRecordContent(record['content']);
}

/** Predicate form of assertValidDecisionRecord. */
export function validateDecisionRecord(value: unknown): value is DecisionRecord {
  try {
    assertValidDecisionRecord(value);
    return true;
  } catch {
    return false;
  }
}

/** The frozen six, re-exported for callers of this package (authority remains the owner). */
export { DECISION_ACTIONS };
