/**
 * Capability/cost/context-driven provider routing (Work Order P6).
 *
 * spec/productization-execution-architecture.md §8: "provider routing is
 * capability/cost/context driven". Every selection is a TYPED, RECORDED
 * RoutingDecision — the considered list names every provider with its
 * eligibility and the reason, so routing is auditable and deterministic:
 *
 *   1. CAPABILITY — the provider's advertised kinds must include the
 *      request kind;
 *   2. CONTEXT — the canonical byte size of the request input must fit
 *      the provider's max_context_bytes;
 *   3. COST — when both the request ceiling and the provider's per-request
 *      cost are set, the provider's cost must not exceed the ceiling;
 *   4. STATUS — only AVAILABLE providers are eligible (a NOT_YET_CONNECTED
 *      BYO slot is honestly ineligible; availability is never fabricated);
 *   5. PREFERENCE — a connected BYO provider wins over the managed default
 *      (the user's own provider when it can serve); the managed default is
 *      ALWAYS eligible by construction (zero user configuration needed).
 *
 * Routing decision ids are content-derived ('route:' + 24 hex over the
 * canonical creation address) — deterministic, never minted.
 */

import { contentHash } from '@sos-2/semantic-spine';
import { InvalidReasoningInputError } from './errors.js';
import type { ReasoningRequestKind } from './port.js';
import type { ReasoningProviderIdentity, ReasoningCapabilities } from './port.js';

/** One considered provider on a routing decision (auditable). */
export interface RoutingConsideration {
  readonly provider_id: string;
  readonly provider_kind: 'managed' | 'byo';
  readonly status: string;
  readonly eligible: boolean;
  readonly reason: string;
}

/** The typed, recorded routing decision. */
export interface RoutingDecision {
  /** Content-derived deterministic id ('route:' + 24 hex). */
  readonly routing_id: string;
  readonly request_kind: ReasoningRequestKind;
  readonly considered: readonly RoutingConsideration[];
  readonly selected_provider_id: string;
  readonly selected_provider_kind: 'managed' | 'byo';
  readonly reason: string;
  /** RFC3339 (clock-stamped by the broker — the caller never stamps). */
  readonly at: string;
}

/** The exact address a routing id is derived from. */
export interface RoutingCreationAddress {
  readonly request_kind: ReasoningRequestKind;
  readonly considered: readonly RoutingConsideration[];
  readonly selected_provider_id: string;
  readonly selected_provider_kind: 'managed' | 'byo';
  readonly input_digest: string;
}

/** Derive the deterministic routing decision id. */
export function routingDecisionId(address: RoutingCreationAddress): string {
  const digest = contentHash({
    request_kind: address.request_kind,
    considered: address.considered,
    selected_provider_id: address.selected_provider_id,
    selected_provider_kind: address.selected_provider_kind,
    input_digest: address.input_digest,
  });
  return `route:${digest.slice(0, 24)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a routing decision (throws InvalidReasoningInputError). */
export function assertValidRoutingDecision(value: unknown): asserts value is RoutingDecision {
  if (
    !isPlainObject(value) ||
    typeof value['routing_id'] !== 'string' ||
    !value['routing_id'].startsWith('route:') ||
    (value['request_kind'] !== 'decomposition' && value['request_kind'] !== 'planning' && value['request_kind'] !== 'summary') ||
    !Array.isArray(value['considered']) ||
    typeof value['selected_provider_id'] !== 'string' ||
    (value['selected_provider_kind'] !== 'managed' && value['selected_provider_kind'] !== 'byo') ||
    typeof value['reason'] !== 'string' ||
    typeof value['at'] !== 'string'
  ) {
    throw new InvalidReasoningInputError(
      'routing decision must be { routing_id, request_kind, considered, selected_provider_id, selected_provider_kind, reason, at }',
    );
  }
  for (const entry of value['considered']) {
    if (
      !isPlainObject(entry) ||
      typeof entry['provider_id'] !== 'string' ||
      (entry['provider_kind'] !== 'managed' && entry['provider_kind'] !== 'byo') ||
      typeof entry['status'] !== 'string' ||
      typeof entry['eligible'] !== 'boolean' ||
      typeof entry['reason'] !== 'string'
    ) {
      throw new InvalidReasoningInputError('routing considerations must be { provider_id, provider_kind, status, eligible, reason }');
    }
  }
}

/**
 * Route one request over the provider identities: capability, context,
 * cost and honest-status gates, then the BYO-over-managed preference.
 * DETERMINISTIC: providers are considered in registration order and the
 * earliest eligible BYO wins; the managed default is the always-eligible
 * fallback.
 */
export function routeRequest(input: {
  kind: ReasoningRequestKind;
  input_byte_length: number;
  max_cost_usd: number | null;
  input_digest: string;
  providers: readonly { identity: ReasoningProviderIdentity; capabilities: ReasoningCapabilities }[];
}): RoutingDecision {
  const considered: RoutingConsideration[] = [];
  for (const provider of input.providers) {
    const identity = provider.identity;
    const capabilities = provider.capabilities;
    let eligible = true;
    let reason: string;
    if (identity.status !== 'AVAILABLE') {
      eligible = false;
      reason = `provider is ${identity.status} — availability is never fabricated`;
    } else if (!capabilities.kinds.includes(input.kind)) {
      eligible = false;
      reason = `capabilities do not include ${JSON.stringify(input.kind)}`;
    } else if (input.input_byte_length > capabilities.max_context_bytes) {
      eligible = false;
      reason = `input (${input.input_byte_length} bytes) exceeds max_context_bytes (${capabilities.max_context_bytes})`;
    } else if (
      input.max_cost_usd !== null &&
      capabilities.cost_per_request_usd !== null &&
      capabilities.cost_per_request_usd > input.max_cost_usd
    ) {
      eligible = false;
      reason = `cost per request (${capabilities.cost_per_request_usd} USD) exceeds the request ceiling (${input.max_cost_usd} USD)`;
    } else {
      reason =
        identity.provider_kind === 'managed'
          ? 'managed default provider: available, capable, within context and cost (always present, zero user configuration)'
          : 'bring-your-own provider: connected, capable, within context and cost';
    }
    considered.push({
      provider_id: identity.provider_id,
      provider_kind: identity.provider_kind,
      status: identity.status,
      eligible,
      reason,
    });
  }
  const eligibleProviders = input.providers.filter(
    (provider, index) => considered[index]!.eligible,
  );
  if (eligibleProviders.length === 0) {
    throw new InvalidReasoningInputError(
      'routing found no eligible provider — the managed default is always eligible by construction; this state is unreachable through the public broker',
    );
  }
  // Preference: the earliest registered eligible BYO provider wins over
  // the managed default (deterministic registration order).
  const byo = eligibleProviders.find((provider) => provider.identity.provider_kind === 'byo');
  const selected = byo ?? eligibleProviders.find((provider) => provider.identity.provider_kind === 'managed')!;
  const reason =
    byo !== undefined
      ? `routed to bring-your-own provider ${JSON.stringify(selected.identity.provider_id)} (capability/cost/context eligible, BYO preferred when it can serve)`
      : `routed to the managed default provider ${JSON.stringify(selected.identity.provider_id)} (capability/cost/context eligible; the managed default is always present — no personal LLM required)`;
  const routingId = routingDecisionId({
    request_kind: input.kind,
    considered,
    selected_provider_id: selected.identity.provider_id,
    selected_provider_kind: selected.identity.provider_kind,
    input_digest: input.input_digest,
  });
  return {
    routing_id: routingId,
    request_kind: input.kind,
    considered,
    selected_provider_id: selected.identity.provider_id,
    selected_provider_kind: selected.identity.provider_kind,
    reason,
    at: '', // stamped by the broker at recording time
  };
}
