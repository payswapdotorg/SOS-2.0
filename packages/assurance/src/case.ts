/**
 * AssuranceCase artifacts — the W8 realization of the AssuranceCase model
 * from spec/architecture.md section 5 ("Assurance Case: claims, assumptions,
 * hazards, controls, evidence, validity conditions, objections and verdict")
 * and docs/assurance-model.md
 * ("Claims + Arguments + Assumptions + Hazards + Controls + Evidence +
 *   Validity conditions + Objections").
 *
 * An AssuranceCaseArtifact is a Semantic Spine envelope (frozen CORE kind
 * "AssuranceCase" — one of the 19 meta-model kinds, used as-is, never
 * re-registered) plus the eight-section declarative content:
 *
 *   claims              what is asserted about the system (>= 1)
 *   arguments           structured argument: premises -> conclusion (claims)
 *   assumptions         statements taken as given (checked at evaluation)
 *   hazards             what can go wrong
 *   controls            mitigations addressing hazards
 *   evidence            references to Evidence artifacts, each bound to ONE
 *                       claim with a role SUPPORTS / VERIFIES / CONTRADICTS
 *   validity_conditions recorded bounds: the exact implementation /
 *                       dependency / environment revisions the case is
 *                       valid for (living assurance — see evaluate.ts)
 *   objections          first-class challenges, recorded and NEVER dropped
 *                       (see objections discipline below)
 *
 * VERDICT IS DERIVED, NEVER STORED (documented design decision): living
 * assurance means the verdict is deterministically recomputed by evaluate()
 * against the current revisions/evidence/assumption state. A stored verdict
 * would go stale silently — exactly what living assurance exists to prevent.
 *
 * OBJECTIONS DISCIPLINE (first-class, never dropped):
 *   - objections are part of the case content with a lifecycle
 *     OPEN -> RESOLVED (terminal for the objection);
 *   - no API drops an objection: the sanctioned revision helpers
 *     (addObjection, resolveObjection, adoptConformanceEvidence) only ADD
 *     objections or transition OPEN -> RESOLVED with mandatory resolution
 *     provenance;
 *   - direct case revisions (createAssuranceCase with `supersedes`) are
 *     validated by assertValidCaseRevision: every objection id of the
 *     previous revision MUST survive (possibly RESOLVED, never removed,
 *     never regressed RESOLVED -> OPEN, never re-opened with a different
 *     resolution).
 *
 * Identity discipline (mirrors W1/W2/W3/W4): the artifact id is
 * content-addressed over the exact creation address — every envelope field
 * except `id`, plus the case content:
 *
 *     sos://AssuranceCase/<first 32 hex of sha-256 over the canonical
 *                          serialization of { kind, version, status,
 *                          authority_ref, provenance, created_at,
 *                          supersedes, content }>
 *
 * Identical creation input reproduces the identical id; identity is minted
 * at creation and preserved across later lifecycle transitions (the spine
 * preserves `id` while version/supersedes carry the chain).
 */

import {
  RFC3339_PATTERN,
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
  parseArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { AssuranceError } from './errors.js';

/** The frozen core artifact kind segment used for assurance case ids. */
export const ASSURANCE_CASE_KIND = 'AssuranceCase';

// ---------------------------------------------------------------------------
// Content model
// ---------------------------------------------------------------------------

/** A claim the assurance case asserts about the system. */
export interface AssuranceClaim {
  /** Case-local claim id (non-empty, unique within the case). */
  id: string;
  /** The claimed property (non-empty). */
  statement: string;
}

/** A structured argument: premises (claims) support a conclusion (claim). */
export interface AssuranceArgument {
  /** Case-local argument id (non-empty, unique). */
  id: string;
  /** The argument strategy (non-empty) — how the premises support the conclusion. */
  strategy: string;
  /** The conclusion claim id. */
  conclusion: string;
  /** The premise claim ids (>= 1, no duplicates, excludes the conclusion). */
  premises: string[];
}

/** A statement taken as given; checked at evaluation time. */
export interface AssuranceAssumption {
  /** Case-local assumption id (non-empty, unique). */
  id: string;
  /** The assumption statement (non-empty). */
  statement: string;
}

/** A hazard: a condition that could lead to harm. */
export interface AssuranceHazard {
  /** Case-local hazard id (non-empty, unique). */
  id: string;
  /** Hazard description (non-empty). */
  description: string;
}

/** A control mitigating one or more hazards. */
export interface AssuranceControl {
  /** Case-local control id (non-empty, unique). */
  id: string;
  /** How the control mitigates (non-empty). */
  mechanism: string;
  /** The hazard ids this control addresses (>= 1, no duplicates, all known). */
  addresses: string[];
}

/** The role an evidence reference plays for its bound claim. */
export const EVIDENCE_REF_ROLES = ['SUPPORTS', 'VERIFIES', 'CONTRADICTS'] as const;

export type EvidenceRefRole = (typeof EVIDENCE_REF_ROLES)[number];

const EVIDENCE_REF_ROLE_SET: ReadonlySet<string> = new Set(EVIDENCE_REF_ROLES);

export function isEvidenceRefRole(value: unknown): value is EvidenceRefRole {
  return typeof value === 'string' && EVIDENCE_REF_ROLE_SET.has(value);
}

/**
 * A reference from the case to an Evidence artifact, bound to ONE claim with
 * one role. (The evidence records themselves live in the Evidence Graph —
 * the reference carries the spine Evidence id only.)
 */
export interface EvidenceRef {
  /** The referenced evidence artifact id: sos://Evidence/<32 hex>. */
  evidence_id: string;
  /** SUPPORTS / VERIFIES / CONTRADICTS (the spine trace link vocabulary used for adoption). */
  role: EvidenceRefRole;
  /** The claim id this evidence speaks to. */
  claim_ref: string;
}

/** The revision dimensions a validity condition can bound. */
export const VALIDITY_CONDITION_KINDS = ['IMPLEMENTATION', 'DEPENDENCY', 'ENVIRONMENT'] as const;

export type ValidityConditionKind = (typeof VALIDITY_CONDITION_KINDS)[number];

const VALIDITY_CONDITION_KIND_SET: ReadonlySet<string> = new Set(VALIDITY_CONDITION_KINDS);

export function isValidityConditionKind(value: unknown): value is ValidityConditionKind {
  return typeof value === 'string' && VALIDITY_CONDITION_KIND_SET.has(value);
}

/**
 * A recorded validity condition: the case is valid ONLY for the exact
 * recorded revisions of one implementation / dependency / environment
 * subject. Any other reported revision is out of bounds (see evaluate.ts —
 * living assurance: the case invalidates when the world moves).
 */
export interface ValidityCondition {
  /** The revision dimension this condition bounds. */
  kind: ValidityConditionKind;
  /** The bounded subject (e.g. an implementation artifact id, a dependency name, an environment id). */
  subject: string;
  /** The exact recorded revisions the case is valid for (>= 1, unique, non-empty). */
  valid_revisions: string[];
}

/** Objection lifecycle: OPEN challenges stand until explicitly resolved. */
export const OBJECTION_STATUSES = ['OPEN', 'RESOLVED'] as const;

export type ObjectionStatus = (typeof OBJECTION_STATUSES)[number];

const OBJECTION_STATUS_SET: ReadonlySet<string> = new Set(OBJECTION_STATUSES);

export function isObjectionStatus(value: unknown): value is ObjectionStatus {
  return typeof value === 'string' && OBJECTION_STATUS_SET.has(value);
}

/** How an objection was resolved (mandatory when the status is RESOLVED). */
export interface ObjectionResolution {
  /** The resolution note (non-empty). */
  note: string;
  /** RFC3339 resolution instant (>= raised_at). */
  resolved_at: string;
  /** Provenance of the resolution (non-empty entries — no anonymous resolutions). */
  provenance: string[];
}

/** A first-class objection raised against the case (or one of its claims). */
export interface Objection {
  /** Case-local objection id (non-empty, unique). */
  id: string;
  /** The objection statement (non-empty). */
  statement: string;
  /** RFC3339 instant the objection was raised. */
  raised_at: string;
  /** OPEN (unresolved) or RESOLVED (terminal for this objection). */
  status: ObjectionStatus;
  /** null while OPEN; mandatory when RESOLVED. */
  resolution: ObjectionResolution | null;
}

/** The exact eight-section assurance case content. */
export interface AssuranceCaseContent {
  claims: AssuranceClaim[];
  arguments: AssuranceArgument[];
  assumptions: AssuranceAssumption[];
  hazards: AssuranceHazard[];
  controls: AssuranceControl[];
  evidence: EvidenceRef[];
  validity_conditions: ValidityCondition[];
  objections: Objection[];
}

// ---------------------------------------------------------------------------
// Artifact shape
// ---------------------------------------------------------------------------

export interface AssuranceCaseArtifact {
  /** Semantic Spine envelope; kind is always "AssuranceCase". */
  envelope: ArtifactEnvelope;
  /** The eight-section case content. */
  content: AssuranceCaseContent;
}

export interface CreateAssuranceCaseInput {
  /** The case content (validated against the exact eight-section field set). */
  content: AssuranceCaseContent;
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
  /** AssuranceCase artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
}

/**
 * The exact value an assurance case artifact id is derived from. Exported so
 * tests and diagnostics reproduce ids bit-exactly (W0.5 fixture discipline).
 */
export interface AssuranceCaseCreationAddress {
  kind: 'AssuranceCase';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: AssuranceCaseContent;
}

export function assuranceCaseCreationAddress(
  input: CreateAssuranceCaseInput,
): AssuranceCaseCreationAddress {
  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  return {
    kind: ASSURANCE_CASE_KIND,
    version,
    status,
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content: structuredClone(input.content),
  };
}

/** Derive the deterministic assurance case artifact id for a creation input. */
export function assuranceCaseArtifactId(input: CreateAssuranceCaseInput): string {
  return deriveDeterministicArtifactId(ASSURANCE_CASE_KIND, assuranceCaseCreationAddress(input));
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => isNonEmptyString(entry));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function assertNoDuplicates(ids: readonly string[], what: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new AssuranceError(`duplicate ${what} ids are not allowed: ${JSON.stringify(ids)}`);
  }
}

/** Validate a claim (throws AssuranceError). */
export function assertValidClaim(value: unknown): asserts value is AssuranceClaim {
  if (!isPlainObject(value) || !hasExactKeys(value, ['id', 'statement'])) {
    throw new AssuranceError('claim must be an object with exact fields { id, statement }');
  }
  if (!isNonEmptyString(value['id'])) {
    throw new AssuranceError(`claim id must be a non-empty string, received: ${JSON.stringify(value['id'])}`);
  }
  if (!isNonEmptyString(value['statement'])) {
    throw new AssuranceError(`claim statement must be a non-empty string, received: ${JSON.stringify(value['statement'])}`);
  }
}

/** Validate an argument (throws AssuranceError). References are checked at content level. */
export function assertValidArgument(value: unknown): asserts value is AssuranceArgument {
  if (!isPlainObject(value) || !hasExactKeys(value, ['id', 'strategy', 'conclusion', 'premises'])) {
    throw new AssuranceError('argument must be an object with exact fields { id, strategy, conclusion, premises }');
  }
  if (!isNonEmptyString(value['id'])) {
    throw new AssuranceError(`argument id must be a non-empty string, received: ${JSON.stringify(value['id'])}`);
  }
  if (!isNonEmptyString(value['strategy'])) {
    throw new AssuranceError(`argument strategy must be a non-empty string, received: ${JSON.stringify(value['strategy'])}`);
  }
  if (!isNonEmptyString(value['conclusion'])) {
    throw new AssuranceError(`argument conclusion must be a non-empty claim id, received: ${JSON.stringify(value['conclusion'])}`);
  }
  if (!isNonEmptyStringArray(value['premises'])) {
    throw new AssuranceError('argument premises must be a non-empty array of claim ids (an argument without premises supports nothing)');
  }
  if (new Set(value['premises']).size !== value['premises'].length) {
    throw new AssuranceError(`argument ${JSON.stringify(value['id'])} has duplicate premises: ${JSON.stringify(value['premises'])}`);
  }
  if (value['premises'].includes(value['conclusion'])) {
    throw new AssuranceError(
      `argument ${JSON.stringify(value['id'])} is circular: the conclusion is also a premise (self-supporting arguments are rejected)`,
    );
  }
}

/** Validate an assumption (throws AssuranceError). */
export function assertValidAssumption(value: unknown): asserts value is AssuranceAssumption {
  if (!isPlainObject(value) || !hasExactKeys(value, ['id', 'statement'])) {
    throw new AssuranceError('assumption must be an object with exact fields { id, statement }');
  }
  if (!isNonEmptyString(value['id'])) {
    throw new AssuranceError(`assumption id must be a non-empty string, received: ${JSON.stringify(value['id'])}`);
  }
  if (!isNonEmptyString(value['statement'])) {
    throw new AssuranceError(`assumption statement must be a non-empty string, received: ${JSON.stringify(value['statement'])}`);
  }
}

/** Validate a hazard (throws AssuranceError). */
export function assertValidHazard(value: unknown): asserts value is AssuranceHazard {
  if (!isPlainObject(value) || !hasExactKeys(value, ['id', 'description'])) {
    throw new AssuranceError('hazard must be an object with exact fields { id, description }');
  }
  if (!isNonEmptyString(value['id'])) {
    throw new AssuranceError(`hazard id must be a non-empty string, received: ${JSON.stringify(value['id'])}`);
  }
  if (!isNonEmptyString(value['description'])) {
    throw new AssuranceError(`hazard description must be a non-empty string, received: ${JSON.stringify(value['description'])}`);
  }
}

/** Validate a control (throws AssuranceError). Hazard references are checked at content level. */
export function assertValidControl(value: unknown): asserts value is AssuranceControl {
  if (!isPlainObject(value) || !hasExactKeys(value, ['id', 'mechanism', 'addresses'])) {
    throw new AssuranceError('control must be an object with exact fields { id, mechanism, addresses }');
  }
  if (!isNonEmptyString(value['id'])) {
    throw new AssuranceError(`control id must be a non-empty string, received: ${JSON.stringify(value['id'])}`);
  }
  if (!isNonEmptyString(value['mechanism'])) {
    throw new AssuranceError(`control mechanism must be a non-empty string, received: ${JSON.stringify(value['mechanism'])}`);
  }
  if (!isNonEmptyStringArray(value['addresses'])) {
    throw new AssuranceError('control addresses must be a non-empty array of hazard ids (a control addressing nothing mitigates nothing)');
  }
  if (new Set(value['addresses']).size !== value['addresses'].length) {
    throw new AssuranceError(`control ${JSON.stringify(value['id'])} has duplicate hazard references: ${JSON.stringify(value['addresses'])}`);
  }
}

/**
 * Validate an evidence reference (throws AssuranceError). The evidence id
 * must be a well-formed spine id of kind segment "Evidence".
 */
export function assertValidEvidenceRef(value: unknown): asserts value is EvidenceRef {
  if (!isPlainObject(value) || !hasExactKeys(value, ['evidence_id', 'role', 'claim_ref'])) {
    throw new AssuranceError('evidence reference must be an object with exact fields { evidence_id, role, claim_ref }');
  }
  if (!isArtifactId(value['evidence_id']) || parseArtifactId(value['evidence_id']).kind !== 'Evidence') {
    throw new AssuranceError(
      `evidence reference evidence_id must be a well-formed spine artifact id of kind Evidence (sos://Evidence/<32 hex>), received: ${JSON.stringify(value['evidence_id'])}`,
    );
  }
  if (!isEvidenceRefRole(value['role'])) {
    throw new AssuranceError(
      `evidence reference role must be one of SUPPORTS / VERIFIES / CONTRADICTS, received: ${JSON.stringify(value['role'])}`,
    );
  }
  if (!isNonEmptyString(value['claim_ref'])) {
    throw new AssuranceError(`evidence reference claim_ref must be a non-empty claim id, received: ${JSON.stringify(value['claim_ref'])}`);
  }
}

/** Validate a validity condition (throws AssuranceError). */
export function assertValidityCondition(value: unknown): asserts value is ValidityCondition {
  if (!isPlainObject(value) || !hasExactKeys(value, ['kind', 'subject', 'valid_revisions'])) {
    throw new AssuranceError('validity condition must be an object with exact fields { kind, subject, valid_revisions }');
  }
  if (!isValidityConditionKind(value['kind'])) {
    throw new AssuranceError(
      `validity condition kind must be IMPLEMENTATION, DEPENDENCY or ENVIRONMENT, received: ${JSON.stringify(value['kind'])}`,
    );
  }
  if (!isNonEmptyString(value['subject'])) {
    throw new AssuranceError(`validity condition subject must be a non-empty string, received: ${JSON.stringify(value['subject'])}`);
  }
  if (!isNonEmptyStringArray(value['valid_revisions'])) {
    throw new AssuranceError('validity condition valid_revisions must be a non-empty array of non-empty revision strings');
  }
  if (new Set(value['valid_revisions']).size !== value['valid_revisions'].length) {
    throw new AssuranceError(
      `validity condition for ${String(value['subject'])} has duplicate valid_revisions: ${JSON.stringify(value['valid_revisions'])}`,
    );
  }
}

function epochMillis(timestamp: string): number {
  const millis = Date.parse(timestamp);
  if (Number.isNaN(millis)) {
    throw new AssuranceError(`unparseable RFC3339 timestamp: ${JSON.stringify(timestamp)}`);
  }
  return millis;
}

/** Validate an objection resolution (throws AssuranceError). */
export function assertValidObjectionResolution(value: unknown): asserts value is ObjectionResolution {
  if (!isPlainObject(value) || !hasExactKeys(value, ['note', 'resolved_at', 'provenance'])) {
    throw new AssuranceError('objection resolution must be an object with exact fields { note, resolved_at, provenance }');
  }
  if (!isNonEmptyString(value['note'])) {
    throw new AssuranceError(`objection resolution note must be a non-empty string, received: ${JSON.stringify(value['note'])}`);
  }
  if (typeof value['resolved_at'] !== 'string' || !RFC3339_PATTERN.test(value['resolved_at'])) {
    throw new AssuranceError(
      `objection resolution resolved_at must be an RFC3339 timestamp, received: ${JSON.stringify(value['resolved_at'])}`,
    );
  }
  if (!isNonEmptyStringArray(value['provenance'])) {
    throw new AssuranceError('objection resolution provenance must be a non-empty array of non-empty strings (no anonymous resolutions)');
  }
}

/** Validate an objection (throws AssuranceError). */
export function assertValidObjection(value: unknown): asserts value is Objection {
  if (!isPlainObject(value) || !hasExactKeys(value, ['id', 'statement', 'raised_at', 'status', 'resolution'])) {
    throw new AssuranceError('objection must be an object with exact fields { id, statement, raised_at, status, resolution }');
  }
  if (!isNonEmptyString(value['id'])) {
    throw new AssuranceError(`objection id must be a non-empty string, received: ${JSON.stringify(value['id'])}`);
  }
  if (!isNonEmptyString(value['statement'])) {
    throw new AssuranceError(`objection statement must be a non-empty string, received: ${JSON.stringify(value['statement'])}`);
  }
  if (typeof value['raised_at'] !== 'string' || !RFC3339_PATTERN.test(value['raised_at'])) {
    throw new AssuranceError(`objection raised_at must be an RFC3339 timestamp, received: ${JSON.stringify(value['raised_at'])}`);
  }
  if (!isObjectionStatus(value['status'])) {
    throw new AssuranceError(`objection status must be OPEN or RESOLVED, received: ${JSON.stringify(value['status'])}`);
  }
  if (value['status'] === 'OPEN' && value['resolution'] !== null) {
    throw new AssuranceError(`objection ${JSON.stringify(value['id'])} is OPEN but carries a resolution — resolve it explicitly instead`);
  }
  if (value['status'] === 'RESOLVED') {
    if (value['resolution'] === null) {
      throw new AssuranceError(
        `objection ${JSON.stringify(value['id'])} is RESOLVED but carries no resolution — resolutions require a note, an instant and provenance`,
      );
    }
    assertValidObjectionResolution(value['resolution']);
    if (epochMillis(value['resolution']['resolved_at']) < epochMillis(value['raised_at'])) {
      throw new AssuranceError(
        `objection ${JSON.stringify(value['id'])} was resolved before it was raised (raised ${value['raised_at']}, resolved ${value['resolution']['resolved_at']})`,
      );
    }
  }
}

const CONTENT_KEYS = [
  'claims',
  'arguments',
  'assumptions',
  'hazards',
  'controls',
  'evidence',
  'validity_conditions',
  'objections',
] as const;

/**
 * Full semantic validation of the eight-section case content (throws
 * AssuranceError): exact field set, per-section validators, unique ids,
 * cross-references resolvable (arguments -> claims, controls -> hazards,
 * evidence refs -> claims), no duplicate (evidence_id, claim_ref) pairs
 * (the same evidence neither supports nor contradicts the same claim), and
 * no duplicate (kind, subject) validity conditions.
 */
export function assertValidAssuranceCaseContent(value: unknown): asserts value is AssuranceCaseContent {
  if (!isPlainObject(value)) {
    throw new AssuranceError('assurance case content must be an object');
  }
  const actual = Object.keys(value);
  const expected = new Set<string>(CONTENT_KEYS);
  if (actual.length !== CONTENT_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new AssuranceError(
      `assurance case content must have the exact eight-section field set { ${CONTENT_KEYS.join(', ')} }`,
    );
  }

  const claims = value['claims'];
  if (!Array.isArray(claims) || claims.length === 0) {
    throw new AssuranceError('assurance case content requires at least one claim (a case claiming nothing assures nothing)');
  }
  for (const claim of claims) {
    assertValidClaim(claim);
  }
  assertNoDuplicates(claims.map((claim) => claim.id), 'claim');
  const claimIds = new Set(claims.map((claim) => claim.id));

  const arguments_ = value['arguments'];
  if (!Array.isArray(arguments_)) {
    throw new AssuranceError('assurance case content arguments must be an array');
  }
  for (const argument of arguments_) {
    assertValidArgument(argument);
  }
  assertNoDuplicates(arguments_.map((argument) => argument.id), 'argument');
  for (const argument of arguments_) {
    if (!claimIds.has(argument.conclusion)) {
      throw new AssuranceError(
        `argument ${JSON.stringify(argument.id)} concludes unknown claim ${JSON.stringify(argument.conclusion)}`,
      );
    }
    for (const premise of argument.premises) {
      if (!claimIds.has(premise)) {
        throw new AssuranceError(`argument ${JSON.stringify(argument.id)} cites unknown premise claim ${JSON.stringify(premise)}`);
      }
    }
  }

  const assumptions = value['assumptions'];
  if (!Array.isArray(assumptions)) {
    throw new AssuranceError('assurance case content assumptions must be an array');
  }
  for (const assumption of assumptions) {
    assertValidAssumption(assumption);
  }
  assertNoDuplicates(assumptions.map((assumption) => assumption.id), 'assumption');

  const hazards = value['hazards'];
  if (!Array.isArray(hazards)) {
    throw new AssuranceError('assurance case content hazards must be an array');
  }
  for (const hazard of hazards) {
    assertValidHazard(hazard);
  }
  assertNoDuplicates(hazards.map((hazard) => hazard.id), 'hazard');
  const hazardIds = new Set(hazards.map((hazard) => hazard.id));

  const controls = value['controls'];
  if (!Array.isArray(controls)) {
    throw new AssuranceError('assurance case content controls must be an array');
  }
  for (const control of controls) {
    assertValidControl(control);
  }
  assertNoDuplicates(controls.map((control) => control.id), 'control');
  for (const control of controls) {
    for (const hazardId of control.addresses) {
      if (!hazardIds.has(hazardId)) {
        throw new AssuranceError(`control ${JSON.stringify(control.id)} addresses unknown hazard ${JSON.stringify(hazardId)}`);
      }
    }
  }

  const evidence = value['evidence'];
  if (!Array.isArray(evidence)) {
    throw new AssuranceError('assurance case content evidence must be an array');
  }
  for (const ref of evidence) {
    assertValidEvidenceRef(ref);
  }
  const evidenceClaimPairs = new Set<string>();
  for (const ref of evidence) {
    if (!claimIds.has(ref.claim_ref)) {
      throw new AssuranceError(`evidence reference ${ref.evidence_id} speaks to unknown claim ${JSON.stringify(ref.claim_ref)}`);
    }
    const pair = `${ref.evidence_id}\u0000${ref.claim_ref}`;
    if (evidenceClaimPairs.has(pair)) {
      throw new AssuranceError(
        `evidence ${ref.evidence_id} is referenced twice for claim ${JSON.stringify(ref.claim_ref)} — the same evidence cannot both support and contradict the same claim`,
      );
    }
    evidenceClaimPairs.add(pair);
  }

  const validityConditions = value['validity_conditions'];
  if (!Array.isArray(validityConditions)) {
    throw new AssuranceError('assurance case content validity_conditions must be an array');
  }
  for (const condition of validityConditions) {
    assertValidityCondition(condition);
  }
  const conditionSubjects = new Set<string>();
  for (const condition of validityConditions) {
    const key = `${condition.kind}\u0000${condition.subject}`;
    if (conditionSubjects.has(key)) {
      throw new AssuranceError(
        `duplicate validity condition for ${condition.kind} subject ${JSON.stringify(condition.subject)} — merge the valid revisions into one condition`,
      );
    }
    conditionSubjects.add(key);
  }

  const objections = value['objections'];
  if (!Array.isArray(objections)) {
    throw new AssuranceError('assurance case content objections must be an array');
  }
  for (const objection of objections) {
    assertValidObjection(objection);
  }
  assertNoDuplicates(objections.map((objection) => objection.id), 'objection');
}

// ---------------------------------------------------------------------------
// Creation and full-artifact validation
// ---------------------------------------------------------------------------

/** Create an assurance case artifact with a deterministic content-addressed id. */
export function createAssuranceCase(input: CreateAssuranceCaseInput): AssuranceCaseArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new AssuranceError('assurance case creation input must be an object');
  }
  assertValidAssuranceCaseContent(input.content);
  const address = assuranceCaseCreationAddress(input);
  const id = deriveDeterministicArtifactId(ASSURANCE_CASE_KIND, address);
  const envelope = createEnvelope({
    kind: ASSURANCE_CASE_KIND,
    version: address.version,
    status: address.status,
    authority_ref: address.authority_ref,
    provenance: address.provenance,
    created_at: address.created_at,
    supersedes: address.supersedes,
    id,
  });
  return { envelope, content: structuredClone(address.content) };
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/**
 * Full semantic validation of an assurance case artifact (throws
 * AssuranceError): exact artifact shape, spine-valid envelope of kind
 * AssuranceCase, valid eight-section content.
 */
export function assertValidAssuranceCase(value: unknown): asserts value is AssuranceCaseArtifact {
  if (!isPlainObject(value) || !hasExactKeys(value, ARTIFACT_KEYS)) {
    throw new AssuranceError('assurance case artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(value['envelope']);
  } catch (cause) {
    throw new AssuranceError(`assurance case envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = value['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== ASSURANCE_CASE_KIND) {
    throw new AssuranceError(
      `assurance case artifact envelope kind must be "${ASSURANCE_CASE_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidAssuranceCaseContent(value['content']);
}

/** Predicate form of assertValidAssuranceCase. */
export function validateAssuranceCase(value: unknown): value is AssuranceCaseArtifact {
  try {
    assertValidAssuranceCase(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Revision discipline (objections are never dropped)
// ---------------------------------------------------------------------------

/**
 * Validate that `next` is a valid successor revision of `previous`
 * (throws AssuranceError):
 *   - next is a valid AssuranceCase artifact;
 *   - same artifact chain: version = previous.version + 1, supersedes =
 *     previous.envelope.id;
 *   - OBJECTION RETENTION: every objection id of the previous revision is
 *     still present (objections are recorded, never dropped);
 *   - no objection status regression: RESOLVED never re-opens; a previously
 *     RESOLVED objection carries the SAME resolution (resolutions are not
 *     rewritten);
 *   - OPEN objections from the previous revision stay OPEN unless they are
 *     now RESOLVED with a valid resolution.
 */
export function assertValidCaseRevision(
  previous: AssuranceCaseArtifact,
  next: AssuranceCaseArtifact,
): void {
  assertValidAssuranceCase(previous);
  assertValidAssuranceCase(next);
  if (next.envelope.version !== previous.envelope.version + 1) {
    throw new AssuranceError(
      `case revision must increment the version exactly once: expected ${previous.envelope.version + 1}, received ${next.envelope.version}`,
    );
  }
  if (next.envelope.supersedes !== previous.envelope.id) {
    throw new AssuranceError(
      `case revision must supersede the previous head ${previous.envelope.id}, received: ${JSON.stringify(next.envelope.supersedes)}`,
    );
  }
  const previousObjections = new Map(previous.content.objections.map((objection) => [objection.id, objection]));
  for (const nextObjection of next.content.objections) {
    const before = previousObjections.get(nextObjection.id);
    if (before === undefined) {
      continue; // newly added objection
    }
    if (before.status === 'RESOLVED') {
      if (nextObjection.status !== 'RESOLVED') {
        throw new AssuranceError(
          `objection ${JSON.stringify(nextObjection.id)} is RESOLVED in the previous revision and cannot be re-opened (resolutions are terminal)`,
        );
      }
      if (
        before.resolution === null ||
        nextObjection.resolution === null ||
        before.resolution.note !== nextObjection.resolution.note ||
        before.resolution.resolved_at !== nextObjection.resolution.resolved_at ||
        before.resolution.provenance.join('\u0000') !== nextObjection.resolution.provenance.join('\u0000')
      ) {
        throw new AssuranceError(
          `objection ${JSON.stringify(nextObjection.id)} carries a rewritten resolution — resolutions are append-only history, never edited`,
        );
      }
    }
  }
  for (const [id] of previousObjections) {
    if (!next.content.objections.some((objection) => objection.id === id)) {
      throw new AssuranceError(
        `objection ${JSON.stringify(id)} was DROPPED in the revision — objections are first-class records and are never dropped (resolve them explicitly instead)`,
      );
    }
  }
}
