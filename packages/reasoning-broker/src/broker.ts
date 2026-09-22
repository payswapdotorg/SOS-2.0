/**
 * THE REASONING BROKER (Work Order P6) — the non-authoritative
 * reasoning plane of the Spirit Orchestrator.
 *
 * WHAT THE BROKER OWNS:
 *   - the ALWAYS-PRESENT managed default provider (zero user
 *     configuration — a user NEVER needs a personal LLM to start);
 *   - OPTIONAL BYO provider slots (same port shape, honest
 *     NOT_YET_CONNECTED until connected — availability never fabricated);
 *   - CAPABILITY/COST/CONTEXT-DRIVEN ROUTING — every selection is a
 *     typed, recorded RoutingDecision (auditable, deterministic);
 *   - MODEL/VERSION PROVENANCE on EVERY output (provider identity +
 *     model + version + the routing decision that selected it);
 *   - the recorded analyses (audit trail) — every emitted
 *     NonAuthoritativeAnalysis validates against the structural guard.
 *
 * WHAT THE BROKER CAN NEVER DO: its output can inform decomposition,
 * planning and summaries, but NEVER enters authority, semantic-identity
 * or verification-verdict paths (the orchestrator-side structural pins
 * and the acceptance scans enforce this; the analysis type itself
 * carries the non_authoritative:true marker as a validated invariant).
 *
 * The broker re-mints the analysis id deterministically over the FULL
 * address INCLUDING the routing decision id — identical request + route
 * reproduces the identical analysis id.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env — the
 * clock is injected; ids are content-derived.
 */

import { InvalidReasoningInputError, ReasoningProviderError } from './errors.js';
import type { Clock } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import type { NonAuthoritativeAnalysis } from './analysis.js';
import { createNonAuthoritativeAnalysis, reasoningInputDigest } from './analysis.js';
import type { ReasoningCapabilities, ReasoningProviderIdentity, ReasoningProviderPort, ReasoningRequest } from './port.js';
import { assertValidReasoningProviderIdentity, assertValidReasoningRequest } from './port.js';
import type { RoutingDecision } from './routing.js';
import { routeRequest } from './routing.js';
import { ManagedReferenceReasoningProvider } from './providers/managed-reference.js';
import { ByoProviderSlot } from './providers/byo-slot.js';
import type { RegisterByoProviderInput } from './providers/byo-slot.js';

/** Broker dependencies: the injected clock (no hidden time). */
export interface ReasoningBrokerDeps {
  readonly clock: Clock;
}

/** The brokered analysis outcome: the recorded routing decision + the analysis. */
export interface BrokeredAnalysis {
  readonly routing: RoutingDecision;
  readonly analysis: NonAuthoritativeAnalysis;
}

/**
 * THE REASONING BROKER.
 */
export class ReasoningBroker {
  private readonly clock: Clock;
  private readonly managed: ManagedReferenceReasoningProvider;
  private readonly byoSlots: ByoProviderSlot[] = [];
  private readonly routingLog: RoutingDecision[] = [];
  private readonly analysisLog: NonAuthoritativeAnalysis[] = [];

  constructor(deps: ReasoningBrokerDeps) {
    if (typeof deps !== 'object' || deps === null || typeof deps.clock !== 'object' || deps.clock === null || typeof deps.clock.nowEpochMs !== 'function') {
      throw new ReasoningProviderError('ReasoningBroker requires an injected clock (no hidden time)');
    }
    this.clock = deps.clock;
    this.managed = new ManagedReferenceReasoningProvider();
  }

  /** Register an OPTIONAL BYO provider slot (honestly NOT_YET_CONNECTED until connected). */
  registerByo(input: RegisterByoProviderInput): ReasoningProviderIdentity {
    assertValidReasoningProviderIdentity({
      provider_id: input.provider_id,
      provider_kind: 'byo',
      model: input.model,
      version: input.version,
      status: 'NOT_YET_CONNECTED',
      simulated: true,
    });
    if (input.provider_id === this.managed.identity().provider_id) {
      throw new ReasoningProviderError(`provider id ${JSON.stringify(input.provider_id)} is reserved by the managed default`);
    }
    if (this.byoSlots.some((slot) => slot.identity().provider_id === input.provider_id)) {
      throw new ReasoningProviderError(`BYO provider ${JSON.stringify(input.provider_id)} is already registered — provider ids are single-use within the broker`);
    }
    const slot = new ByoProviderSlot(input);
    this.byoSlots.push(slot);
    return slot.identity();
  }

  /** Connect a registered BYO slot to a real provider implementation (same port shape). */
  connectByo(providerId: string, implementation: ReasoningProviderPort): ReasoningProviderIdentity {
    const slot = this.byoSlots.find((candidate) => candidate.identity().provider_id === providerId);
    if (slot === undefined) {
      throw new ReasoningProviderError(`no BYO provider registered under ${JSON.stringify(providerId)}`);
    }
    slot.connect(implementation);
    return slot.identity();
  }

  /** Every provider identity, deterministic order (managed first, then BYO slots in registration order). */
  providers(): ReasoningProviderIdentity[] {
    return [this.managed.identity(), ...this.byoSlots.map((slot) => slot.identity())];
  }

  /** The recorded routing decisions (audit — deterministic order). */
  routingDecisions(): RoutingDecision[] {
    return this.routingLog.map((decision) => ({ ...decision, considered: decision.considered.map((entry) => ({ ...entry })) }));
  }

  /** The recorded analyses (audit — deterministic order). */
  analyses(): NonAuthoritativeAnalysis[] {
    return this.analysisLog.map((analysis) => structuredClone(analysis));
  }

  /**
   * Serve a reasoning request: route (capability/cost/context — typed,
   * recorded), dispatch to the selected provider, re-mint the analysis id
   * deterministically over the full address (including the routing
   * decision) and record both. The managed default is the always-present
   * fallback: a BYO provider is preferred only when connected and
   * eligible.
   */
  async analyze(request: ReasoningRequest): Promise<BrokeredAnalysis> {
    assertValidReasoningRequest(request);
    const inputDigest = reasoningInputDigest(request.input);
    const candidates: { identity: ReasoningProviderIdentity; capabilities: ReasoningCapabilities; port: ReasoningProviderPort }[] = [
      { identity: this.managed.identity(), capabilities: this.managed.capabilities(), port: this.managed },
      ...this.byoSlots.map((slot) => ({ identity: slot.identity(), capabilities: slot.capabilities(), port: slot })),
    ];
    const decision = routeRequest({
      kind: request.kind,
      input_byte_length: canonicalSerialize(request.input).length,
      max_cost_usd: request.context.max_cost_usd,
      input_digest: inputDigest,
      providers: candidates.map((candidate) => ({ identity: candidate.identity, capabilities: candidate.capabilities })),
    });
    const recorded: RoutingDecision = { ...decision, at: formatRfc3339(this.clock.nowEpochMs()) };
    const selected = candidates.find((candidate) => candidate.identity.provider_id === decision.selected_provider_id);
    if (selected === undefined) {
      throw new InvalidReasoningInputError(`routing selected ${JSON.stringify(decision.selected_provider_id)} which is not registered — unreachable state`);
    }
    const outcome = await selected.port.analyze(request);
    if (outcome.status === 'UNAVAILABLE') {
      // The selected provider honestly cannot serve — fall back to the
      // managed default (always present). The fallback is RECORDED in a
      // follow-up routing decision naming the honest reason.
      const fallbackDecision = routeRequest({
        kind: request.kind,
        input_byte_length: canonicalSerialize(request.input).length,
        max_cost_usd: request.context.max_cost_usd,
        input_digest: inputDigest,
        providers: [{ identity: this.managed.identity(), capabilities: this.managed.capabilities() }],
      });
      const fallbackRecorded: RoutingDecision = {
        ...fallbackDecision,
        reason: `fallback to the managed default: the selected BYO provider ${JSON.stringify(decision.selected_provider_id)} reported UNAVAILABLE (${outcome.reason}) — the managed default is always present`,
        at: formatRfc3339(this.clock.nowEpochMs()),
      };
      this.routingLog.push(recorded, fallbackRecorded);
      const managedOutcome = await this.managed.analyze(request);
      if (managedOutcome.status !== 'ANALYZED') {
        throw new ReasoningProviderError('the managed default provider failed to analyze — it is deterministic and always available; unreachable state');
      }
      const analysis = this.finalizeAnalysis(managedOutcome.analysis, fallbackRecorded.routing_id);
      this.analysisLog.push(analysis);
      return { routing: fallbackRecorded, analysis };
    }
    const analysis = this.finalizeAnalysis(outcome.analysis, recorded.routing_id);
    this.routingLog.push(recorded);
    this.analysisLog.push(analysis);
    return { routing: recorded, analysis };
  }

  /** Re-mint the analysis over the full address (routing decision included) + validate. */
  private finalizeAnalysis(analysis: NonAuthoritativeAnalysis, routingId: string): NonAuthoritativeAnalysis {
    const final = createNonAuthoritativeAnalysis({
      kind: analysis.kind,
      input_digest: analysis.input_digest,
      provider_id: analysis.provenance.provider_id,
      provider_kind: analysis.provenance.provider_kind,
      model: analysis.provenance.model,
      version: analysis.provenance.version,
      routing_decision_id: routingId,
      simulated: analysis.simulated,
      content: analysis.content,
    });
    return final;
  }
}

/** Re-exported reference-provider constructions for the composition roots. */
export { ManagedReferenceReasoningProvider } from './providers/managed-reference.js';
export { ByoProviderSlot } from './providers/byo-slot.js';
