/**
 * Pipeline-level tests: the golden end-to-end run — every stage succeeded,
 * the trace chain is complete and queryable (Mission -> SystemState), the
 * summary is coherent, and the whole result is byte-identical across runs
 * (canonical serialization).
 */

import { describe, expect, it } from 'vitest';
import { canonicalSerialize, TraceLinkStore } from '@sos-2/semantic-spine';
import {
  assertTraceChainComplete,
  checkTraceChain,
  directedPath,
  runGreenfieldPipeline,
} from '../src/index.js';
import { buildPipelineInput } from './helpers.js';

describe('the golden greenfield pipeline run', () => {
  const result = runGreenfieldPipeline(buildPipelineInput());

  it('runs every stage and reports ok', () => {
    expect(result.ok).toBe(true);
    expect(result.stages.mission.stage).toBe('MISSION_FORMALIZATION');
    expect(result.stages.candidate.stage).toBe('CANDIDATE_COMPOSITION');
    expect(result.stages.decision.stage).toBe('HUMAN_DECISION_FLOW');
    expect(result.stages.realization.stage).toBe('REALIZATION');
    expect(result.stages.reconciliation.stage).toBe('RECONCILIATION');
    expect(result.stages.evidence.stage).toBe('EVIDENCE_INGESTION');
  });

  it('converges on System State from mission-only onboarding (R6)', () => {
    expect(result.summary.mission_id).toMatch(/^sos:\/\/Mission\//);
    expect(result.summary.realization.system_state_id).toMatch(/^sos:\/\/SystemState\//);
    expect(result.summary.decision.action).toBe('ACT');
    expect(result.summary.decision.approved).toBe(true);
    expect(result.summary.reconciliation.clean).toBe(true);
    expect(result.summary.evidence.availability.SUCCESS).toBe(2);
    expect(result.summary.evidence.availability.UNAVAILABLE).toBe(1);
  });

  it('the trace chain is complete: one connected Mission -> SystemState subgraph', () => {
    expect(result.trace_chain.ok).toBe(true);
    // The directed traceability path from the realized state back to the mission.
    expect(result.trace.path_state_to_mission).toEqual([
      result.summary.realization.system_state_id,
      result.summary.candidate_id,
      result.summary.mission_id,
    ]);
    // Every pipeline artifact is in the chain's artifact set.
    for (const id of result.trace.artifacts) {
      const check = checkTraceChain({
        artifacts: [id],
        links: result.trace.links,
        mission_id: result.summary.mission_id,
        system_state_id: result.summary.realization.system_state_id,
      });
      // The artifact is linked and connected (only the directed-path check
      // repeats, which trivially holds for the full chain).
      expect(check.unlinked_artifacts).toEqual([]);
      expect(check.disconnected_artifacts).toEqual([]);
    }
  });

  it('every trace link is spine-valid and loadable into a spine store', () => {
    const store = new TraceLinkStore();
    for (const link of result.trace.links) {
      expect(() => store.add(link)).not.toThrow();
    }
    expect(store.size).toBe(result.trace.links.length);
  });

  it('the trace links carry the frozen handoff types (SATISFIES/COMPOSES/SUPPORTS/REALIZES/IMPLEMENTS/OBSERVES)', () => {
    const types = new Set(result.trace.links.map((link) => link.type));
    for (const expected of ['SATISFIES', 'COMPOSES', 'SUPPORTS', 'REALIZES', 'IMPLEMENTS', 'OBSERVES']) {
      expect(types.has(expected as never)).toBe(true);
    }
  });

  it('is byte-identical across runs (canonical serialization determinism)', () => {
    const first = runGreenfieldPipeline(buildPipelineInput());
    const second = runGreenfieldPipeline(buildPipelineInput());
    expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));
    expect(canonicalSerialize(first)).toBe(canonicalSerialize(result));
  });

  it('the ASK path also completes the chain (escalate -> resolve -> realize)', () => {
    const askResult = runGreenfieldPipeline(
      buildPipelineInput({
        grants: [],
        decider: { resolved_by: 'w14-test-architect', chosen_alternative_id: null, note: 'approved for realization' },
      }),
    );
    expect(askResult.summary.decision.action).toBe('ASK');
    expect(askResult.summary.decision.approved).toBe(true);
    expect(askResult.summary.decision.ask_id).toMatch(/^sos:\/\/AskRequest\//);
    expect(askResult.summary.decision.resolution_id).toMatch(/^sos:\/\/Decision\//);
    expect(askResult.trace_chain.ok).toBe(true);
    // The ask + resolution artifacts are part of the connected chain.
    expect(askResult.trace.artifacts).toContain(askResult.summary.decision.ask_id);
    expect(askResult.trace.artifacts).toContain(askResult.summary.decision.resolution_id);
    // And the realized state traces back to the mission through the candidate.
    expect(askResult.trace.path_state_to_mission).toEqual([
      askResult.summary.realization.system_state_id,
      askResult.summary.candidate_id,
      askResult.summary.mission_id,
    ]);
  });
});

describe('trace chain queries', () => {
  const result = runGreenfieldPipeline(buildPipelineInput());

  it('directedPath walks link directions only', () => {
    const missionId = result.summary.mission_id;
    const stateId = result.summary.realization.system_state_id;
    expect(directedPath(result.trace.links, stateId, missionId)).not.toBeNull();
    // The reverse direction does not exist (links point from realization
    // back to authority, not forward).
    expect(directedPath(result.trace.links, missionId, stateId)).toBeNull();
  });

  it('assertTraceChainComplete passes on the golden chain', () => {
    expect(() =>
      assertTraceChainComplete({
        artifacts: result.trace.artifacts,
        links: result.trace.links,
        mission_id: result.summary.mission_id,
        system_state_id: result.summary.realization.system_state_id,
      }),
    ).not.toThrow();
  });
});
