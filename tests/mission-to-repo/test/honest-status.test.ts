/**
 * THE HONEST-STATUS ACCEPTANCE SUITE (Work Order P13) — "Honest
 * statuses: NOT_YET_CONNECTED for real endpoints; UNKNOWN where evidence
 * is absent (no fabricated completion)."
 *
 *   - with the P9 DEFAULT registry (only tests + static-contract-checks
 *     are connected reference probes; every other type is honestly
 *     NOT_YET_CONNECTED), the journey implements and deploys but the
 *     runtime verification is UNKNOWN — completion is REFUSED and a
 *     typed ask is parked;
 *   - the provider statuses carried through the journey state are honest
 *     (reference/simulated markers, never live claims).
 */

import { describe, expect, it } from 'vitest';
import { createAcceptanceWorld, driveOnCloudTicks, startFlagshipJourney } from './world.js';

describe('P13 honest statuses (UNKNOWN, never fabricated)', () => {
  it('the P9 default registry (NOT_YET_CONNECTED probes) yields UNKNOWN runtime verification — completion is refused', async () => {
    const world = createAcceptanceWorld({ defaultEvaluatorRegistry: true });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // The implementation itself proceeded: the connected reference probes
    // (tests + static-contract-checks) gate the nodes honestly.
    expect(state.stage).toBe('DEPLOYED');
    expect(state.deployment).not.toBeNull();
    expect(state.realizedCommits.length).toBeGreaterThan(0);

    // But the runtime verification had NO connected probe: the verdict is
    // UNKNOWN and the journey parks — it never fabricates a pass.
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('COMPLETION');
    expect(state.pendingAsk!.reasonCode).toBe('RUNTIME_VERIFICATION_NOT_PASSED');
    expect(state.pendingAsk!.detail).toContain('UNKNOWN');
    expect(world.journey.completionReport()).toBeNull();
  });

  it('the per-node gates ran against the connected reference probes (implementation is not blocked by absent providers)', async () => {
    const world = createAcceptanceWorld({ defaultEvaluatorRegistry: true });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);

    // The nodes COMPLETED through the connected tests + static checks.
    const nodes = await world.graph.nodes();
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.state).toBe('COMPLETED');
      expect(node.verification_ref).not.toBeNull();
    }
  });

  it('the journey state carries honest provider statuses (reference/simulated markers, never live claims)', async () => {
    const world = createAcceptanceWorld();
    const state = world.journey.state();
    const statuses = state.providerStatuses.map((status) => `${status.name}=${status.status}`).join('\n');
    expect(statuses).toContain('github-adapter (P4 reference provider)=REFERENCE');
    expect(statuses).toContain('git-host (P9 reference executor)=REFERENCE');
    expect(statuses).toContain('deployment-target (P9 reference executor)=REFERENCE');
    expect(statuses).toContain('bodies (P8 reference cloud bodies)=REFERENCE');

    const defaultWorld = createAcceptanceWorld({ defaultEvaluatorRegistry: true });
    const defaultState = defaultWorld.journey.state();
    expect(defaultState.providerStatuses.map((status) => status.status).join(',')).toContain('DEFAULT_REGISTRY');
  });

  it('the completed journey retains reference-mode uncertainty in the report (honest, never dropped)', async () => {
    const world = createAcceptanceWorld();
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const report = world.journey.completionReport()!;
    // The reference-mode limitations are stated as REMAINING uncertainty.
    expect(report.remainingUncertainty.some((entry) => entry.includes('SIMULATED'))).toBe(true);
    expect(report.remainingUncertainty.some((entry) => entry.includes('never a real GitHub connection'))).toBe(true);
    expect(report.providerStatuses.every((status) => status.status === 'REFERENCE')).toBe(true);
  });
});
