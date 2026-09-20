/**
 * Provenance records — WHO/WHAT produced a record, against WHICH exact
 * revisions, over WHICH time window and context, derived FROM WHAT, and with
 * WHAT availability of the underlying source.
 *
 * W3 realization of the provenance contract from the Work Order:
 *   - exact source revision and exact deployment revision (or null when
 *     genuinely unknown — null is PRESERVED, never defaulted);
 *   - time window and context;
 *   - provenance chain (tool, model+version if LLM-involved, command,
 *     environment live on the Producer; hops live on the chain);
 *   - availability of the underlying source — FAILURE/UNKNOWN are preserved
 *     distinctly, never dropped and never coerced to SUCCESS;
 *   - LLM provenance: records produced by model output carry the model id
 *     (producer.model) and the `llm_output` mark; such records are NEVER
 *     authoritative (spec/architecture.md §18).
 *
 * Identity discipline: ids are ALWAYS minted by the Semantic Spine
 * (deterministic content-addressing over the exact creation content minus
 * the id). The artifact kind segment "ProvenanceRecord" is a documented,
 * explicitly-registered extension kind (the spine's sanctioned
 * registerArtifactKind API — no second kind registry is created).
 */

import {
  canonicalSerialize,
  deriveDeterministicArtifactId,
  isArtifactId,
  isEvidenceTruthState,
  parseArtifactId,
  registerArtifactKind,
} from '@sos-2/semantic-spine';
import type { EvidenceTruthState, JsonValue } from '@sos-2/semantic-spine';
import { ProvenanceError } from './errors.js';
import { assertValidProducer, isLlmProducer } from './producer.js';
import type { Producer } from './producer.js';
import { assertValidTimeWindow } from './window.js';
import type { TimeWindow } from './window.js';
import { assertValidProvenanceHop } from './chain.js';
import type { ProvenanceHop } from './chain.js';

/** The artifact kind segment used for provenance record ids. */
export const PROVENANCE_ARTIFACT_KIND = 'ProvenanceRecord';

/**
 * Register the ProvenanceRecord extension kind in the spine's kind registry.
 * Idempotent: re-registration of the same kind is a no-op. The registry is
 * add-only, so this can never remove or mutate any frozen core kind.
 */
export function registerProvenanceArtifactKind(): void {
  try {
    registerArtifactKind(PROVENANCE_ARTIFACT_KIND);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!message.includes('already registered')) {
      throw cause;
    }
  }
}

// Register eagerly at module load (documented, idempotent, add-only): the
// spine's kind registry is the single kind authority and this package's ids
// use the ProvenanceRecord kind segment.
registerProvenanceArtifactKind();

export interface ProvenanceRecord {
  /** Deterministic spine id: sos://ProvenanceRecord/<32 lowercase hex>. */
  id: string;
  /** WHO/WHAT produced the record. */
  producer: Producer;
  /** Exact source revision, or null (preserved, never defaulted). */
  source_revision: string | null;
  /** Exact deployment revision, or null (preserved, never defaulted). */
  deployment_revision: string | null;
  /** Time window the record covers, or null. */
  window: TimeWindow | null;
  /** Structured context facts (e.g. { "environment": "production" }), or null. */
  context: Record<string, JsonValue> | null;
  /** Provenance chain hops (what this record was derived from). May be empty (root provenance). */
  chain: ProvenanceHop[];
  /** Availability of the underlying source — all 6 distinct truth states allowed; never dropped. */
  source_availability: EvidenceTruthState;
  /** True iff produced by model output (derived: producer.model !== null). LLM output is never authoritative. */
  llm_output: boolean;
}

export interface CreateProvenanceRecordInput {
  producer: Producer;
  source_revision?: string | null;
  deployment_revision?: string | null;
  window?: TimeWindow | null;
  context?: Record<string, JsonValue> | null;
  chain?: ProvenanceHop[];
  source_availability: EvidenceTruthState;
}

/**
 * The exact value a provenance record id is derived from (exported so tests
 * and diagnostics reproduce ids bit-exactly — W0.5/W1 fixture discipline).
 */
export interface ProvenanceCreationContent {
  producer: Producer;
  source_revision: string | null;
  deployment_revision: string | null;
  window: TimeWindow | null;
  context: Record<string, JsonValue> | null;
  chain: ProvenanceHop[];
  source_availability: EvidenceTruthState;
}

function isNullOrNonEmptyString(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.length > 0);
}

function isPlainJsonValue(value: unknown): boolean {
  try {
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}

function validateContext(context: Record<string, JsonValue> | null | undefined, field: string): void {
  if (context === undefined || context === null) {
    return;
  }
  if (typeof context !== 'object' || Array.isArray(context)) {
    throw new ProvenanceError(`${field} must be null or a plain JSON object`);
  }
  for (const key of Object.keys(context)) {
    if (key.length === 0) {
      throw new ProvenanceError(`${field} keys must be non-empty strings`);
    }
    if (!isPlainJsonValue(context[key])) {
      throw new ProvenanceError(`${field}.${key} is not a JSON value (canonical serialization failed)`);
    }
  }
}

export function provenanceCreationContent(input: CreateProvenanceRecordInput): ProvenanceCreationContent {
  if (typeof input !== 'object' || input === null) {
    throw new ProvenanceError('provenance record input must be an object');
  }
  assertValidProducer(input.producer);
  const source_revision = input.source_revision ?? null;
  if (!isNullOrNonEmptyString(source_revision)) {
    throw new ProvenanceError(`source_revision must be null or a non-empty string, received: ${JSON.stringify(source_revision)}`);
  }
  const deployment_revision = input.deployment_revision ?? null;
  if (!isNullOrNonEmptyString(deployment_revision)) {
    throw new ProvenanceError(`deployment_revision must be null or a non-empty string, received: ${JSON.stringify(deployment_revision)}`);
  }
  const window = input.window ?? null;
  if (window !== null) {
    assertValidTimeWindow(window);
  }
  const context = input.context ?? null;
  validateContext(context, 'context');
  const chain = input.chain ?? [];
  if (!Array.isArray(chain)) {
    throw new ProvenanceError('chain must be an array of provenance hops');
  }
  for (const hop of chain) {
    assertValidProvenanceHop(hop);
  }
  if (!isEvidenceTruthState(input.source_availability)) {
    throw new ProvenanceError(
      `source_availability must be one of the 6 distinct evidence truth states, received: ${JSON.stringify(input.source_availability)}`,
    );
  }
  return {
    producer: { ...input.producer },
    source_revision,
    deployment_revision,
    window: window === null ? null : { ...window },
    context: context === null ? null : { ...context },
    chain: chain.map((hop) => ({ ...hop })),
    source_availability: input.source_availability,
  };
}

/** Derive the deterministic provenance record id for a creation input. */
export function provenanceRecordId(input: CreateProvenanceRecordInput): string {
  return deriveDeterministicArtifactId(PROVENANCE_ARTIFACT_KIND, provenanceCreationContent(input));
}

/**
 * Create a provenance record. Ids are ALWAYS deterministic
 * (content-addressed) — provenance is reproducible from exact revisions
 * (spec/architecture.md §18, R30). `llm_output` is DERIVED from the producer
 * (producer.model !== null) — LLM involvement can never be hidden.
 */
export function createProvenanceRecord(input: CreateProvenanceRecordInput): ProvenanceRecord {
  const content = provenanceCreationContent(input);
  const id = deriveDeterministicArtifactId(PROVENANCE_ARTIFACT_KIND, content);
  return {
    id,
    producer: content.producer,
    source_revision: content.source_revision,
    deployment_revision: content.deployment_revision,
    window: content.window,
    context: content.context,
    chain: content.chain,
    source_availability: content.source_availability,
    llm_output: isLlmProducer(content.producer),
  };
}

const PROVENANCE_RECORD_KEYS = [
  'id',
  'producer',
  'source_revision',
  'deployment_revision',
  'window',
  'context',
  'chain',
  'source_availability',
  'llm_output',
] as const;

/** Full semantic validation with a specific error message (throws ProvenanceError). */
export function assertValidProvenanceRecord(value: unknown): asserts value is ProvenanceRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProvenanceError('provenance record must be an object');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = new Set<string>(PROVENANCE_RECORD_KEYS);
  if (actual.length !== PROVENANCE_RECORD_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new ProvenanceError(
      'provenance record must have the exact field set { id, producer, source_revision, deployment_revision, window, context, chain, source_availability, llm_output }',
    );
  }
  if (!isArtifactId(record['id'])) {
    throw new ProvenanceError(`provenance record id is not a well-formed artifact id: ${JSON.stringify(record['id'])}`);
  }
  const parsed = parseArtifactId(record['id']);
  if (parsed.kind !== PROVENANCE_ARTIFACT_KIND) {
    throw new ProvenanceError(
      `provenance record id ${record['id']} declares kind ${parsed.kind}, expected ${PROVENANCE_ARTIFACT_KIND}`,
    );
  }
  try {
    assertValidProducer(record['producer']);
  } catch (cause) {
    throw new ProvenanceError(`producer is invalid: ${(cause as Error).message}`);
  }
  if (!isNullOrNonEmptyString(record['source_revision'])) {
    throw new ProvenanceError(`source_revision must be null or a non-empty string, received: ${JSON.stringify(record['source_revision'])}`);
  }
  if (!isNullOrNonEmptyString(record['deployment_revision'])) {
    throw new ProvenanceError(`deployment_revision must be null or a non-empty string, received: ${JSON.stringify(record['deployment_revision'])}`);
  }
  if (record['window'] !== null) {
    try {
      assertValidTimeWindow(record['window']);
    } catch (cause) {
      throw new ProvenanceError(`window is invalid: ${(cause as Error).message}`);
    }
  }
  validateContext(record['context'] as Record<string, JsonValue> | null, 'context');
  if (!Array.isArray(record['chain'])) {
    throw new ProvenanceError('chain must be an array of provenance hops');
  }
  for (const hop of record['chain']) {
    try {
      assertValidProvenanceHop(hop);
    } catch (cause) {
      throw new ProvenanceError(`chain hop is invalid: ${(cause as Error).message}`);
    }
  }
  if (!isEvidenceTruthState(record['source_availability'])) {
    throw new ProvenanceError(
      `source_availability must be one of the 6 distinct evidence truth states, received: ${JSON.stringify(record['source_availability'])}`,
    );
  }
  if (typeof record['llm_output'] !== 'boolean') {
    throw new ProvenanceError(`llm_output must be a boolean, received: ${JSON.stringify(record['llm_output'])}`);
  }
  const producer = record['producer'] as Producer;
  if (record['llm_output'] !== isLlmProducer(producer)) {
    throw new ProvenanceError(
      `llm_output (${String(record['llm_output'])}) is inconsistent with the producer (model ${JSON.stringify(
        producer.model,
      )} ${producer.model === null ? 'absent' : 'present'}) — LLM involvement can never be hidden or claimed falsely`,
    );
  }
}

/** Predicate form of assertValidProvenanceRecord. */
export function validateProvenanceRecord(value: unknown): value is ProvenanceRecord {
  try {
    assertValidProvenanceRecord(value);
    return true;
  } catch {
    return false;
  }
}

/** True iff this record was produced by model output. */
export function isLlmOutput(record: ProvenanceRecord): boolean {
  return record.llm_output;
}

/**
 * True iff this record is NON-AUTHORITATIVE.
 *
 * Per spec/architecture.md §18, LLM output is never authoritative evidence
 * or authorization: every LLM-produced provenance record is non-authoritative.
 * (Non-LLM records are not thereby granted authority — they are simply
 * eligible as evidence inputs; authority is granted elsewhere, by humans.)
 */
export function isNonAuthoritativeProvenance(record: ProvenanceRecord): boolean {
  return record.llm_output;
}
