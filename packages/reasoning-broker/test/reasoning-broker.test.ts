/**
 * @sos-2/reasoning-broker contract tests (Work Order P6).
 *
 * Pins:
 *  - the MANAGED DEFAULT is always present with zero configuration and
 *    serves every kind (a journey needs NO personal LLM);
 *  - BYO slots are honestly NOT_YET_CONNECTED until connected — no
 *    fabricated availability, routing marks them ineligible;
 *  - routing is capability/cost/context driven, typed and recorded;
 *  - every output carries provider identity + model + version + the
 *    routing decision (provenance discipline);
 *  - ALL output is NonAuthoritativeAnalysis with the structural marker —
 *    output without non_authoritative:true is a typed violation;
 *  - determinism: identical request -> identical routing + analysis ids.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@sos-2/live-store';
import {
  InvalidReasoningInputError,
  MANAGED_PROVIDER_ID,
  ReasoningBroker,
  ReasoningError,
  assertValidNonAuthoritativeAnalysis,
} from '../src/index.js';
import type { ReasoningProviderPort, ReasoningRequest } from '../src/index.js';

const MISSION_VIEW = {
  purpose: 'Ship the checkout mission',
  goals: [
    { id: 'goal-a', statement: 'Implement payment review' },
    { id: 'goal-b', statement: 'Harden validation' },
    { id: 'goal-c', statement: 'Document the flow' },
  ],
};

function request(kind: ReasoningRequest['kind'] = 'decomposition'): ReasoningRequest {
  return { kind, input: MISSION_VIEW, context: { mission_ref: 'sos://Mission/0123456789abcdef0123456789abcdef', max_cost_usd: null } };
}

function broker() {
  return new ReasoningBroker({ clock: new ManualClock(Date.parse('2026-02-01T10:00:00Z')) });
}

describe('the managed default provider (always present, zero configuration)', () => {
  it('serves every request kind with ZERO BYO providers configured', async () => {
    const reasoning = broker();
    expect(reasoning.providers()).toHaveLength(1);
    expect(reasoning.providers()[0]!.provider_id).toBe(MANAGED_PROVIDER_ID);
    expect(reasoning.providers()[0]!.status).toBe('AVAILABLE');
    for (const kind of ['decomposition', 'planning', 'summary'] as const) {
      const brokered = await reasoning.analyze(request(kind));
      expect(brokered.routing.selected_provider_kind).toBe('managed');
      expect(brokered.analysis.provenance.provider_kind).toBe('managed');
      expect(brokered.analysis.non_authoritative).toBe(true);
      expect(brokered.analysis.simulated).toBe(true);
    }
  });

  it('produces deterministic work-item proposals from the mission view', async () => {
    const reasoning = broker();
    const first = await reasoning.analyze(request('decomposition'));
    const second = await reasoning.analyze(request('decomposition'));
    expect(first.analysis.analysis_id).toBe(second.analysis.analysis_id);
    expect(first.routing.routing_id).toBe(second.routing.routing_id);
    const proposed = (first.analysis.content as { proposed_work_items: { proposal_id: string; goal_id: string }[] }).proposed_work_items;
    expect(proposed).toHaveLength(3);
    expect(proposed[0]!.goal_id).toBe('goal-a');
  });
});

describe('BYO slots (honest NOT_YET_CONNECTED)', () => {
  it('registers a slot that is honestly NOT_YET_CONNECTED and ineligible for routing', async () => {
    const reasoning = broker();
    reasoning.registerByo({
      provider_id: 'byo-personal-llm',
      model: 'personal-model',
      version: '1.2.3',
      capabilities: { kinds: ['decomposition'], max_context_bytes: 100_000, cost_per_request_usd: 0.02 },
    });
    expect(reasoning.providers()).toHaveLength(2);
    const byo = reasoning.providers().find((provider) => provider.provider_id === 'byo-personal-llm')!;
    expect(byo.status).toBe('NOT_YET_CONNECTED');
    // Routing honestly considers and rejects the unconnected slot.
    const brokered = await reasoning.analyze(request('decomposition'));
    const consideration = brokered.routing.considered.find((entry) => entry.provider_id === 'byo-personal-llm')!;
    expect(consideration.eligible).toBe(false);
    expect(consideration.reason).toContain('NOT_YET_CONNECTED');
    expect(brokered.routing.selected_provider_kind).toBe('managed');
  });

  it('prefers a CONNECTED BYO provider when capable (routing is recorded)', async () => {
    const reasoning = broker();
    reasoning.registerByo({
      provider_id: 'byo-personal-llm',
      model: 'personal-model',
      version: '1.2.3',
      capabilities: { kinds: ['decomposition'], max_context_bytes: 100_000, cost_per_request_usd: 0.02 },
    });
    reasoning.connectByo('byo-personal-llm', connectedProvider());
    const brokered = await reasoning.analyze(request('decomposition'));
    expect(brokered.routing.selected_provider_id).toBe('byo-personal-llm');
    expect(brokered.routing.selected_provider_kind).toBe('byo');
    expect(brokered.analysis.provenance.provider_id).toBe('byo-personal-llm');
    expect(brokered.analysis.provenance.model).toBe('personal-model');
    expect(brokered.analysis.provenance.routing_decision_id).toBe(brokered.routing.routing_id);
  });

  it('refuses duplicate provider ids and reserved ids', () => {
    const reasoning = broker();
    const input = {
      provider_id: 'byo-personal-llm',
      model: 'm',
      version: '1',
      capabilities: { kinds: ['decomposition'] as ('decomposition')[], max_context_bytes: 1000, cost_per_request_usd: null },
    };
    reasoning.registerByo(input);
    expect(() => reasoning.registerByo(input)).toThrow(ReasoningError);
    expect(() =>
      reasoning.registerByo({ ...input, provider_id: MANAGED_PROVIDER_ID }),
    ).toThrow(/reserved/);
  });
});

describe('routing discipline (capability/cost/context)', () => {
  it('marks a cost-exceeding BYO provider ineligible', async () => {
    const reasoning = broker();
    reasoning.registerByo({
      provider_id: 'byo-expensive',
      model: 'expensive-model',
      version: '1',
      capabilities: { kinds: ['decomposition'], max_context_bytes: 1_000_000, cost_per_request_usd: 5 },
    });
    // The connected implementation honestly declares its own expensive cost.
    reasoning.connectByo('byo-expensive', {
      identity: () => ({
        provider_id: 'byo-expensive',
        provider_kind: 'byo',
        model: 'expensive-model',
        version: '1',
        status: 'AVAILABLE',
        simulated: true,
      }),
      capabilities: () => ({ kinds: ['decomposition'], max_context_bytes: 1_000_000, cost_per_request_usd: 5 }),
      analyze: async (req) => {
        const { createNonAuthoritativeAnalysis, reasoningInputDigest } = await import('../src/index.js');
        return {
          status: 'ANALYZED',
          analysis: createNonAuthoritativeAnalysis({
            kind: req.kind,
            input_digest: reasoningInputDigest(req.input),
            provider_id: 'byo-expensive',
            provider_kind: 'byo',
            model: 'expensive-model',
            version: '1',
            routing_decision_id: '',
            simulated: true,
            content: { simulated: true, non_authoritative: true },
          }),
        };
      },
    });
    const brokered = await reasoning.analyze({ ...request('decomposition'), context: { mission_ref: null, max_cost_usd: 1 } });
    expect(brokered.routing.selected_provider_kind).toBe('managed');
    const consideration = brokered.routing.considered.find((entry) => entry.provider_id === 'byo-expensive')!;
    expect(consideration.eligible).toBe(false);
    expect(consideration.reason).toContain('cost');
  });
});

describe('provenance + non-authoritative discipline', () => {
  it('every output validates against the structural guard', async () => {
    const reasoning = broker();
    const brokered = await reasoning.analyze(request('summary'));
    expect(() => assertValidNonAuthoritativeAnalysis(brokered.analysis)).not.toThrow();
    expect(brokered.analysis.analysis_id.startsWith('ra:')).toBe(true);
    expect(brokered.routing.routing_id.startsWith('route:')).toBe(true);
  });

  it('output without the structural marker is a typed violation naming the rule', () => {
    const analysis = {
      analysis_id: 'ra:abc',
      kind: 'summary',
      input_digest: '0'.repeat(64),
      content: {},
      provenance: { provider_id: 'x', provider_kind: 'managed', model: 'm', version: '1', routing_decision_id: 'route:x', simulated: true },
      non_authoritative: false,
      simulated: true,
    };
    expect(() => assertValidNonAuthoritativeAnalysis(analysis)).toThrow(/non_authoritative|non-authoritative/);
  });

  it('malformed requests are typed rejections', async () => {
    const reasoning = broker();
    await expect(
      reasoning.analyze({ kind: 'decomposition', input: undefined as never, context: { mission_ref: null, max_cost_usd: null } }),
    ).rejects.toThrow(InvalidReasoningInputError);
  });
});

/** A deterministic connected BYO provider implementation for tests. */
function connectedProvider(): ReasoningProviderPort {
  return {
    identity: () => ({
      provider_id: 'byo-personal-llm',
      provider_kind: 'byo',
      model: 'personal-model',
      version: '1.2.3',
      status: 'AVAILABLE',
      simulated: true,
    }),
    capabilities: () => ({ kinds: ['decomposition', 'planning', 'summary'], max_context_bytes: 100_000, cost_per_request_usd: 0.02 }),
    analyze: async (req) => {
      const { createNonAuthoritativeAnalysis, reasoningInputDigest } = await import('../src/index.js');
      const analysis = createNonAuthoritativeAnalysis({
        kind: req.kind,
        input_digest: reasoningInputDigest(req.input),
        provider_id: 'byo-personal-llm',
        provider_kind: 'byo',
        model: 'personal-model',
        version: '1.2.3',
        routing_decision_id: '',
        simulated: true,
        content: { simulated: true, non_authoritative: true, note: 'byo reference output', kind: req.kind },
      });
      return { status: 'ANALYZED', analysis };
    },
  };
}
