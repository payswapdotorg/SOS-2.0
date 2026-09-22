/**
 * THE DEFAULT MANAGED REFERENCE REASONING PROVIDER (Work Order P6).
 *
 * spec/productization-execution-architecture.md §8: "Users do not have
 * to bring an LLM just to use SOS. Product behavior: default: SOS-managed
 * reasoning provider."
 *
 * This provider is ALWAYS PRESENT inside the broker with ZERO user
 * configuration (pinned by tests: a journey completes with no BYO
 * provider configured). It is a DETERMINISTIC REFERENCE implementation:
 *
 *   - SIMULATED, with the explicit simulated marker on every output
 *     (the P8 reference-body precedent — simulation is evaluation
 *     infrastructure, never evidence, never authority);
 *   - fully deterministic: the analysis content is a pure function of
 *     the request input (canonical serialization digests, no hidden
 *     state, no randomness, no network);
 *   - serves every request kind, unmetered (cost null), with a generous
 *     context ceiling.
 *
 * Real managed reasoning attaches later behind the same port without
 * contract change.
 */

import type { JsonValue } from '@sos-2/semantic-spine';
import { createNonAuthoritativeAnalysis } from '../analysis.js';
import { reasoningInputDigest } from '../analysis.js';
import type { NonAuthoritativeAnalysis } from '../analysis.js';
import type { ReasoningCapabilities, ReasoningOutcome, ReasoningProviderIdentity, ReasoningProviderPort, ReasoningRequest } from '../port.js';

/** The managed provider's stable runtime identity (provenance metadata only). */
export const MANAGED_PROVIDER_ID = 'managed-reasoning-default';
export const MANAGED_PROVIDER_MODEL = 'sos-managed-reference-reasoner';
export const MANAGED_PROVIDER_VERSION = '1.0.0';

/**
 * The deterministic decomposition analysis content: reads the mission
 * view from the request input and proposes work items. The content is
 * explicitly labeled simulated and non-authoritative — the authoritative
 * task graph is built by DETERMINISTIC CODE in the orchestrator, which
 * consumes this only as input.
 */
function decompositionContent(request: ReasoningRequest): JsonValue {
  const input = request.input as { purpose?: unknown; goals?: unknown };
  const goals = Array.isArray(input?.goals) ? (input?.goals as { id?: unknown; statement?: unknown }[]) : [];
  const proposed = goals.map((goal, index) => ({
    proposal_id: `proposal-${String(index + 1).padStart(2, '0')}`,
    goal_id: typeof goal.id === 'string' ? goal.id : null,
    suggested_title: typeof goal.statement === 'string' ? `Advance goal: ${goal.statement}` : `Advance mission work item ${index + 1}`,
    suggested_scope: `lane-${String(index + 1).padStart(2, '0')}`,
    rationale: 'deterministic reference proposal from the mission goal list (simulated, non-authoritative input)',
  }));
  return {
    simulated: true,
    non_authoritative: true,
    mission_ref: request.context.mission_ref,
    purpose: typeof input?.purpose === 'string' ? input.purpose : null,
    proposed_work_items: proposed,
    note: 'reference managed provider: deterministic simulated analysis — informs decomposition, never authoritative',
  };
}

/** Deterministic planning analysis content. */
function planningContent(request: ReasoningRequest): JsonValue {
  return {
    simulated: true,
    non_authoritative: true,
    mission_ref: request.context.mission_ref,
    input_digest: reasoningInputDigest(request.input),
    ordering: 'dependencies-before-dependents',
    note: 'reference managed provider: deterministic simulated planning analysis — informs the plan, never authoritative',
  };
}

/** Deterministic summary analysis content. */
function summaryContent(request: ReasoningRequest): JsonValue {
  const input = request.input as { tasks?: unknown };
  const tasks = Array.isArray(input?.tasks) ? (input?.tasks as unknown[]).length : 0;
  return {
    simulated: true,
    non_authoritative: true,
    mission_ref: request.context.mission_ref,
    summarized_items: tasks,
    note: 'reference managed provider: deterministic simulated summary — informative only, never authoritative',
  };
}

/**
 * THE MANAGED DEFAULT PROVIDER — always present, zero configuration,
 * deterministic, simulated with explicit markers.
 */
export class ManagedReferenceReasoningProvider implements ReasoningProviderPort {
  private readonly identityValue: ReasoningProviderIdentity = {
    provider_id: MANAGED_PROVIDER_ID,
    provider_kind: 'managed',
    model: MANAGED_PROVIDER_MODEL,
    version: MANAGED_PROVIDER_VERSION,
    status: 'AVAILABLE',
    simulated: true,
  };

  private readonly capabilitiesValue: ReasoningCapabilities = {
    kinds: ['decomposition', 'planning', 'summary'],
    max_context_bytes: 1_000_000,
    cost_per_request_usd: null,
  };

  identity(): ReasoningProviderIdentity {
    return { ...this.identityValue };
  }

  capabilities(): ReasoningCapabilities {
    return { ...this.capabilitiesValue, kinds: [...this.capabilitiesValue.kinds] };
  }

  async analyze(request: ReasoningRequest): Promise<ReasoningOutcome> {
    const inputDigest = reasoningInputDigest(request.input);
    const content =
      request.kind === 'decomposition'
        ? decompositionContent(request)
        : request.kind === 'planning'
          ? planningContent(request)
          : summaryContent(request);
    const analysis: NonAuthoritativeAnalysis = createNonAuthoritativeAnalysis({
      kind: request.kind,
      input_digest: inputDigest,
      provider_id: this.identityValue.provider_id,
      provider_kind: 'managed',
      model: this.identityValue.model,
      version: this.identityValue.version,
      routing_decision_id: '', // stamped by the broker before emission
      simulated: true,
      content,
    });
    return { status: 'ANALYZED', analysis };
  }
}
