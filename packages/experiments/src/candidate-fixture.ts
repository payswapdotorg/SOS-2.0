/**
 * CandidateState fixture — the W9 realization of the frozen CandidateState
 * CONTRACT SHAPE for the experimentation and promotion planes.
 *
 * W9 PARALLELIZATION RULE (spec/work-orders/W9-experimentation.md): W9 must
 * be implementable WITHOUT W7/W8 source dependencies. Candidate GENERATION
 * (W7, unmerged) and assurance CASES (W8, unmerged) are therefore consumed
 * through contract fixtures: this module pins the CandidateState input
 * shape — a Semantic Spine envelope of the FROZEN core kind
 * "CandidateState" plus a content object mirroring spec/architecture.md §5
 * ("Candidate State: bounded subgraph replacement with explicit invariants
 * and predicted effects").
 *
 * The shape is designed so W7 integrates later WITHOUT contract changes:
 *   - the envelope is the exact spine ArtifactEnvelope (validated by the
 *     spine's assertValidEnvelope — the normative envelope contract);
 *   - `invariants` and `predicted_effects` mirror the W2 LocalCandidate
 *     field semantics (the merged W2 realization of bounded subgraph
 *     replacement), and `candidateStateFromLocalCandidate` ADAPTS a merged
 *     W2 LocalCandidate into this fixture (the compatibility bridge);
 *   - `causal_claim`, `confidence`, `base_subject_revision` and
 *     `hypo_ref` are the fields the promotion gate evaluates. CONFIDENCE IS
 *     NOT AUTHORIZATION (spec/architecture-lock.md: "confidence alone
 *     authorizing risky changes" is forbidden) — the confidence mark is
 *     carried and displayed, NEVER consulted for authorization;
 *   - `confidence` uses @sos-2/evidence's Confidence type (consumed, never
 *     duplicated): calibrated numeric only with a calibration artifact ref,
 *     qualitative otherwise.
 *
 * Identity discipline: ids are ALWAYS minted by the spine (deterministic
 * content-addressing over the creation address), exactly like
 * @sos-2/causal and @sos-2/mission. No identifiers are invented here.
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
  parseArtifactId,
  RFC3339_PATTERN,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus, JsonValue } from '@sos-2/semantic-spine';
import { assertValidConfidence } from '@sos-2/evidence';
import type { Confidence } from '@sos-2/evidence';
import type { LocalCandidate } from '@sos-2/architecture';
import { ExperimentError } from './errors.js';

/** The (core, frozen) artifact kind segment used for candidate fixture ids. */
export const CANDIDATE_STATE_KIND = 'CandidateState';

/**
 * The CandidateState fixture content. Mirrors the frozen §5 semantics:
 * bounded subgraph replacement (via the optional W2 bridge ref) with
 * EXPLICIT invariants and predicted effects.
 */
export interface CandidateStateContent {
  /** Invariants the candidate explicitly preserves (>= 1 — same rule as W2 LocalCandidate). */
  invariants: string[];
  /** Predicted effects (>= 1 when causal_claim is true — a causal candidate must be testable). */
  predicted_effects: string[];
  /**
   * Whether the candidate asserts causal effects. When true, promotion
   * requires CURRENT INTERVENTION-GRADE evidence (spec/architecture.md
   * §18: intervention evidence outranks observational correlation).
   */
  causal_claim: boolean;
  /**
   * Confidence mark — carried, displayed, NEVER authorization. Calibrated
   * numeric only with a calibration artifact ref; qualitative otherwise.
   */
  confidence: Confidence | null;
  /**
   * The System State revision the candidate is based on, or null.
   * Promotion checks compatibility against the CURRENT System State.
   */
  base_subject_revision: string | null;
  /** The CausalHypothesis spine id linked to this candidate, or null. */
  hypothesis_ref: string | null;
  /**
   * The bounded-subgraph reference of the W2 LocalCandidate this fixture
   * adapts (graph id + version), or null for candidates not derived from a
   * W2 architecture-graph candidate.
   */
  bounded_subgraph_ref: { graph_id: string; version: number } | null;
  /** Plain-JSON context facts (>= 1). */
  context: Record<string, JsonValue>;
}

/** The CandidateState fixture: a frozen-kind spine envelope + content. */
export interface CandidateStateFixture {
  /** Spine envelope; kind is always "CandidateState" (frozen core kind). */
  envelope: ArtifactEnvelope;
  /** Candidate content (exact field set). */
  content: CandidateStateContent;
}

export interface CreateCandidateStateInput {
  content: CandidateStateContent;
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
  /** Candidate artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
}

/**
 * The exact value a candidate fixture id is derived from (exported so tests
 * and diagnostics reproduce ids bit-exactly — the W0.5 fixture discipline).
 */
export interface CandidateStateCreationAddress {
  kind: 'CandidateState';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: CandidateStateContent;
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

function assertValidContext(context: unknown, field: string): asserts context is Record<string, JsonValue> {
  if (!isPlainObject(context) || Object.keys(context).length < 1) {
    throw new ExperimentError(`${field} must be a plain JSON object with at least one fact`);
  }
  for (const key of Object.keys(context)) {
    if (key.length === 0) {
      throw new ExperimentError(`${field} keys must be non-empty strings`);
    }
    if (!isPlainJsonValue(context[key])) {
      throw new ExperimentError(`${field}.${key} is not a JSON value`);
    }
  }
}

/** Validate CandidateState content (throws ExperimentError). */
export function assertValidCandidateStateContent(value: unknown): asserts value is CandidateStateContent {
  if (!isPlainObject(value)) {
    throw new ExperimentError(`candidate content must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = [
    'invariants',
    'predicted_effects',
    'causal_claim',
    'confidence',
    'base_subject_revision',
    'hypothesis_ref',
    'bounded_subgraph_ref',
    'context',
  ];
  if (
    Object.keys(record).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw new ExperimentError(`candidate content must have the exact field set { ${keys.join(', ')} }`);
  }
  if (!isNonEmptyStringArray(record['invariants'])) {
    throw new ExperimentError(
      'invariants must be a non-empty array of non-empty strings (a candidate without declared preserved invariants is rejected)',
    );
  }
  if (!isStringArray(record['predicted_effects'])) {
    throw new ExperimentError('predicted_effects must be an array of non-empty strings');
  }
  if (typeof record['causal_claim'] !== 'boolean') {
    throw new ExperimentError(`causal_claim must be a boolean, received: ${JSON.stringify(record['causal_claim'])}`);
  }
  if (record['causal_claim'] === true && (record['predicted_effects'] as string[]).length === 0) {
    throw new ExperimentError(
      'a causal candidate must declare at least one predicted effect — causal claims without testable predictions are rejected',
    );
  }
  if (record['confidence'] !== null) {
    try {
      assertValidConfidence(record['confidence']);
    } catch (cause) {
      throw new ExperimentError(`confidence is invalid: ${(cause as Error).message}`);
    }
  }
  if (record['base_subject_revision'] !== null && !isNonEmptyString(record['base_subject_revision'])) {
    throw new ExperimentError(
      `base_subject_revision must be null or a non-empty string, received: ${JSON.stringify(record['base_subject_revision'])}`,
    );
  }
  if (record['hypothesis_ref'] !== null) {
    if (!isArtifactId(record['hypothesis_ref'])) {
      throw new ExperimentError(
        `hypothesis_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['hypothesis_ref'])}`,
      );
    }
    const parsed = parseArtifactId(record['hypothesis_ref']);
    if (parsed.kind !== 'CausalHypothesis') {
      throw new ExperimentError(
        `hypothesis_ref must reference a CausalHypothesis artifact, received kind "${parsed.kind}" ` +
          '(experiments test causal hypotheses — the link is typed)',
      );
    }
  }
  if (record['bounded_subgraph_ref'] !== null) {
    const ref = record['bounded_subgraph_ref'];
    if (!isPlainObject(ref) || Object.keys(ref).length !== 2) {
      throw new ExperimentError('bounded_subgraph_ref must be { graph_id, version } or null');
    }
    if (!isArtifactId(ref['graph_id'])) {
      throw new ExperimentError(
        `bounded_subgraph_ref.graph_id must be a well-formed spine artifact id, received: ${JSON.stringify(ref['graph_id'])}`,
      );
    }
    const parsedGraph = parseArtifactId(ref['graph_id'] as string);
    if (parsedGraph.kind !== 'ArchitectureGraph') {
      throw new ExperimentError(
        `bounded_subgraph_ref.graph_id must reference an ArchitectureGraph artifact, received kind "${parsedGraph.kind}"`,
      );
    }
    const version = ref['version'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new ExperimentError(`bounded_subgraph_ref.version must be an integer >= 1, received: ${String(version)}`);
    }
  }
  assertValidContext(record['context'], 'context');
}

/** The creation address of a candidate fixture (envelope fields + content). */
export function candidateStateCreationAddress(
  input: CreateCandidateStateInput,
  content: CandidateStateContent,
): CandidateStateCreationAddress {
  return {
    kind: CANDIDATE_STATE_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content,
  };
}

/** Derive the deterministic candidate fixture id for a creation input + content. */
export function candidateStateId(input: CreateCandidateStateInput, content: CandidateStateContent): string {
  return deriveDeterministicArtifactId(CANDIDATE_STATE_KIND, candidateStateCreationAddress(input, content));
}

/** Create a CandidateState fixture (deterministic, content-addressed id). */
export function createCandidateState(input: CreateCandidateStateInput): CandidateStateFixture {
  if (typeof input !== 'object' || input === null) {
    throw new ExperimentError('candidate creation input must be an object');
  }
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new ExperimentError('provenance must be a non-empty array of non-empty strings');
  }
  if (typeof input.created_at !== 'string' || !RFC3339_PATTERN.test(input.created_at)) {
    throw new ExperimentError(
      `created_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.created_at)}`,
    );
  }
  assertValidCandidateStateContent(input.content);
  const content: CandidateStateContent = structuredClone(input.content);

  const address = candidateStateCreationAddress(input, content);
  const id = deriveDeterministicArtifactId(CANDIDATE_STATE_KIND, address);
  const envelope = createEnvelope({
    kind: CANDIDATE_STATE_KIND,
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

const FIXTURE_KEYS = ['envelope', 'content'] as const;

/**
 * Full semantic validation of a CandidateState fixture (throws
 * ExperimentError): exact artifact shape, spine-valid envelope of frozen
 * kind CandidateState, valid content.
 */
export function assertValidCandidateState(value: unknown): asserts value is CandidateStateFixture {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExperimentError('candidate fixture must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(FIXTURE_KEYS);
  if (actualKeys.length !== FIXTURE_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new ExperimentError('candidate fixture must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new ExperimentError(`candidate envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== CANDIDATE_STATE_KIND) {
    throw new ExperimentError(
      `candidate envelope kind must be "${CANDIDATE_STATE_KIND}" (frozen core kind), received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidCandidateStateContent(record['content']);
}

/** Predicate form of assertValidCandidateState. */
export function validateCandidateState(value: unknown): value is CandidateStateFixture {
  try {
    assertValidCandidateState(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// W2 bridge: adapt a merged LocalCandidate into a CandidateState fixture
// ---------------------------------------------------------------------------

export interface CandidateStateFromLocalOptions {
  /** The causal claim mark (default: true when predicted effects exist). */
  causal_claim?: boolean;
  /** Confidence mark — carried, never authorization. */
  confidence?: Confidence | null;
  /** The CausalHypothesis spine id, or null. */
  hypothesis_ref?: string | null;
  /** The System State revision the base graph projects, or null. */
  base_subject_revision?: string | null;
  /** Additional context facts (merged with the W2 origin fact). */
  context?: Record<string, JsonValue>;
}

/**
 * Adapt a MERGED W2 LocalCandidate (the W2 realization of bounded subgraph
 * replacement over an ArchitectureGraph) into a CandidateState fixture —
 * the compatibility bridge demonstrating that W9's candidate input shape
 * consumes the merged W2 contract without changes. The bounded subgraph
 * reference (graph id + version) and the invariants/predicted effects are
 * carried over verbatim; nothing is invented.
 */
export function candidateStateFromLocalCandidate(
  local: LocalCandidate,
  input: Omit<CreateCandidateStateInput, 'content'>,
  options: CandidateStateFromLocalOptions = {},
): CandidateStateFixture {
  if (typeof local !== 'object' || local === null) {
    throw new ExperimentError('local candidate must be an object (the W2 LocalCandidate contract)');
  }
  if (local.boundedSubgraph === undefined || local.baseGraphRef === undefined) {
    throw new ExperimentError('local candidate must carry baseGraphRef and boundedSubgraph (W2 contract)');
  }
  if (!Array.isArray(local.invariants) || local.invariants.length === 0) {
    throw new ExperimentError('local candidate invariants must be a non-empty array (W2 contract)');
  }
  if (!Array.isArray(local.predictedEffects)) {
    throw new ExperimentError('local candidate predictedEffects must be an array (W2 contract)');
  }
  const causalClaim = options.causal_claim ?? local.predictedEffects.length > 0;
  const context: Record<string, JsonValue> = {
    origin: 'w2-local-candidate',
    graph_id: local.baseGraphRef.graph_id,
    graph_version: local.baseGraphRef.version,
    ...(options.context ?? {}),
  };
  const content: CandidateStateContent = {
    invariants: [...local.invariants],
    predicted_effects: [...local.predictedEffects],
    causal_claim: causalClaim,
    confidence: options.confidence ?? null,
    base_subject_revision: options.base_subject_revision ?? null,
    hypothesis_ref: options.hypothesis_ref ?? null,
    bounded_subgraph_ref: {
      graph_id: local.baseGraphRef.graph_id,
      version: local.baseGraphRef.version,
    },
    context,
  };
  return createCandidateState({ ...input, content });
}
