/**
 * The ASK contract — first-class, per spec/architecture.md §5 "Decision" and
 * spec/requirements.md R15/R16 (authority-aware autonomy; first-class ASK).
 *
 * An AskRequest is what a system produces when the decision is ASK: current
 * authority is insufficient, and the EXACT decision is escalated to the
 * competent authority together with everything a human needs to decide:
 *
 *   - decision               : the EXACT decision requested (not a vague topic)
 *   - alternatives           : TYPED alternatives (each carries one of the 6
 *                              frozen Decision actions)
 *   - evidence_quality       : qualitative evidence-quality summary
 *                              (NONE / WEAK / MODERATE / STRONG)
 *   - uncertainty            : qualitative uncertainty class + basis
 *                              (LOW / MODERATE / HIGH / IRREDUCIBLE)
 *   - trade_offs             : the trade-offs in play (non-empty)
 *   - risk                   : typed risk { description, severity }
 *   - authority_insufficiency: WHY current authority is insufficient (non-empty)
 *
 * ASK IS A SUCCESS STATE (R16): constructing an AskRequest is a positive
 * workflow — it never throws for valid input, and 'ASK' is a first-class
 * member of DECISION_ACTIONS. It is not an error class.
 *
 * Confidence policy (spec/meta-model.md): numeric confidence is valid only
 * where calibration exists; the AskRequest contract carries QUALITATIVE
 * classes only. A `confidence` field is explicitly rejected (an uncalibrated
 * number — e.g. an LLM self-report — is never accepted as evidence of
 * certainty).
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { isDecisionAction } from './decisions.js';
import type { DecisionAction } from './decisions.js';
import { AuthorityError } from './errors.js';

export const ASK_REQUEST_KIND = 'AskRequest';

/** Qualitative evidence-quality classes (never numeric — see module doc). */
export const EVIDENCE_QUALITY_CLASSES = ['NONE', 'WEAK', 'MODERATE', 'STRONG'] as const;
export type EvidenceQualityClass = (typeof EVIDENCE_QUALITY_CLASSES)[number];
const EVIDENCE_QUALITY_SET: ReadonlySet<string> = new Set(EVIDENCE_QUALITY_CLASSES);
export function isEvidenceQualityClass(value: unknown): value is EvidenceQualityClass {
  return typeof value === 'string' && EVIDENCE_QUALITY_SET.has(value);
}

/** Qualitative uncertainty classes (spec/meta-model.md: no numeric confidence without calibration). */
export const UNCERTAINTY_CLASSES = ['LOW', 'MODERATE', 'HIGH', 'IRREDUCIBLE'] as const;
export type UncertaintyClass = (typeof UNCERTAINTY_CLASSES)[number];
const UNCERTAINTY_SET: ReadonlySet<string> = new Set(UNCERTAINTY_CLASSES);
export function isUncertaintyClass(value: unknown): value is UncertaintyClass {
  return typeof value === 'string' && UNCERTAINTY_SET.has(value);
}

/** Risk severities. */
export const ASK_RISK_SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'SEVERE'] as const;
export type AskRiskSeverity = (typeof ASK_RISK_SEVERITIES)[number];
const RISK_SEVERITY_SET: ReadonlySet<string> = new Set(ASK_RISK_SEVERITIES);
export function isAskRiskSeverity(value: unknown): value is AskRiskSeverity {
  return typeof value === 'string' && RISK_SEVERITY_SET.has(value);
}

/** A typed alternative: which frozen Decision action it corresponds to, and what it means. */
export interface AskAlternative {
  id: string;
  action: DecisionAction;
  description: string;
}

export interface EvidenceQualitySummary {
  quality: EvidenceQualityClass;
  summary: string;
}

export interface UncertaintyStatement {
  uncertainty_class: UncertaintyClass;
  basis: string;
}

export interface AskRisk {
  description: string;
  severity: AskRiskSeverity;
}

export interface AskContent {
  /** The EXACT decision requested (non-empty; a decision, not a topic). */
  decision: string;
  /** Typed alternatives (at least one, unique ids, frozen Decision actions). */
  alternatives: AskAlternative[];
  evidence_quality: EvidenceQualitySummary;
  uncertainty: UncertaintyStatement;
  /** The trade-offs in play (non-empty entries). */
  trade_offs: string[];
  risk: AskRisk;
  /** WHY current authority is insufficient (non-empty). */
  authority_insufficiency: string;
}

export interface AskRequestArtifact {
  envelope: ArtifactEnvelope;
  content: AskContent;
}

export interface CreateAskRequestInput {
  content: AskContent;
  provenance: string[];
  created_at: string;
  authority_ref?: string | null;
  version?: number;
  status?: ArtifactStatus;
  supersedes?: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  // The confidence policy check comes FIRST so uncalibrated numeric confidence
  // is reported specifically, not as a generic field-set violation.
  if (Object.prototype.hasOwnProperty.call(value, 'confidence')) {
    throw new AuthorityError(
      `${what} must not carry a numeric confidence field: qualitative uncertainty classes only (spec/meta-model.md — numeric confidence is valid only where calibration exists)`,
    );
  }
  const actual = Object.keys(value);
  const expected = new Set<string>(keys);
  if (actual.length !== keys.length || !actual.every((key) => expected.has(key))) {
    throw new AuthorityError(`${what} must have the exact field set { ${keys.join(', ')} }`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const CONTENT_KEYS = [
  'decision',
  'alternatives',
  'evidence_quality',
  'uncertainty',
  'trade_offs',
  'risk',
  'authority_insufficiency',
] as const;
const ALTERNATIVE_KEYS = ['id', 'action', 'description'] as const;
const EVIDENCE_QUALITY_KEYS = ['quality', 'summary'] as const;
const UNCERTAINTY_KEYS = ['uncertainty_class', 'basis'] as const;
const RISK_KEYS = ['description', 'severity'] as const;

/** Validate AskContent (throws AuthorityError with precise messages). */
export function validateAskContent(value: unknown): asserts value is AskContent {
  if (!isPlainObject(value)) {
    throw new AuthorityError(`ask content must be an object, received: ${JSON.stringify(value)}`);
  }
  hasExactKeys(value, CONTENT_KEYS, 'ask content');
  if (value['confidence'] !== undefined) {
    throw new AuthorityError(
      'ask content must not carry a numeric confidence field: qualitative uncertainty classes only (spec/meta-model.md)',
    );
  }
  if (!isNonEmptyString(value['decision'])) {
    throw new AuthorityError('ask decision must be a non-empty string — the EXACT decision requested, not a topic');
  }
  const alternatives = value['alternatives'];
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    throw new AuthorityError('ask alternatives must be a non-empty array of typed alternatives');
  }
  const alternativeIds = new Set<string>();
  for (const alternative of alternatives) {
    if (!isPlainObject(alternative)) {
      throw new AuthorityError('ask alternatives entries must be objects { id, action, description }');
    }
    hasExactKeys(alternative, ALTERNATIVE_KEYS, 'ask alternative');
    if (!isNonEmptyString(alternative['id']) || !/^[a-z][a-z0-9-]*$/.test(alternative['id'])) {
      throw new AuthorityError(`ask alternative id must be a lowercase slug, received: ${JSON.stringify(alternative['id'])}`);
    }
    if (alternativeIds.has(alternative['id'])) {
      throw new AuthorityError(`duplicate ask alternative id: ${JSON.stringify(alternative['id'])}`);
    }
    alternativeIds.add(alternative['id']);
    if (!isDecisionAction(alternative['action'])) {
      throw new AuthorityError(
        `ask alternative ${JSON.stringify(alternative['id'])} action must be one of the 6 frozen Decision actions (ACT, EXPERIMENT, GATHER_EVIDENCE, ASK, REJECT, ROLLBACK), received: ${JSON.stringify(alternative['action'])}`,
      );
    }
    if (!isNonEmptyString(alternative['description'])) {
      throw new AuthorityError(`ask alternative ${JSON.stringify(alternative['id'])} description must be a non-empty string`);
    }
  }
  const evidenceQuality = value['evidence_quality'];
  if (!isPlainObject(evidenceQuality)) {
    throw new AuthorityError('ask evidence_quality must be an object { quality, summary }');
  }
  hasExactKeys(evidenceQuality, EVIDENCE_QUALITY_KEYS, 'ask evidence_quality');
  if (!isEvidenceQualityClass(evidenceQuality['quality'])) {
    throw new AuthorityError(
      `ask evidence_quality.quality must be one of ${EVIDENCE_QUALITY_CLASSES.join(', ')}, received: ${JSON.stringify(evidenceQuality['quality'])}`,
    );
  }
  if (!isNonEmptyString(evidenceQuality['summary'])) {
    throw new AuthorityError('ask evidence_quality.summary must be a non-empty string');
  }
  const uncertainty = value['uncertainty'];
  if (!isPlainObject(uncertainty)) {
    throw new AuthorityError('ask uncertainty must be an object { uncertainty_class, basis }');
  }
  hasExactKeys(uncertainty, UNCERTAINTY_KEYS, 'ask uncertainty');
  if (!isUncertaintyClass(uncertainty['uncertainty_class'])) {
    throw new AuthorityError(
      `ask uncertainty.uncertainty_class must be one of ${UNCERTAINTY_CLASSES.join(', ')}, received: ${JSON.stringify(uncertainty['uncertainty_class'])}`,
    );
  }
  if (!isNonEmptyString(uncertainty['basis'])) {
    throw new AuthorityError('ask uncertainty.basis must be a non-empty string');
  }
  const tradeOffs = value['trade_offs'];
  if (!Array.isArray(tradeOffs) || tradeOffs.length === 0 || !tradeOffs.every(isNonEmptyString)) {
    throw new AuthorityError('ask trade_offs must be a non-empty array of non-empty strings');
  }
  const risk = value['risk'];
  if (!isPlainObject(risk)) {
    throw new AuthorityError('ask risk must be an object { description, severity }');
  }
  hasExactKeys(risk, RISK_KEYS, 'ask risk');
  if (!isNonEmptyString(risk['description'])) {
    throw new AuthorityError('ask risk.description must be a non-empty string');
  }
  if (!isAskRiskSeverity(risk['severity'])) {
    throw new AuthorityError(
      `ask risk.severity must be one of ${ASK_RISK_SEVERITIES.join(', ')}, received: ${JSON.stringify(risk['severity'])}`,
    );
  }
  if (!isNonEmptyString(value['authority_insufficiency'])) {
    throw new AuthorityError(
      'ask authority_insufficiency must be a non-empty string — WHY current authority is insufficient',
    );
  }
}

export interface AskCreationAddress {
  kind: 'AskRequest';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: AskContent;
}

export function askCreationAddress(input: CreateAskRequestInput): AskCreationAddress {
  return {
    kind: ASK_REQUEST_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content: input.content,
  };
}

/** Derive the deterministic ask-request artifact id for a creation input. */
export function askRequestArtifactId(input: CreateAskRequestInput): string {
  return deriveDeterministicArtifactId(ASK_REQUEST_KIND, askCreationAddress(input));
}

/**
 * Create an AskRequest. ASK is a SUCCESS state: this is a positive workflow —
 * valid input never throws, and the result is a first-class, versioned
 * Semantic Spine artifact of kind AskRequest.
 */
export function createAskRequest(input: CreateAskRequestInput): AskRequestArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new AuthorityError('ask request creation input must be an object');
  }
  validateAskContent(input.content);

  const address = askCreationAddress(input);
  const id = deriveDeterministicArtifactId(ASK_REQUEST_KIND, address);
  const envelope = createEnvelope({
    kind: ASK_REQUEST_KIND,
    version: address.version,
    status: address.status,
    authority_ref: address.authority_ref,
    provenance: address.provenance,
    created_at: address.created_at,
    supersedes: address.supersedes,
    id,
  });
  return { envelope, content: structuredClone(input.content) };
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/**
 * Full semantic validation of an AskRequest artifact (throws AuthorityError):
 * exact artifact shape, spine-valid envelope of kind AskRequest, valid ask
 * content (including the no-numeric-confidence policy).
 */
export function assertValidAskRequest(value: unknown): asserts value is AskRequestArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthorityError('ask request artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new AuthorityError('ask request artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new AuthorityError(`ask request envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== ASK_REQUEST_KIND) {
    throw new AuthorityError(
      `ask request artifact envelope kind must be "${ASK_REQUEST_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  validateAskContent(record['content']);
}

/** Predicate form of assertValidAskRequest. */
export function validateAskRequest(value: unknown): value is AskRequestArtifact {
  try {
    assertValidAskRequest(value);
    return true;
  } catch {
    return false;
  }
}
