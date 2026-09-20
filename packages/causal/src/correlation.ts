/**
 * Correlation records — typed, DISTINCT from causal claims (Work Order W5).
 *
 * A CorrelationRecord records an observed association between variables. It
 * is structurally INCAPABLE of expressing causation: it has no claim
 * strength, no mechanism, no causal graph — the type itself enforces the
 * separation. A correlation is never silently promoted: the ONLY path from
 * a correlation record to a causal claim is `hypothesisFromCorrelation`,
 * which is explicit, evidence-gated (it REQUIRES interventional SUCCESS
 * evidence references and runs the §18 claim gate), provenance-preserving
 * (correlation_origin + a DERIVED_FROM trace link), and loud (it throws when
 * the interventional evidence is missing).
 *
 * Identity discipline: ids are ALWAYS minted by the Semantic Spine
 * (deterministic content-addressing over the exact creation address minus
 * the id). The artifact kind segment "CorrelationRecord" is a documented,
 * explicitly-registered extension kind (the spine's sanctioned
 * registerArtifactKind API — add-only, no second kind registry), exactly as
 * W3 registered ProvenanceRecord.
 */

import {
  assertValidEnvelope,
  createEnvelope,
  createTraceLink,
  deriveDeterministicArtifactId,
  isArtifactId,
  parseArtifactId,
  registerArtifactKind,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus, JsonValue, TraceLink } from '@sos-2/semantic-spine';
import {
  assertConfidenceAllowedForProducer,
  assertValidConfidence,
} from '@sos-2/evidence';
import type { Confidence } from '@sos-2/evidence';
import { assertValidProducer, isLlmProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { CausalError } from './errors.js';
import { assertNoDuplicateEvidenceReferences } from './evidence-refs.js';
import type {
  InterventionalEvidenceRef,
  ObservationalEvidenceRef,
} from './evidence-refs.js';
import { assertValidCausalHypothesisContent, createCausalHypothesis } from './hypothesis.js';
import type { CausalHypothesisArtifact, CausalHypothesisContent } from './hypothesis.js';

/** The artifact kind segment used for correlation record ids (registered extension kind). */
export const CORRELATION_RECORD_KIND = 'CorrelationRecord';

/** The direction of an observed association. */
export const CORRELATION_DIRECTIONS = ['POSITIVE', 'NEGATIVE', 'UNSPECIFIED'] as const;

export type CorrelationDirection = (typeof CORRELATION_DIRECTIONS)[number];

/** One of the correlated variables. */
export interface CorrelationVariable {
  /** Identifier unique within the record (non-empty). */
  id: string;
  /** Human-readable variable description (non-empty). */
  description: string;
}

/** The full correlation record content (the exact creation content). */
export interface CorrelationRecordContent {
  /** The observed association in one sentence (non-empty). */
  statement: string;
  /** The correlated variables (at least two). */
  variables: CorrelationVariable[];
  /** The observed direction of the association. */
  direction: CorrelationDirection;
  /** The observation/applicability context (plain JSON object, may be null). */
  context: Record<string, JsonValue> | null;
  /** Observational evidence references (an observed association is typically observational). */
  observational_evidence: ObservationalEvidenceRef[];
  /** Interventional evidence references (a correlation may also be computed within intervention data). */
  interventional_evidence: InterventionalEvidenceRef[];
  /** Uncertainty: qualitative class unless a calibration artifact exists. */
  uncertainty: Confidence;
  /** WHO/WHAT produced this record. */
  producer: Producer;
}

export interface CorrelationRecordArtifact {
  /** Semantic Spine envelope; kind is always "CorrelationRecord". */
  envelope: ArtifactEnvelope;
  /** Correlation record content (exact field set). */
  content: CorrelationRecordContent;
}

export interface CreateCorrelationRecordInput {
  content: CorrelationRecordContent;
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
  /** Correlation record id superseded by this one, or null (roots). */
  supersedes?: string | null;
}

/**
 * Register the CorrelationRecord extension kind in the spine's kind registry.
 * Idempotent: re-registration of the same kind is a no-op. The registry is
 * add-only, so this can never remove or mutate any frozen core kind.
 */
export function registerCorrelationArtifactKind(): void {
  try {
    registerArtifactKind(CORRELATION_RECORD_KIND);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!message.includes('already registered')) {
      throw cause;
    }
  }
}

// Register eagerly at module load (documented, idempotent, add-only): the
// spine's kind registry is the single kind authority and this package's ids
// use the CorrelationRecord kind segment.
registerCorrelationArtifactKind();

/**
 * Whether a value is a well-formed artifact id of kind CorrelationRecord.
 */
export function isCorrelationRecordRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isArtifactId(value) &&
    parseArtifactId(value).kind === CORRELATION_RECORD_KIND
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function isPlainJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true;
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.every((entry) => isPlainJsonValue(entry));
    }
    return Object.values(value).every((entry) => isPlainJsonValue(entry));
  }
  return false;
}

function assertValidNullableContext(
  context: unknown,
  field: string,
): asserts context is Record<string, JsonValue> | null {
  if (context === undefined || context === null) {
    return;
  }
  if (!isPlainJsonRecord(context)) {
    throw new CausalError(`${field} must be null or a plain JSON object`);
  }
  for (const key of Object.keys(context)) {
    if (key.length === 0) {
      throw new CausalError(`${field} keys must be non-empty strings`);
    }
    if (!isPlainJsonValue(context[key])) {
      throw new CausalError(`${field}.${key} is not a JSON value`);
    }
  }
}

/** Validate the full correlation record content (throws CausalError). */
export function assertValidCorrelationRecordContent(
  value: unknown,
): asserts value is CorrelationRecordContent {
  if (!isPlainJsonRecord(value)) {
    throw new CausalError('correlation record content must be an object');
  }
  const required: Array<keyof CorrelationRecordContent> = [
    'statement',
    'variables',
    'direction',
    'context',
    'observational_evidence',
    'interventional_evidence',
    'uncertainty',
    'producer',
  ];
  for (const key of required) {
    if (!(key in value)) {
      throw new CausalError(`correlation record content is missing required field: ${JSON.stringify(key)}`);
    }
  }
  if (!isNonEmptyString(value['statement'])) {
    throw new CausalError(`statement must be a non-empty string, received: ${JSON.stringify(value['statement'])}`);
  }
  const variables = value['variables'];
  if (!Array.isArray(variables)) {
    throw new CausalError('variables must be an array of { id, description } items (at least two)');
  }
  if (variables.length < 2) {
    throw new CausalError(
      `a correlation is between at least two variables (received ${variables.length}) — ` +
        'a single-variable association is not a correlation',
    );
  }
  const variableIds = new Set<string>();
  for (const variable of variables) {
    if (!isPlainJsonRecord(variable)) {
      throw new CausalError('correlation variables must be objects with exact fields { id, description }');
    }
    const keys = Object.keys(variable);
    if (keys.length !== 2 || !keys.includes('id') || !keys.includes('description')) {
      throw new CausalError('correlation variables must be objects with exact fields { id, description }');
    }
    if (!isNonEmptyString(variable['id'])) {
      throw new CausalError(`correlation variable ids must be non-empty strings, received: ${JSON.stringify(variable['id'])}`);
    }
    if (variableIds.has(variable['id'])) {
      throw new CausalError(`duplicate correlation variable id rejected: ${JSON.stringify(variable['id'])}`);
    }
    variableIds.add(variable['id']);
    if (!isNonEmptyString(variable['description'])) {
      throw new CausalError(
        `correlation variable descriptions must be non-empty strings, received: ${JSON.stringify(variable['description'])}`,
      );
    }
  }
  const direction = value['direction'];
  if (!(typeof direction === 'string' && (CORRELATION_DIRECTIONS as readonly string[]).includes(direction))) {
    throw new CausalError(
      `direction must be one of ${CORRELATION_DIRECTIONS.join(', ')}, received: ${JSON.stringify(direction)}`,
    );
  }
  assertValidNullableContext(value['context'], 'context');
  const observational = value['observational_evidence'];
  const interventional = value['interventional_evidence'];
  if (!Array.isArray(observational) || !Array.isArray(interventional)) {
    throw new CausalError(
      'observational_evidence and interventional_evidence must be arrays of class-typed evidence references',
    );
  }
  if (observational.length + interventional.length < 1) {
    throw new CausalError(
      'a correlation record must cite at least one evidence reference — evidence outranks assertion about system reality (spec/architecture.md §18)',
    );
  }
  assertNoDuplicateEvidenceReferences(observational, interventional);
  try {
    assertValidConfidence(value['uncertainty']);
  } catch (cause) {
    throw new CausalError(`uncertainty is invalid: ${(cause as Error).message}`);
  }
  try {
    assertValidProducer(value['producer']);
  } catch (cause) {
    throw new CausalError(`producer is invalid: ${(cause as Error).message}`);
  }
  const producer = value['producer'] as Producer;
  const uncertainty = value['uncertainty'] as Confidence;
  assertConfidenceAllowedForProducer(uncertainty, isLlmProducer(producer));
}

/** Predicate form of assertValidCorrelationRecordContent. */
export function validateCorrelationRecordContent(value: unknown): value is CorrelationRecordContent {
  try {
    assertValidCorrelationRecordContent(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The creation address of a correlation record creation input (exported so
 * tests and diagnostics reproduce ids bit-exactly).
 */
export interface CorrelationRecordCreationAddress {
  kind: 'CorrelationRecord';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: CorrelationRecordContent;
}

export function correlationRecordCreationAddress(
  input: CreateCorrelationRecordInput,
): CorrelationRecordCreationAddress {
  assertValidCorrelationRecordContent(input.content);
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new CausalError('provenance must be a non-empty array of non-empty strings (no provenance-less records)');
  }
  return {
    kind: CORRELATION_RECORD_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content: input.content,
  };
}

/** Derive the deterministic correlation record id for a creation input. */
export function correlationRecordArtifactId(input: CreateCorrelationRecordInput): string {
  return deriveDeterministicArtifactId(CORRELATION_RECORD_KIND, correlationRecordCreationAddress(input));
}

/** Create a correlation record artifact (deterministic id, spine-minted envelope). */
export function createCorrelationRecord(input: CreateCorrelationRecordInput): CorrelationRecordArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new CausalError('correlation record creation input must be an object');
  }
  assertValidCorrelationRecordContent(input.content);

  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;

  const id = deriveDeterministicArtifactId(CORRELATION_RECORD_KIND, {
    kind: CORRELATION_RECORD_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: input.content,
  });

  const envelope = createEnvelope({
    kind: CORRELATION_RECORD_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    id,
  });

  return { envelope, content: structuredClone(input.content) };
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/** Full semantic validation of a correlation record artifact (throws CausalError). */
export function assertValidCorrelationRecord(value: unknown): asserts value is CorrelationRecordArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CausalError('correlation record artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new CausalError('correlation record artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new CausalError(`correlation record envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== CORRELATION_RECORD_KIND) {
    throw new CausalError(
      `correlation record envelope kind must be "${CORRELATION_RECORD_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidCorrelationRecordContent(record['content']);
}

/** Predicate form of assertValidCorrelationRecord. */
export function validateCorrelationRecord(value: unknown): value is CorrelationRecordArtifact {
  try {
    assertValidCorrelationRecord(value);
    return true;
  } catch {
    return false;
  }
}

/** True iff this correlation record was produced by model output (LLM) — never authoritative (§18). */
export function isLlmCorrelation(record: CorrelationRecordArtifact): boolean {
  assertValidCorrelationRecord(record);
  return isLlmProducer(record.content.producer);
}

/** The input for the explicit, evidence-gated promotion of a correlation to a causal hypothesis. */
export interface HypothesizeFromCorrelationInput {
  /** The full hypothesis content (WITHOUT correlation_origin — it is set by the derivation). */
  content: Omit<CausalHypothesisContent, 'correlation_origin'>;
  /** REQUIRED non-empty provenance entries (spine discipline). */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied. */
  created_at: string;
  /** Authorizing artifact id, or null. */
  authority_ref?: string | null;
  /** Version (integer >= 1). Defaults to 1. */
  version?: number;
  /** DRAFT (default) or ACTIVE. */
  status?: ArtifactStatus;
}

export interface HypothesizeFromCorrelationResult {
  /** The correlation record this hypothesis was derived from (as provided). */
  correlation: CorrelationRecordArtifact;
  /** The new causal hypothesis (correlation_origin set to the correlation record id). */
  hypothesis: CausalHypothesisArtifact;
  /** DERIVED_FROM trace link: hypothesis -> correlation record. */
  derivation_link: TraceLink;
}

/**
 * THE EXPLICIT PROMOTION PATH (never silent): derive a causal hypothesis
 * from a correlation record.
 *
 * - The hypothesis content is FULLY validated, INCLUDING the §18 claim gate:
 *   a CAUSAL claim requires interventional SUCCESS evidence references —
 *   with only observational evidence this throws (nothing is promoted).
 * - The derivation is recorded twice: in the hypothesis content
 *   (correlation_origin) and as a DERIVED_FROM trace link
 *   (hypothesis -> correlation), so the promotion is always visible and
 *   queryable through the spine.
 */
export function hypothesisFromCorrelation(
  correlation: CorrelationRecordArtifact,
  input: HypothesizeFromCorrelationInput,
): HypothesizeFromCorrelationResult {
  assertValidCorrelationRecord(correlation);
  if (typeof input !== 'object' || input === null) {
    throw new CausalError('hypothesize-from-correlation input must be an object');
  }
  const content: CausalHypothesisContent = {
    ...(input.content as Omit<CausalHypothesisContent, 'correlation_origin'>),
    correlation_origin: correlation.envelope.id,
  };
  // Full validation INCLUDING the claim gate — an observational-only
  // "promotion" is rejected loudly here (spec/architecture.md §18).
  assertValidCausalHypothesisContent(content);

  const hypothesis = createCausalHypothesis({
    content,
    provenance: input.provenance,
    created_at: input.created_at,
    authority_ref: input.authority_ref ?? null,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    supersedes: null,
  });

  const derivation_link = createTraceLink({
    source: hypothesis.envelope.id,
    target: correlation.envelope.id,
    type: 'DERIVED_FROM',
    provenance: [...input.provenance],
  });

  return { correlation, hypothesis, derivation_link };
}
