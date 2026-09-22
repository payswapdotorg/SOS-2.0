/**
 * The ReasoningProviderPort (Work Order P6) — the injectable port every
 * reasoning provider (managed or BYO) answers.
 *
 * Providers are REPLACEABLE REASONING MECHANISMS, never authorities
 * (ARCHITECT_START_HERE.md: "LLMs/planners are replaceable reasoning
 * mechanisms, never authorities"). The port carries NO authority fields
 * — nothing a provider returns can mint, carry or widen authority.
 *
 * Identity discipline: provider ids are RUNTIME identifiers (never
 * spine-shaped — the @sos-2/runtime-contracts guard is consumed).
 * HONEST STATUSES: a BYO slot that is not connected reports
 * NOT_YET_CONNECTED — availability is never fabricated (the P8
 * reference-body precedent). The SIMULATED marker is explicit on every
 * reference provider: simulated reasoning is evaluation infrastructure,
 * never evidence and never authority.
 */

import { assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';
import { InvalidReasoningInputError } from './errors.js';
import type { NonAuthoritativeAnalysis } from './analysis.js';
import type { JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';

/** The analysis request kinds the plane serves. */
export const REASONING_REQUEST_KINDS = ['decomposition', 'planning', 'summary'] as const;
export type ReasoningRequestKind = (typeof REASONING_REQUEST_KINDS)[number];

const REQUEST_KIND_SET: ReadonlySet<string> = new Set(REASONING_REQUEST_KINDS);

/** Is this a reasoning request kind? */
export function isReasoningRequestKind(value: unknown): value is ReasoningRequestKind {
  return typeof value === 'string' && REQUEST_KIND_SET.has(value);
}

/** Honest provider connection statuses (availability is never fabricated). */
export const REASONING_PROVIDER_STATUSES = ['AVAILABLE', 'NOT_YET_CONNECTED'] as const;
export type ReasoningProviderStatus = (typeof REASONING_PROVIDER_STATUSES)[number];

/** Which kind of provider answers (managed default vs bring-your-own). */
export const REASONING_PROVIDER_KINDS = ['managed', 'byo'] as const;
export type ReasoningProviderKind = (typeof REASONING_PROVIDER_KINDS)[number];

/** The provider identity block — provenance metadata for every output. */
export interface ReasoningProviderIdentity {
  /** Provider identity — a RUNTIME identifier, NEVER a SOS semantic identity. */
  readonly provider_id: string;
  readonly provider_kind: ReasoningProviderKind;
  readonly model: string;
  readonly version: string;
  readonly status: ReasoningProviderStatus;
  /** EXPLICIT simulated marker — reference providers are simulated, never live. */
  readonly simulated: boolean;
}

/** The advertised reasoning capabilities (capability-driven routing). */
export interface ReasoningCapabilities {
  /** The served request kinds (non-empty, unique, from the vocabulary). */
  readonly kinds: readonly ReasoningRequestKind[];
  /** Context ceiling in bytes (inputs larger than this are ineligible). */
  readonly max_context_bytes: number;
  /** Cost per request in USD, or null when unmetered. */
  readonly cost_per_request_usd: number | null;
}

/** A reasoning request (capability/cost/context routed). */
export interface ReasoningRequest {
  readonly kind: ReasoningRequestKind;
  /** The request input (canonical JSON — e.g. a mission view). */
  readonly input: JsonValue;
  /** Routing context: which mission the analysis serves, when known. */
  readonly context: {
    readonly mission_ref: string | null;
    /** Cost ceiling in USD for this request, or null when unmetered. */
    readonly max_cost_usd: number | null;
  };
}

/** The typed outcome of one provider analysis call. */
export type ReasoningOutcome =
  | {
      /** The provider produced an analysis (NON-AUTHORITATIVE by construction). */
      readonly status: 'ANALYZED';
      readonly analysis: NonAuthoritativeAnalysis;
    }
  | {
      /**
       * The provider honestly cannot serve (NOT_YET_CONNECTED, capability
       * gap, context overflow) — truthful, never fabricated.
       */
      readonly status: 'UNAVAILABLE';
      readonly reason: string;
    };

/**
 * THE REASONING PROVIDER PORT — managed and BYO providers answer the
 * same shape; real providers attach later through this port without
 * contract change.
 */
export interface ReasoningProviderPort {
  identity(): ReasoningProviderIdentity;
  capabilities(): ReasoningCapabilities;
  analyze(request: ReasoningRequest): Promise<ReasoningOutcome>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate a provider identity (throws InvalidReasoningInputError). */
export function assertValidReasoningProviderIdentity(value: unknown): asserts value is ReasoningProviderIdentity {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['provider_id', 'provider_kind', 'model', 'version', 'status', 'simulated']) ||
    !isNonEmptyString(value['model']) ||
    !isNonEmptyString(value['version']) ||
    typeof value['simulated'] !== 'boolean'
  ) {
    throw new InvalidReasoningInputError(
      `provider identity must be { provider_id, provider_kind: managed|byo, model, version, status: AVAILABLE|NOT_YET_CONNECTED, simulated }, received: ${JSON.stringify(value)}`,
    );
  }
  try {
    assertValidRuntimeIdentifier(value['provider_id'], 'reasoning provider_id');
  } catch (cause) {
    throw new InvalidReasoningInputError((cause as Error).message);
  }
  if (value['provider_kind'] !== 'managed' && value['provider_kind'] !== 'byo') {
    throw new InvalidReasoningInputError(`provider_kind must be managed or byo, received: ${JSON.stringify(value['provider_kind'])}`);
  }
  if (value['status'] !== 'AVAILABLE' && value['status'] !== 'NOT_YET_CONNECTED') {
    throw new InvalidReasoningInputError(`provider status must be AVAILABLE or NOT_YET_CONNECTED (availability is never fabricated), received: ${JSON.stringify(value['status'])}`);
  }
}

/** Validate advertised capabilities (throws InvalidReasoningInputError). */
export function assertValidReasoningCapabilities(value: unknown): asserts value is ReasoningCapabilities {
  if (!isPlainObject(value) || !hasExactKeys(value, ['kinds', 'max_context_bytes', 'cost_per_request_usd'])) {
    throw new InvalidReasoningInputError('reasoning capabilities must be { kinds, max_context_bytes, cost_per_request_usd }');
  }
  const kinds = value['kinds'];
  if (
    !Array.isArray(kinds) ||
    kinds.length === 0 ||
    !kinds.every((kind) => isReasoningRequestKind(kind)) ||
    new Set(kinds as string[]).size !== (kinds as string[]).length
  ) {
    throw new InvalidReasoningInputError(`capabilities kinds must be a non-empty duplicate-free list from [${REASONING_REQUEST_KINDS.join(', ')}]`);
  }
  const maxContext = value['max_context_bytes'];
  if (typeof maxContext !== 'number' || !Number.isInteger(maxContext) || maxContext <= 0) {
    throw new InvalidReasoningInputError(`capabilities max_context_bytes must be a positive integer, received: ${JSON.stringify(maxContext)}`);
  }
  const cost = value['cost_per_request_usd'];
  if (cost !== null && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)) {
    throw new InvalidReasoningInputError(`capabilities cost_per_request_usd must be null or a finite non-negative number, received: ${JSON.stringify(cost)}`);
  }
}

/** Validate a reasoning request (throws InvalidReasoningInputError). */
export function assertValidReasoningRequest(value: unknown): asserts value is ReasoningRequest {
  if (!isPlainObject(value) || !hasExactKeys(value, ['kind', 'input', 'context'])) {
    throw new InvalidReasoningInputError('reasoning request must be { kind, input, context }');
  }
  if (!isReasoningRequestKind(value['kind'])) {
    throw new InvalidReasoningInputError(`reasoning request kind must be one of ${REASONING_REQUEST_KINDS.join(', ')}, received: ${JSON.stringify(value['kind'])}`);
  }
  try {
    canonicalSerialize(value['input']);
  } catch {
    throw new InvalidReasoningInputError('reasoning request input must be canonical JSON');
  }
  const context = value['context'];
  if (
    !isPlainObject(context) ||
    !hasExactKeys(context, ['mission_ref', 'max_cost_usd']) ||
    (context['mission_ref'] !== null && !isNonEmptyString(context['mission_ref'])) ||
    (context['max_cost_usd'] !== null && (typeof context['max_cost_usd'] !== 'number' || !Number.isFinite(context['max_cost_usd']) || context['max_cost_usd'] < 0))
  ) {
    throw new InvalidReasoningInputError('reasoning request context must be { mission_ref: string | null, max_cost_usd: number | null }');
  }
}
