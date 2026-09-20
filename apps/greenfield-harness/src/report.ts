/**
 * The harness summary report — the deterministic, human-readable projection
 * of the pipeline result: mission -> candidate -> decision -> realization
 * -> reconciliation -> evidence + the trace chain + the final verdict.
 * Pure string formatting over the result (zero domain logic).
 */

import type { GreenfieldPipelineResult } from '@sos-2/greenfield';

/** Render the full summary report of a pipeline result. */
export function renderSummaryReport(result: GreenfieldPipelineResult): string {
  const s = result.summary;
  const lines: string[] = [];

  lines.push('================================================================');
  lines.push('SOS 2.0 — W14 GREENFIELD SYSTEM REALIZATION — HARNESS REPORT');
  lines.push('================================================================');
  lines.push(`run provenance     : ${result.run.provenance.join(', ')}`);
  lines.push(`mission instant    : ${result.run.t_mission}`);
  lines.push(`evidence instant   : ${result.run.t_evidence}`);
  lines.push('');

  lines.push('--- 1. MISSION FORMALIZATION (@sos-2/mission) -------------------');
  lines.push(`mission id         : ${s.mission_id}`);
  lines.push(`purpose            : ${result.stages.mission.mission.content.purpose}`);
  lines.push(`capability         : ${s.capability}`);
  lines.push(
    `goals              : ${String(s.goals.total)} total (${String(s.goals.measurable)} MEASURABLE, ${String(s.goals.proposed)} PROPOSED)`,
  );
  lines.push(
    `measures           : ${String(result.stages.mission.mission.content.measures.length)} (${result.stages.mission.mission.content.measures.map((measure) => measure.id).join(', ')})`,
  );
  lines.push(
    `hard constraints   : ${String(result.stages.candidate.constraints.constraints.length)} (${String(result.stages.candidate.constraints.machine_checkable.length)} machine-checkable)`,
  );
  lines.push('');

  lines.push('--- 2. CANDIDATE COMPOSITION (@sos-2/search + composition) -------');
  lines.push(`search engine      : ${result.stages.candidate.search.engine}`);
  lines.push(`final altitude     : ${s.candidate_altitude} (the highest validated rung)`);
  lines.push(
    `ladder             : ${result.stages.candidate.search.ladder.map((step) => `${step.altitude}:${step.outcome}`).join(' -> ')}`,
  );
  lines.push(`candidate id       : ${s.candidate_id}`);
  lines.push(`family             : ${s.candidate_family} (diversity preserved)`);
  lines.push(
    `members            : ${String(s.members)} (${result.stages.candidate.members.map((member) => member.role).join(', ')})`,
  );
  lines.push(`own evidence owed  : ${String(s.own_evidence_obligations)} obligation(s) (member evidence never substitutes)`);
  lines.push('');

  lines.push('--- 3. HUMAN DECISION FLOW (@sos-2/decision + ask) --------------');
  lines.push(`decision action    : ${s.decision.action}`);
  lines.push(`approved           : ${String(s.decision.approved)}`);
  lines.push(`input digest       : ${s.decision.input_digest}`);
  lines.push(`decision record    : ${result.stages.decision.record.envelope.id}`);
  if (s.decision.ask_id !== null) {
    lines.push(`ask request        : ${s.decision.ask_id}`);
  }
  if (s.decision.resolution_id !== null) {
    lines.push(`resolved by        : ${s.decision.resolution_id}`);
  }
  lines.push(
    `rule trace         : ${result.stages.decision.record.content.rule_trace.map((entry) => `${entry.rule}:${entry.outcome ?? '-'}`).join(' -> ')}`,
  );
  lines.push('');

  lines.push('--- 4. REALIZATION (@sos-2/system-state + architecture) ----------');
  lines.push(`system state       : ${s.realization.system_state_id}`);
  lines.push(`revision chain     : ${String(s.realization.revision_chain_length)} revision(s) (root v1, ACTIVE)`);
  lines.push(`declared graph     : ${s.realization.architecture_graph_id}`);
  lines.push(`implementation     : ${s.realization.implementation_model_id}`);
  lines.push(`exact revision     : ${s.realization.revision}`);
  lines.push(
    `graph shape        : ${String(result.stages.realization.architecture_graph.content.nodes.length)} nodes, ${String(result.stages.realization.architecture_graph.content.edges.length)} edges`,
  );
  lines.push('');

  lines.push('--- 5. RECONCILIATION (@sos-2/conformance) ----------------------');
  lines.push(`records            : ${String(s.reconciliation.records)} (${s.reconciliation.clean ? 'CLEAN — no drift, no contradiction' : `DRIFT: ${String(s.reconciliation.drift)} finding(s)`})`);
  const counts = result.stages.reconciliation.classification_counts;
  lines.push(
    `classifications    : ${Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([classification, count]) => `${classification}=${String(count)}`)
      .join(', ')}`,
  );
  lines.push('');

  lines.push('--- 6. EVIDENCE INGESTION (@sos-2/evidence) ---------------------');
  lines.push(`records            : ${String(s.evidence.records)} (OBSERVES-linked to the system state)`);
  const availability = s.evidence.availability;
  lines.push(
    `availability       : SUCCESS=${String(availability.SUCCESS)} FAILURE=${String(availability.FAILURE)} UNKNOWN=${String(availability.UNKNOWN)} UNAVAILABLE=${String(availability.UNAVAILABLE)} UNSUPPORTED=${String(availability.UNSUPPORTED)} PARTIAL=${String(availability.PARTIAL)}`,
  );
  const freshness = result.stages.evidence.freshness;
  lines.push(
    `freshness          : ${freshness.map((entry) => entry.status).join(', ')} (at ${result.run.t_evidence})`,
  );
  lines.push('');

  lines.push('--- TRACE CHAIN (Mission -> SystemState) ------------------------');
  lines.push(`links              : ${String(s.trace.links)} (${s.trace.artifacts} artifacts)`);
  lines.push(`state -> mission   : ${s.trace.path_state_to_mission.join('\n                       <- ')}`);
  lines.push(`chain complete     : ${String(result.trace_chain.ok)}`);
  lines.push('');

  lines.push('================================================================');
  lines.push(
    result.trace_chain.ok
      ? 'VERDICT: GREENFIELD REALIZATION COMPLETE — every stage succeeded and the trace chain is complete.'
      : 'VERDICT: INCOMPLETE — the trace chain is broken.',
  );
  lines.push('================================================================');
  return lines.join('\n');
}

/** Render the failure report (the exit-nonzero path). */
export function renderFailureReport(error: unknown): string {
  const lines: string[] = [];
  lines.push('================================================================');
  lines.push('SOS 2.0 — W14 GREENFIELD SYSTEM REALIZATION — HARNESS FAILURE');
  lines.push('================================================================');
  lines.push(`error              : ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error && error.cause instanceof Error) {
    lines.push(`cause              : ${error.cause.message}`);
  }
  lines.push('');
  lines.push('The pipeline did NOT complete: a stage failed, a stage handoff was');
  lines.push('broken, or the Mission -> SystemState trace chain is incomplete.');
  lines.push('Exit code: 1 (no realization is reported as complete).');
  lines.push('================================================================');
  return lines.join('\n');
}
