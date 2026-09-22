/**
 * THE DEMO JOURNEY (Work Order P6) — a deterministic three-lane
 * end-to-end run of the Spirit Orchestrator:
 *
 *   mission -> decomposition (managed default reasoning, zero BYO) ->
 *   3 concurrent lanes on DISJOINT owned-path scopes -> crash + recovery
 *   of one lane (EXPLICIT deterministic simulated crash injection) ->
 *   verification-gated completion (no self-approval) -> architect-gated
 *   mission completion -> HONEST REPORT (explicit simulated markers).
 *
 * The demo runs on a ManualClock at a fixed instant and a bounded finite
 * tick source — byte-reproducible, never presented as live state (the
 * productization rule: demo state is explicitly DEMO/SIMULATED).
 */

import type { OrchestratorHost } from './composition.js';
import { demoManualClock, createOrchestratorHost } from './composition.js';
import { FiniteTickSource } from './tick-source.js';
import type { JourneyReport } from '@sos-2/orchestrator';

/** The demo mission (three goals -> three concurrent lanes on disjoint scopes). */
export const DEMO_MISSION = {
  purpose: 'Ship the resilient checkout experience end to end',
  goals: [
    { id: 'goal-payment-review', statement: 'Implement payment review' },
    { id: 'goal-validation', statement: 'Harden input validation' },
    { id: 'goal-docs', statement: 'Document the checkout flow' },
  ],
} as const;

/**
 * Run the deterministic demo journey on a FRESH host (pure — the caller
 * supplies the clock through the composition; this function never reads
 * ambient anything).
 */
export async function runDemoJourney(): Promise<{ host: OrchestratorHost; report: JourneyReport }> {
  const host = createOrchestratorHost({ clock: demoManualClock(), mission: DEMO_MISSION });
  // Durable truth BEFORE the journey: the mission and authority grant are
  // stored (every task will carry both references — pinned).
  await host.store.authorityGrants.put(host.grant);
  await host.store.missions.put(host.mission);

  // 1. MISSION-AWARE DECOMPOSITION (the managed default reasoning
  //    provider serves — ZERO bring-your-own providers are configured).
  const decomposition = await host.orchestrator.decomposeMission({
    mission: host.mission,
    authority_ref: host.grant.envelope.id,
  });

  // 2.-4. THE CONTROL LOOP on the injected tick source (finite — no
  //    ambient timers): three concurrent lanes, a deterministic simulated
  //    crash on the SECOND lane (before its post-checkpoint step),
  //    verification-gated completions and the honest recovery.
  const tickSource = new FiniteTickSource(24);
  for (;;) {
    const nodes = await host.graph.nodes();
    const active = nodes.filter((node) => node.state === 'PENDING' || node.state === 'RUNNING' || node.state === 'FAILED');
    if (active.length === 0) {
      break; // the journey reached its fixed point
    }
    if (!tickSource.next()) {
      break; // the finite tick source drained — the honest bound
    }
    await host.orchestrator.tick({ crashes: { 1: 3 } });
  }

  // 5. ARCHITECT-GATED MISSION COMPLETION (the governed control function).
  const report = await host.orchestrator.completeMission({
    mission_ref: host.mission.envelope.id,
    authority_ref: host.grant.envelope.id,
    rationale: `every task of decomposition ${decomposition.decomposition_id} is verification-gated COMPLETED under stored authority ${host.grant.envelope.id}`,
  });
  return { host, report };
}

/** Render the honest journey report as deterministic text (the demo output). */
export function renderDemoReport(report: JourneyReport): string {
  const lines: string[] = [];
  lines.push('=== SOS 2.0 Spirit Orchestrator — deterministic three-lane demo journey ===');
  lines.push(`mission: ${report.mission_ref}`);
  lines.push(`authority: ${report.authority_ref}`);
  lines.push(`decomposition: ${report.decomposition_id}`);
  lines.push(`ticks: ${report.ticks.length}`);
  for (const tick of report.ticks) {
    lines.push(
      `  tick ${tick.tick}: dispatched [${tick.dispatched.map((dispatch) => `${dispatch.task_id}->lane${dispatch.lane}(${dispatch.body_id})`).join(', ')}]` +
        (tick.denials.length > 0 ? ` denials [${tick.denials.map((denial) => `${denial.task_id}:${denial.code}`).join(', ')}]` : '') +
        (tick.recovered.length > 0 ? ` recovered [${tick.recovered.join(', ')}]` : '') +
        ` ingested [${tick.ingested.map((ingested) => `${ingested.task_id}:${ingested.outcome.kind}`).join(', ')}]`,
    );
  }
  lines.push('tasks:');
  for (const task of report.tasks) {
    lines.push(
      `  ${task.task_id} [${task.state}] retries=${task.retries} verification=${task.verification_ref ?? '-'} revision=${task.workspace_revision.source_revision ?? '-'} uncertainty=${task.uncertainty.length}`,
    );
  }
  lines.push(`asks escalated: ${report.asks.length}`);
  lines.push(
    `architect gate: ${report.gate === null ? 'not requested' : `${report.gate.gate_id} ${report.gate.decision} (${report.gate.transition}) under ${report.gate.authority_ref}`}`,
  );
  lines.push(
    `reasoning: ${report.reasoning === null ? 'none' : `${report.reasoning.provider_kind}:${report.reasoning.provider_id} model=${report.reasoning.model} v${report.reasoning.version} simulated=${report.reasoning.simulated} non_authoritative=${report.reasoning.non_authoritative}`}`,
  );
  lines.push('simulated markers (explicit — demo state, never live):');
  for (const marker of report.simulated_markers) {
    lines.push(`  - ${marker}`);
  }
  lines.push(`completed: ${report.completed}`);
  lines.push(`summary: ${report.summary}`);
  return lines.join('\n');
}
