/**
 * ReasoningProviderAdapter — the W12 reasoning-provider contract
 * (docs/implementation/REFERENCE-STACK.md: "LLM providers implement a
 * reasoning-provider contract"; spec/architecture.md section 2: "LLMs,
 * planners, search algorithms and optimizers are replaceable reasoning
 * mechanisms. They are never authorities.").
 *
 * WHAT THIS IS: the interface an LLM provider implements to serve
 * prompt/complete requests to the SOS control plane, plus an in-memory
 * reference implementation (handler-supplied generation). Providers are
 * REPLACEABLE: swapping one for another never changes any SOS semantics.
 *
 * PROVENANCE DISCIPLINE: every completion carries its model id + version
 * (ReasoningModelIdentity, echoed into the Producer as model/model_version
 * so the @sos-2/provenance LLM mark applies) — WHO answered is always
 * recorded.
 *
 * NON-AUTHORITATIVE DISCIPLINE (spec/architecture.md section 18: "LLM
 * output is never authoritative evidence or authorization"):
 *   - ReasoningOutput is a structural bridge { content: JsonValue,
 *     producer: Producer } — the producer is ALWAYS LLM-marked
 *     (model !== null), enforced at construction.
 *   - `reasoningOutputAsEvidence` mints the W3 evidence record for a
 *     completion and returns it NARROWED to the compile-time type
 *     `NonAuthoritativeEvidence` (llm_output: true) — an LLM output can
 *     never be TYPED as authoritative evidence. The W3 layer derives
 *     llm_output from the producer, so the mark cannot be forged or
 *     stripped: a tampered record fails @sos-2/evidence validation, and
 *     `assertNonAuthoritativeEvidence` refuses any record whose mark is
 *     not exactly true.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { assertValidProducer, isLlmProducer } from '@sos-2/provenance';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { createEvidence, isNonAuthoritativeEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { ReasoningProviderError } from './errors.js';
import { assertValidJsonValue } from './json.js';
import { verifyAdapterOutputs } from './semantic-bridge.js';
import type { AdapterContractDescriptor } from './semantic-bridge.js';

/** The reasoning provider adapter contract: bridged outputs are content + producer (+ evidence form). */
export const REASONING_PROVIDER_ADAPTER_DESCRIPTOR: AdapterContractDescriptor = {
  contract: 'ReasoningProviderAdapter',
  outputs: {
    content: 'JsonValue',
    producer: 'Producer',
    evidence: 'EvidenceRecord',
  },
} as const;

/** The completion output site: { content: JsonValue, producer: Producer }. */
export const REASONING_COMPLETION_OUTPUT: AdapterContractDescriptor = {
  contract: 'ReasoningProviderAdapter',
  outputs: { content: 'JsonValue', producer: 'Producer' },
} as const;

/** The model identity a provider MUST declare (provenance: model id + version). */
export interface ReasoningModelIdentity {
  /** Model id (non-empty), e.g. "glm-4.6". */
  model: string;
  /** Model version (non-empty), e.g. "2025-06". */
  model_version: string;
}

/** A prompt/complete request. */
export interface ReasoningCompletionRequest {
  /** Optional system prompt, or null. */
  system: string | null;
  /** The user prompt (non-empty). */
  prompt: string;
  /** Optional structured inputs (JSON), or null. */
  inputs: JsonValue | null;
}

/** A completion — a structural bridge, nothing more. */
export interface ReasoningOutput {
  /** The completion payload (JSON), or null when the provider produced none. */
  content: JsonValue | null;
  /** WHO produced the completion — ALWAYS LLM-marked (model !== null). */
  producer: Producer;
}

/**
 * The reasoning-provider contract. `complete` may throw on provider-side
 * failures (transport, rate limits, refusal) — a thrown completion is not
 * a completion; callers treat it as no-output, never as failure evidence
 * about any SOS subject.
 */
export interface ReasoningProviderAdapter {
  /** The declared contract (bridged outputs; part of the semantic guard). */
  readonly descriptor: AdapterContractDescriptor;

  /** The provider's declared model identity (recorded in every output). */
  readonly model: ReasoningModelIdentity;

  /** Produce a completion for the request. */
  complete(request: ReasoningCompletionRequest): ReasoningOutput;
}

function assertValidModelIdentity(value: unknown): asserts value is ReasoningModelIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReasoningProviderError('reasoning model identity must be an object { model, model_version }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    throw new ReasoningProviderError('reasoning model identity must have the exact field set { model, model_version }');
  }
  if (typeof record['model'] !== 'string' || record['model'].length === 0) {
    throw new ReasoningProviderError(
      `reasoning model id must be a non-empty string, received: ${JSON.stringify(record['model'])}`,
    );
  }
  if (typeof record['model_version'] !== 'string' || record['model_version'].length === 0) {
    throw new ReasoningProviderError(
      `reasoning model version must be a non-empty string, received: ${JSON.stringify(record['model_version'])}`,
    );
  }
}

function assertValidCompletionRequest(value: unknown): asserts value is ReasoningCompletionRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReasoningProviderError('completion request must be an object { system, prompt, inputs }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) {
    throw new ReasoningProviderError('completion request must have the exact field set { system, prompt, inputs }');
  }
  if (record['system'] !== null && (typeof record['system'] !== 'string' || record['system'].length === 0)) {
    throw new ReasoningProviderError('system must be null or a non-empty string');
  }
  if (typeof record['prompt'] !== 'string' || record['prompt'].length === 0) {
    throw new ReasoningProviderError(`prompt must be a non-empty string, received: ${JSON.stringify(record['prompt'])}`);
  }
  if (record['inputs'] !== null) {
    try {
      assertValidJsonValue(record['inputs']);
    } catch {
      throw new ReasoningProviderError('inputs must be null or a JSON value');
    }
  }
}

/** Build the LLM-marked producer for a model identity (tool = this contract). */
export function reasoningProducer(model: ReasoningModelIdentity, environment: string | null = null): Producer {
  assertValidModelIdentity(model);
  const producer: Producer = {
    tool: 'reasoning-provider-adapter',
    tool_version: null,
    model: model.model,
    model_version: model.model_version,
    command: null,
    environment,
  };
  assertValidProducer(producer);
  if (!isLlmProducer(producer)) {
    // Unreachable for a validated identity; pinned loudly anyway — a
    // reasoning output whose producer is not LLM-marked would evade the
    // non-authoritative discipline.
    throw new ReasoningProviderError(
      'internal invariant violated: a reasoning producer must be LLM-marked (model !== null)',
    );
  }
  return producer;
}

/**
 * In-memory reference implementation: completions come from a
 * caller-supplied deterministic handler. The handler's return value is
 * validated as JSON; a thrown error propagates (provider-side failure).
 */
export class InMemoryReasoningProviderAdapter implements ReasoningProviderAdapter {
  readonly descriptor: AdapterContractDescriptor = REASONING_PROVIDER_ADAPTER_DESCRIPTOR;
  readonly model: ReasoningModelIdentity;

  private readonly generate: (request: ReasoningCompletionRequest) => JsonValue | null;
  private readonly producer: Producer;

  constructor(
    model: ReasoningModelIdentity,
    generate: (request: ReasoningCompletionRequest) => JsonValue | null,
    environment: string | null = null,
  ) {
    assertValidModelIdentity(model);
    if (typeof generate !== 'function') {
      throw new ReasoningProviderError('generate handler must be a function');
    }
    this.model = { ...model };
    this.generate = generate;
    this.producer = reasoningProducer(model, environment);
  }

  complete(request: ReasoningCompletionRequest): ReasoningOutput {
    assertValidCompletionRequest(request);
    const content = this.generate({ ...request });
    if (content !== null) {
      try {
        assertValidJsonValue(content);
      } catch {
        throw new ReasoningProviderError(
          'reasoning provider handler returned a non-JSON payload (rejected — outputs must be JSON bridges)',
        );
      }
    }
    const output: ReasoningOutput = {
      content: content === null ? null : structuredClone(content),
      producer: { ...this.producer },
    };
    verifyAdapterOutputs(REASONING_COMPLETION_OUTPUT, output);
    return output;
  }
}

// ---------------------------------------------------------------------------
// The non-authoritative evidence bridge (spec/architecture.md section 18)
// ---------------------------------------------------------------------------

/** An evidence record narrowed to the NON-AUTHORITATIVE form: llm_output is exactly true. */
export type NonAuthoritativeEvidence = EvidenceRecordW3 & { readonly llm_output: true };

/** Input of {@link reasoningOutputAsEvidence}. */
export interface ReasoningEvidenceInput {
  /** The completion being minted as evidence. */
  output: ReasoningOutput;
  /** Spine artifact id of the subject the evidence is about. */
  subject: string;
  /** Spine artifact id of the SystemState revision observed, or null. */
  subjectRevision?: string | null;
  /** Exact source revision, or null. */
  sourceRevision?: string | null;
  /** Exact deployment revision, or null. */
  deploymentRevision?: string | null;
  /** Observation time window, or null. */
  window?: TimeWindow | null;
  /** Extra provenance entries (recorded after the bridge's own). */
  provenance?: string[];
}

/**
 * Mint the W3 evidence record for a reasoning completion.
 *
 * The record is ALWAYS non-authoritative: the producer is LLM-marked, the
 * W3 layer DERIVES llm_output from it, and this function returns the record
 * narrowed to `NonAuthoritativeEvidence` (llm_output: true) — an LLM
 * output can never be TYPED as authoritative evidence (spec/architecture.md
 * section 18). `assertNonAuthoritativeEvidence` is run before returning as
 * a belt-and-braces pin.
 */
export function reasoningOutputAsEvidence(input: ReasoningEvidenceInput): NonAuthoritativeEvidence {
  if (typeof input !== 'object' || input === null) {
    throw new ReasoningProviderError('reasoning evidence input must be an object');
  }
  const output = input.output;
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    throw new ReasoningProviderError('reasoning evidence input requires a ReasoningOutput');
  }
  try {
    assertValidProducer(output.producer);
  } catch (cause) {
    throw new ReasoningProviderError(`reasoning output producer is invalid: ${(cause as Error).message}`);
  }
  if (!isLlmProducer(output.producer)) {
    throw new ReasoningProviderError(
      'reasoning output producer is not LLM-marked (model === null): an unmarked reasoning output ' +
        'cannot be minted as evidence — the non-authoritative discipline would be evaded',
    );
  }
  if (typeof input.subject !== 'string' || !isArtifactId(input.subject)) {
    throw new ReasoningProviderError(
      `subject must be a well-formed spine artifact id, received: ${JSON.stringify(input.subject)}`,
    );
  }
  const record = createEvidence({
    kind: 'reasoning-output',
    subject_ref: input.subject,
    // The completion's availability is about the COMPLETION itself: a
    // returned payload is a successful capture of what the model said; it
    // asserts NOTHING about the subject (that is why it is non-authoritative).
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'reasoning-provider:completion',
    provenance: [
      'adapter:@sos-2/adapters:reasoning-provider',
      `model:${output.producer.model}`,
      ...(input.provenance ?? []),
    ],
    source_revision: input.sourceRevision ?? null,
    deployment_revision: input.deploymentRevision ?? null,
    window: input.window ?? null,
    subject_revision: input.subjectRevision ?? null,
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
    producer: output.producer,
  });
  assertNonAuthoritativeEvidence(record);
  // Sound narrowing: the assert above pinned llm_output === true, so the
  // cast only tightens the static type the caller sees — the record itself
  // is untouched and remains the W3 canonical shape.
  return record as NonAuthoritativeEvidence;
}

/**
 * Refuse anything but a non-authoritative record (throws
 * ReasoningProviderError). Every LLM-produced evidence record is
 * non-authoritative; an authoritative-typed LLM record is a contradiction
 * and is REJECTED loudly.
 */
export function assertNonAuthoritativeEvidence(record: EvidenceRecordW3): void {
  if (record.llm_output !== true || !isNonAuthoritativeEvidence(record)) {
    throw new ReasoningProviderError(
      `LLM output is never authoritative evidence (spec/architecture.md section 18): record ${record.id} ` +
        'is not marked non-authoritative — REJECTED',
    );
  }
}
