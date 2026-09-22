/**
 * THE BRING-YOUR-OWN PROVIDER SLOT (Work Order P6).
 *
 * spec/productization-execution-architecture.md §8: "optional: connect a
 * user's own provider." The slot is registered with the broker but is
 * HONESTLY NOT_YET_CONNECTED until a real provider implementation is
 * attached — availability is never fabricated (the P8 reference-body
 * precedent: NOT_YET_CONNECTED until connection evidence exists).
 *
 * A connected slot delegates to the attached implementation THROUGH THE
 * SAME PORT SHAPE — real providers attach later without contract change.
 */

import { createNonAuthoritativeAnalysis } from '../analysis.js';
import { reasoningInputDigest } from '../analysis.js';
import { ReasoningProviderError } from '../errors.js';
import type { ReasoningCapabilities, ReasoningOutcome, ReasoningProviderIdentity, ReasoningProviderPort, ReasoningRequest } from '../port.js';

/** Registration input for a BYO slot (identity + honest capabilities declared up front). */
export interface RegisterByoProviderInput {
  readonly provider_id: string;
  readonly model: string;
  readonly version: string;
  readonly capabilities: ReasoningCapabilities;
}

/**
 * A BYO slot: registered (NOT_YET_CONNECTED) -> connected (delegating).
 * The slot NEVER fabricates availability: before connection every
 * analyze() answers a typed UNAVAILABLE outcome naming the honest
 * reason; routing marks it ineligible.
 */
export class ByoProviderSlot implements ReasoningProviderPort {
  private connected: ReasoningProviderPort | null = null;

  constructor(private readonly registration: RegisterByoProviderInput) {
    if (typeof registration.provider_id !== 'string' || registration.provider_id.length === 0) {
      throw new ReasoningProviderError('BYO slot registration requires a non-empty provider_id (a RUNTIME identifier)');
    }
  }

  /** Connect a real provider implementation behind the same port shape. */
  connect(implementation: ReasoningProviderPort): void {
    if (typeof implementation !== 'object' || implementation === null || typeof implementation.analyze !== 'function') {
      throw new ReasoningProviderError('connecting a BYO slot requires a ReasoningProviderPort implementation');
    }
    if (this.connected !== null) {
      throw new ReasoningProviderError(
        `BYO provider ${JSON.stringify(this.registration.provider_id)} is already connected — replace the slot registration to change providers`,
      );
    }
    this.connected = implementation;
  }

  /** Is the slot connected? */
  get isConnected(): boolean {
    return this.connected !== null;
  }

  identity(): ReasoningProviderIdentity {
    if (this.connected !== null) {
      // The connected implementation owns its identity, but the slot
      // keeps the registration's provider_id (the registered runtime id).
      const inner = this.connected.identity();
      return { ...inner, provider_id: this.registration.provider_id, provider_kind: 'byo' };
    }
    return {
      provider_id: this.registration.provider_id,
      provider_kind: 'byo',
      model: this.registration.model,
      version: this.registration.version,
      status: 'NOT_YET_CONNECTED',
      simulated: true,
    };
  }

  capabilities(): ReasoningCapabilities {
    if (this.connected !== null) {
      return this.connected.capabilities();
    }
    return { ...this.registration.capabilities, kinds: [...this.registration.capabilities.kinds] };
  }

  async analyze(request: ReasoningRequest): Promise<ReasoningOutcome> {
    if (this.connected === null) {
      return {
        status: 'UNAVAILABLE',
        reason: `BYO provider ${JSON.stringify(this.registration.provider_id)} is NOT_YET_CONNECTED — no fabricated availability; the managed default serves the request instead`,
      };
    }
    const outcome = await this.connected.analyze(request);
    if (outcome.status === 'UNAVAILABLE') {
      return outcome;
    }
    // Re-badge the connected implementation's output onto the slot's
    // registered BYO identity (provenance keeps the slot's runtime id).
    const analysis = createNonAuthoritativeAnalysis({
      kind: outcome.analysis.kind,
      input_digest: reasoningInputDigest(request.input),
      provider_id: this.registration.provider_id,
      provider_kind: 'byo',
      model: this.registration.model,
      version: this.registration.version,
      routing_decision_id: outcome.analysis.provenance.routing_decision_id,
      simulated: outcome.analysis.simulated,
      content: outcome.analysis.content,
    });
    return { status: 'ANALYZED', analysis };
  }
}
