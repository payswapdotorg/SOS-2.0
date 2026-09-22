/**
 * ACCEPTANCE SUITE 4 — MANAGED DEFAULT (Work Order P6, pinned).
 *
 * "user does not need to connect a personal LLM to start": a full
 * journey completes with ZERO bring-your-own providers configured; a
 * registered-but-NOT_YET_CONNECTED BYO slot never fabricates
 * availability and never blocks the journey.
 */

import { describe, expect, it } from 'vitest';
import { createAcceptanceWorld, runJourney, startJourney } from './acceptance-world.js';

describe('P6 acceptance: the managed default (zero BYO required)', () => {
  it('a complete three-lane journey runs with ZERO BYO providers configured', async () => {
    const world = createAcceptanceWorld();
    expect(world.reasoning.providers()).toHaveLength(1);
    expect(world.reasoning.providers()[0]!.provider_kind).toBe('managed');
    expect(world.reasoning.providers()[0]!.status).toBe('AVAILABLE');
    await startJourney(world);
    const report = await runJourney(world);
    expect(report.completed).toBe(true);
    expect(report.reasoning!.provider_kind).toBe('managed');
    expect(report.reasoning!.provider_id).toBe('managed-reasoning-default');
    // The journey's provenance records the managed provider — no BYO anywhere.
    expect(report.reasoning!.simulated).toBe(true);
    expect(report.reasoning!.non_authoritative).toBe(true);
  });

  it('a registered-but-NOT_CONNECTED BYO slot is honestly ineligible and the journey still completes', async () => {
    const world = createAcceptanceWorld();
    world.reasoning.registerByo({
      provider_id: 'byo-user-llm',
      model: 'personal-model',
      version: '9.9.9',
      capabilities: { kinds: ['decomposition', 'planning', 'summary'], max_context_bytes: 100_000, cost_per_request_usd: null },
    });
    const providers = world.reasoning.providers();
    expect(providers).toHaveLength(2);
    const byo = providers.find((provider) => provider.provider_id === 'byo-user-llm')!;
    expect(byo.status).toBe('NOT_YET_CONNECTED');
    await startJourney(world);
    const decisions = world.reasoning.routingDecisions();
    const consideration = decisions[0]!.considered.find((entry) => entry.provider_id === 'byo-user-llm')!;
    expect(consideration.eligible).toBe(false);
    expect(consideration.reason).toContain('NOT_YET_CONNECTED');
    const report = await runJourney(world);
    expect(report.completed).toBe(true);
    expect(report.reasoning!.provider_kind).toBe('managed');
  });

  it('the managed default serves EVERY request kind with no configuration surface', async () => {
    const world = createAcceptanceWorld();
    for (const kind of ['decomposition', 'planning', 'summary'] as const) {
      const brokered = await world.reasoning.analyze({
        kind,
        input: { purpose: 'x', goals: [] },
        context: { mission_ref: null, max_cost_usd: null },
      });
      expect(brokered.analysis.kind).toBe(kind);
      expect(brokered.analysis.provenance.provider_id).toBe('managed-reasoning-default');
    }
  });
});
