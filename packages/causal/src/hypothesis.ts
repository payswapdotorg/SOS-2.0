/**
 * CausalHypothesis artifacts — the W5 realization of causal knowledge
 * (spec/architecture.md §5: "Causal Knowledge: hypotheses about
 * interventions, mechanisms and outcomes"; requirements R10, R22).
 *
 * A CausalHypothesis is a Semantic Spine envelope artifact (frozen core kind
 * "CausalHypothesis") plus the hypothesis content:
 *
 *   - the INTERVENTION description (what is done / what was varied),
 *   - the MECHANISM (why the intervention should produce the effect),
 *   - PREDICTED OUTCOMES (what would be observed if the hypothesis holds),
 *   - ASSUMPTIONS (retained; at least one — a hypothesis always rests on
 *     assumptions),
 *   - CONTEXT (the applicability/observation context; at least one fact),
 *   - ALTERNATIVE EXPLANATIONS (each retained verbatim, never collapsed into
 *     a single winner — spec §11 diversity discipline),
 *   - REFUTATION CONDITIONS (at least one — an unfalsifiable hypothesis is
 *     not a hypothesis),
 *   - the minimal CAUSAL GRAPH (factors + contributes-to/confounds edges),
 *   - strictly class-separated EVIDENCE REFERENCES (observational and
 *     interventional arrays, distinct types, no duplicate citations),
 *   - UNCERTAINTY (qualitative class unless a calibration artifact exists —
 *     spec/meta-model.md; LLM producers can never carry calibrated
 *     confidence),
 *   - the PRODUCER (who/what drafted the hypothesis; LLM-drafted
 *     hypotheses are marked and never authoritative, spec §18),
 *   - an optional CORRELATION ORIGIN (the correlation record this
 *     hypothesis was explicitly derived from, if any).
 *
 * THE CLAIM GATE (locked invariant, spec/architecture.md §18): a hypothesis
 * carries an asserted claim_strength, CAUSAL or CORRELATIONAL. Construction
 * VALIDATES the assertion against the evidence: a CAUSAL claim requires at
 * least one INTERVENTIONAL evidence reference whose availability is SUCCESS
 * (delegated to @sos-2/evidence's supportsStrongCausalClaim — the merged W3
 * authority for this rule; never re-implemented). An attempted causal
 * upgrade backed only by observational evidence — however many records — is
 * REJECTED LOUDLY at construction and at every revision. CORRELATIONAL
 * claims never require interventional evidence (claiming less than the
 * evidence supports is always permitted).
 *
 * Identity discipline: ids are ALWAYS deterministic (content-addressed over
 * the creation address — every envelope field except id, plus the content),
 * exactly like @sos-2/mission. No identifiers are invented here; no
 * envelope logic is duplicated (AGENTS.md §4).
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus, JsonValue } from '@sos-2/semantic-spine';
import {
  assertConfidenceAllowedForProducer,
  assertValidConfidence,
  supportsStrongCausalClaim,
} from '@sos-2/evidence';
import type { Confidence, CausalSupport } from '@sos-2/evidence';
import { assertValidProducer, isLlmProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { CausalError } from './errors.js';
import {
  assertValidInterventionalEvidenceRef,
  assertValidObservationalEvidenceRef,
  assertNoDuplicateEvidenceReferences,
} from './evidence-refs.js';
import type {
  EvidenceReference,
  InterventionalEvidenceRef,
  ObservationalEvidenceRef,
} from './evidence-refs.js';
import { assertValidCausalGraph } from './graph.js';
import type { CausalGraph } from './graph.js';

/** The (core, frozen) artifact kind segment used for causal hypothesis ids. */
export const CAUSAL_HYPOTHESIS_KIND = 'CausalHypothesis';

/** The asserted strength of a hypothesis claim (validated against evidence at construction). */
export const CLAIM_STRENGTHS = ['CAUSAL', 'CORRELATIONAL'] as const;

export type ClaimStrength = (typeof CLAIM_STRENGTHS)[number];

/** Structural check: is this one of the two claim strengths? */
export function isClaimStrength(value: unknown): value is ClaimStrength {
  return typeof value === 'string' && (CLAIM_STRENGTHS as readonly string[]).includes(value);
}

/** The direction a predicted outcome metric is expected to move (or null: unspecified). */
export const PREDICTED_DIRECTIONS = ['INCREASE', 'DECREASE', 'UNCHANGED'] as const;

export type PredictedDirection = (typeof PREDICTED_DIRECTIONS)[number];

/** What is intervened (the X in "X caused Y"). */
export interface InterventionDescription {
  /** What is done / varied (non-empty). */
  description: string;
  /** Spine artifact id of the intervened subject (e.g. a component or SystemState revision), or null. */
  target_ref: string | null;
}

/** A predicted observable consequence if the hypothesis holds. */
export interface PredictedOutcome {
  /** Identifier unique within the hypothesis content. */
  id: string;
  /** What will be observed (non-empty). */
  description: string;
  /** The metric to watch, or null. */
  metric: string | null;
  /** Expected direction of the metric, or null (unspecified). */
  direction: PredictedDirection | null;
}

/** An assumption the hypothesis rests on (retained, never dropped silently). */
export interface Assumption {
  id: string;
  statement: string;
}

/** An alternative explanation retained verbatim (never collapsed into a winner). */
export interface AlternativeExplanation {
  id: string;
  explanation: string;
}

/** A condition which, if observed, would refute the hypothesis. */
export interface RefutationCondition {
  id: string;
  description: string;
}

/** The full hypothesis content (the exact creation content). */
export interface CausalHypothesisContent {
  /** The claim text, e.g. "enabling the write-through cache caused p99 to drop". */
  statement: string;
  /** The asserted strength — validated against the evidence references. */
  claim_strength: ClaimStrength;
  /** What is intervened. */
  intervention: InterventionDescription;
  /** The causal mechanism (why X should produce Y). */
  mechanism: string;
  /** Predicted outcomes (at least one). */
  predicted_outcomes: PredictedOutcome[];
  /** Assumptions (at least one — retained). */
  assumptions: Assumption[];
  /** Applicability/observation context (at least one fact; plain JSON). */
  context: Record<string, JsonValue>;
  /** Alternative explanations (each retained verbatim; may be empty). */
  alternatives: AlternativeExplanation[];
  /** Refutation conditions (at least one — falsifiability is mandatory). */
  refutations: RefutationCondition[];
  /** The minimal causal graph (at least one factor and one CONTRIBUTES_TO edge). */
  graph: CausalGraph;
  /** Observational evidence references (correlation only). */
  observational_evidence: ObservationalEvidenceRef[];
  /** Interventional evidence references (the only class supporting a CAUSAL claim). */
  interventional_evidence: InterventionalEvidenceRef[];
  /** Uncertainty: qualitative class unless a calibration artifact exists. */
  uncertainty: Confidence;
  /** WHO/WHAT produced this hypothesis. */
  producer: Producer;
  /** The correlation record this hypothesis was explicitly derived from, or null. */
  correlation_origin: string | null;
}

export interface CausalHypothesisArtifact {
  /** Semantic Spine envelope; kind is always "CausalHypothesis". */
  envelope: ArtifactEnvelope;
  /** Hypothesis content (exact field set). */
  content: CausalHypothesisContent;
}

export interface CreateCausalHypothesisInput {
  content: CausalHypothesisContent;
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
  /** Hypothesis artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
}

/**
 * The exact value a causal hypothesis id is derived from (exported so tests
 * and diagnostics reproduce ids bit-exactly — the W0.5 fixture discipline
 * this package follows).
 */
export interface CausalHypothesisCreationAddress {
  kind: 'CausalHypothesis';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: CausalHypothesisContent;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullOrNonEmptyString(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.length > 0);
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

/** Validate a non-empty plain-JSON context object (at least one fact). */
function assertValidContext(context: unknown, field: string): asserts context is Record<string, JsonValue> {
  if (!isPlainJsonRecord(context)) {
    throw new CausalError(`${field} must be a plain JSON object with at least one fact`);
  }
  const keys = Object.keys(context);
  if (keys.length < 1) {
    throw new CausalError(`${field} must carry at least one fact (an empty context carries no applicability information)`);
  }
  for (const key of keys) {
    if (key.length === 0) {
      throw new CausalError(`${field} keys must be non-empty strings`);
    }
    if (!isPlainJsonValue(context[key])) {
      throw new CausalError(`${field}.${key} is not a JSON value`);
    }
  }
}

/** Validate an array of { id, <text field> } items with unique non-empty ids. */
function assertValidIdTextItems(
  values: unknown,
  field: string,
  textField: 'statement' | 'description' | 'explanation',
  minimum: number,
): void {
  if (!Array.isArray(values)) {
    throw new CausalError(`${field} must be an array of { id, ${textField} } items`);
  }
  if (values.length < minimum) {
    const why: Record<string, string> = {
      assumptions: 'a hypothesis always rests on assumptions',
      refutations: 'an unfalsifiable hypothesis is not a hypothesis',
      predicted_outcomes: 'a hypothesis must predict at least one observable outcome',
    };
    throw new CausalError(
      `${field} must contain at least ${minimum} item(s) (received ${values.length})` +
        (why[field] !== undefined ? ` — ${why[field]}` : ''),
    );
  }
  const ids = new Set<string>();
  for (const item of values) {
    if (!isPlainJsonRecord(item)) {
      throw new CausalError(`${field} items must be objects with exact fields { id, ${textField} }`);
    }
    const keys = Object.keys(item);
    if (keys.length !== 2 || !keys.includes('id') || !keys.includes(textField)) {
      throw new CausalError(`${field} items must have exact fields { id, ${textField} }, received keys: ${JSON.stringify(keys)}`);
    }
    if (!isNonEmptyString(item['id'])) {
      throw new CausalError(`${field} item ids must be non-empty strings`);
    }
    if (ids.has(item['id'])) {
      throw new CausalError(`duplicate ${field} id rejected: ${JSON.stringify(item['id'])}`);
    }
    ids.add(item['id']);
    if (!isNonEmptyString(item[textField])) {
      throw new CausalError(`${field}.${textField} must be a non-empty string, received: ${JSON.stringify(item[textField])}`);
    }
  }
}

/**
 * The evidence-support evaluation for a hypothesis content — delegated to
 * @sos-2/evidence's supportsStrongCausalClaim (the merged W3 authority;
 * W5 never re-implements the locked §18 rule).
 */
export function hypothesisEvidenceSupport(content: CausalHypothesisContent): CausalSupport {
  return supportsStrongCausalClaim([
    ...content.observational_evidence,
    ...content.interventional_evidence,
  ]);
}

/**
 * THE CLAIM GATE: validate that the asserted claim strength is supported by
 * the evidence references. A CAUSAL claim requires at least one
 * INTERVENTIONAL evidence reference with availability SUCCESS. Observational
 * references — however many — never suffice (spec/architecture.md §18).
 */
export function assertClaimSupportedByEvidence(
  claimStrength: ClaimStrength,
  observational: readonly ObservationalEvidenceRef[],
  interventional: readonly InterventionalEvidenceRef[],
): CausalSupport {
  const support = supportsStrongCausalClaim([...observational, ...interventional]);
  if (claimStrength === 'CAUSAL' && !support.supported) {
    throw new CausalError(
      `causal claim rejected: ${support.reason} — ` +
        'a strong causal claim (e.g. "X caused Y") requires intervention evidence; ' +
        'observational correlation is never sufficient (spec/architecture.md §18)',
    );
  }
  return support;
}

function assertValidIntervention(value: unknown): asserts value is InterventionDescription {
  if (!isPlainJsonRecord(value)) {
    throw new CausalError('intervention must be an object with exact fields { description, target_ref }');
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('description') || !keys.includes('target_ref')) {
    throw new CausalError('intervention must be an object with exact fields { description, target_ref }');
  }
  if (!isNonEmptyString(value['description'])) {
    throw new CausalError(`intervention.description must be a non-empty string, received: ${JSON.stringify(value['description'])}`);
  }
  if (value['target_ref'] !== null) {
    if (!isArtifactId(value['target_ref'])) {
      throw new CausalError(
        `intervention.target_ref must be null or a well-formed spine artifact id, received: ${JSON.stringify(value['target_ref'])}`,
      );
    }
  }
}

function assertValidPredictedOutcomes(values: unknown): asserts values is PredictedOutcome[] {
  if (!Array.isArray(values)) {
    throw new CausalError('predicted_outcomes must be an array of { id, description, metric, direction } items');
  }
  if (values.length < 1) {
    throw new CausalError('predicted_outcomes must contain at least one item (a hypothesis must predict at least one observable outcome)');
  }
  const ids = new Set<string>();
  for (const outcome of values) {
    if (!isPlainJsonRecord(outcome)) {
      throw new CausalError(
        'predicted outcome must be an object with exact fields { id, description, metric, direction }',
      );
    }
    const keys = Object.keys(outcome);
    const expected = ['id', 'description', 'metric', 'direction'];
    if (keys.length !== 4 || !expected.every((key) => keys.includes(key))) {
      throw new CausalError(
        'predicted outcome must be an object with exact fields { id, description, metric, direction }',
      );
    }
    if (!isNonEmptyString(outcome['id'])) {
      throw new CausalError(`predicted outcome ids must be non-empty strings, received: ${JSON.stringify(outcome['id'])}`);
    }
    if (ids.has(outcome['id'])) {
      throw new CausalError(`duplicate predicted outcome id rejected: ${JSON.stringify(outcome['id'])}`);
    }
    ids.add(outcome['id']);
    if (!isNonEmptyString(outcome['description'])) {
      throw new CausalError(`predicted outcome description must be a non-empty string, received: ${JSON.stringify(outcome['description'])}`);
    }
    if (!isNullOrNonEmptyString(outcome['metric'])) {
      throw new CausalError(`predicted outcome metric must be null or a non-empty string, received: ${JSON.stringify(outcome['metric'])}`);
    }
    const direction = outcome['direction'];
    if (
      direction !== null &&
      !(typeof direction === 'string' && (PREDICTED_DIRECTIONS as readonly string[]).includes(direction))
    ) {
      throw new CausalError(
        `predicted outcome direction must be one of ${PREDICTED_DIRECTIONS.join(', ')} or null, received: ${JSON.stringify(direction)}`,
      );
    }
  }
}

/**
 * Validate the full hypothesis content (throws CausalError). The claim gate
 * runs LAST: structural validity first, then the evidence-class separation,
 * then the §18 claim-vs-evidence consistency.
 */
export function assertValidCausalHypothesisContent(value: unknown): asserts value is CausalHypothesisContent {
  if (!isPlainJsonRecord(value)) {
    throw new CausalError('causal hypothesis content must be an object');
  }
  const required: Array<keyof CausalHypothesisContent> = [
    'statement',
    'claim_strength',
    'intervention',
    'mechanism',
    'predicted_outcomes',
    'assumptions',
    'context',
    'alternatives',
    'refutations',
    'graph',
    'observational_evidence',
    'interventional_evidence',
    'uncertainty',
    'producer',
    'correlation_origin',
  ];
  for (const key of required) {
    if (!(key in value)) {
      throw new CausalError(`causal hypothesis content is missing required field: ${JSON.stringify(key)}`);
    }
  }
  if (!isNonEmptyString(value['statement'])) {
    throw new CausalError(`statement must be a non-empty string, received: ${JSON.stringify(value['statement'])}`);
  }
  const claimStrength = value['claim_strength'];
  if (!isClaimStrength(claimStrength)) {
    throw new CausalError(
      `claim_strength must be CAUSAL or CORRELATIONAL, received: ${JSON.stringify(claimStrength)}`,
    );
  }
  assertValidIntervention(value['intervention']);
  if (!isNonEmptyString(value['mechanism'])) {
    throw new CausalError(`mechanism must be a non-empty string, received: ${JSON.stringify(value['mechanism'])}`);
  }
  assertValidPredictedOutcomes(value['predicted_outcomes']);
  assertValidIdTextItems(value['assumptions'], 'assumptions', 'statement', 1);
  assertValidContext(value['context'], 'context');
  assertValidIdTextItems(value['alternatives'], 'alternatives', 'explanation', 0);
  assertValidIdTextItems(value['refutations'], 'refutations', 'description', 1);
  try {
    assertValidCausalGraph(value['graph']);
  } catch (cause) {
    throw new CausalError(`graph is invalid: ${(cause as Error).message}`);
  }
  const graph = value['graph'] as CausalGraph;
  if (graph.factors.length < 1) {
    throw new CausalError('causal hypothesis graph must declare at least one factor');
  }
  if (!graph.edges.some((edge) => edge.type === 'CONTRIBUTES_TO')) {
    throw new CausalError(
      'causal hypothesis graph must contain at least one CONTRIBUTES_TO edge (the claimed cause -> effect relation)',
    );
  }

  const observational = value['observational_evidence'];
  const interventional = value['interventional_evidence'];
  if (!Array.isArray(observational) || !Array.isArray(interventional)) {
    throw new CausalError(
      'observational_evidence and interventional_evidence must be arrays of class-typed evidence references',
    );
  }
  for (const ref of observational) {
    assertValidObservationalEvidenceRef(ref);
  }
  for (const ref of interventional) {
    assertValidInterventionalEvidenceRef(ref);
  }
  if (observational.length + interventional.length < 1) {
    throw new CausalError(
      'a causal hypothesis must cite at least one evidence reference — evidence outranks assertion about system reality (spec/architecture.md §18)',
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

  const correlationOrigin = value['correlation_origin'];
  if (!isNullOrNonEmptyString(correlationOrigin)) {
    throw new CausalError(
      `correlation_origin must be null or a non-empty string, received: ${JSON.stringify(correlationOrigin)}`,
    );
  }

  // THE CLAIM GATE (§18): CAUSAL requires interventional SUCCESS evidence.
  assertClaimSupportedByEvidence(
    claimStrength,
    observational as ObservationalEvidenceRef[],
    interventional as InterventionalEvidenceRef[],
  );
}

/** Predicate form of assertValidCausalHypothesisContent. */
export function validateCausalHypothesisContent(value: unknown): value is CausalHypothesisContent {
  try {
    assertValidCausalHypothesisContent(value);
    return true;
  } catch {
    return false;
  }
}

/** The creation address of a hypothesis creation input (envelope fields + content). */
export function causalHypothesisCreationAddress(
  input: CreateCausalHypothesisInput,
): CausalHypothesisCreationAddress {
  assertValidCausalHypothesisContent(input.content);
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new CausalError('provenance must be a non-empty array of non-empty strings (no provenance-less hypotheses)');
  }
  return {
    kind: CAUSAL_HYPOTHESIS_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content: input.content,
  };
}

/** Derive the deterministic causal hypothesis id for a creation input. */
export function causalHypothesisArtifactId(input: CreateCausalHypothesisInput): string {
  return deriveDeterministicArtifactId(CAUSAL_HYPOTHESIS_KIND, causalHypothesisCreationAddress(input));
}

/**
 * Create a causal hypothesis artifact. The id is ALWAYS deterministic
 * (content-addressed over the creation address); the envelope is ALWAYS
 * minted by the spine. THE CLAIM GATE RUNS HERE: construction validates the
 * asserted claim strength against the evidence references and REJECTS causal
 * claims backed only by observational evidence.
 */
export function createCausalHypothesis(input: CreateCausalHypothesisInput): CausalHypothesisArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new CausalError('causal hypothesis creation input must be an object');
  }
  assertValidCausalHypothesisContent(input.content);

  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;

  const id = deriveDeterministicArtifactId(CAUSAL_HYPOTHESIS_KIND, {
    kind: CAUSAL_HYPOTHESIS_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: input.content,
  });

  const envelope = createEnvelope({
    kind: CAUSAL_HYPOTHESIS_KIND,
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

/**
 * Full semantic validation of a causal hypothesis artifact (throws
 * CausalError): exact artifact shape, spine-valid envelope of kind
 * CausalHypothesis, valid content — INCLUDING the §18 claim-vs-evidence
 * consistency, so a hand-crafted artifact with an unsupported causal claim
 * is rejected exactly like a bad creation input.
 *
 * Identity discipline mirrors @sos-2/mission: ids are minted at CREATION over
 * the creation address and preserved across lifecycle transitions; creation
 * determinism is pinned by tests, not re-derived here.
 */
export function assertValidCausalHypothesis(value: unknown): asserts value is CausalHypothesisArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CausalError('causal hypothesis artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new CausalError('causal hypothesis artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new CausalError(`causal hypothesis envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== CAUSAL_HYPOTHESIS_KIND) {
    throw new CausalError(
      `causal hypothesis envelope kind must be "${CAUSAL_HYPOTHESIS_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidCausalHypothesisContent(record['content']);
}

/** Predicate form of assertValidCausalHypothesis. */
export function validateCausalHypothesis(value: unknown): value is CausalHypothesisArtifact {
  try {
    assertValidCausalHypothesis(value);
    return true;
  } catch {
    return false;
  }
}

/** True iff this hypothesis was drafted by model output (LLM) — never authoritative (§18). */
export function isLlmHypothesis(artifact: CausalHypothesisArtifact): boolean {
  assertValidCausalHypothesis(artifact);
  return isLlmProducer(artifact.content.producer);
}

/**
 * True iff this hypothesis is NON-AUTHORITATIVE: LLM output is never
 * authoritative evidence or authorization (spec/architecture.md §18).
 */
export function isNonAuthoritativeHypothesis(artifact: CausalHypothesisArtifact): boolean {
  return isLlmHypothesis(artifact);
}

/** All evidence references of a hypothesis (observational first, then interventional). */
export function hypothesisEvidenceReferences(content: CausalHypothesisContent): EvidenceReference[] {
  assertValidCausalHypothesisContent(content);
  return [...content.observational_evidence, ...content.interventional_evidence];
}
