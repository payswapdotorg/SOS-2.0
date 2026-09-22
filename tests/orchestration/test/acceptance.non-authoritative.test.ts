/**
 * ACCEPTANCE SUITE 3 — NON-AUTHORITATIVE REASONING (Work Order P6,
 * pinned).
 *
 * "LLM/provider output is non-authoritative": broker output NEVER
 * reaches authority or verification-verdict paths.
 *
 * Structural pins:
 *  - every broker output is a NonAuthoritativeAnalysis carrying the
 *    validated non_authoritative:true marker + full model/version
 *    provenance + the recorded routing decision;
 *  - the verification records' evidence NEVER references broker
 *    analysis ids ('ra:') — presenting one is a TYPED violation naming
 *    the rule;
 *  - the task records' authority contexts NEVER contain broker ids;
 *  - the IndependentVerificationPort's signature structurally cannot
 *    receive broker output (compiled contract — a provider analysis is
 *    not an acceptable input anywhere on the verdict path).
 */

import { describe, expect, it } from 'vitest';
import { SilentBypassViolationError, escalateAsk } from '@sos-2/orchestrator';
import { assertValidNonAuthoritativeAnalysis } from '@sos-2/reasoning-broker';
import { createAcceptanceWorld, runJourney, startJourney } from './acceptance-world.js';

describe('P6 acceptance: broker output is non-authoritative', () => {
  it('every recorded broker output validates with the structural marker + provenance', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    await runJourney(world);
    const analyses = world.reasoning.analyses();
    expect(analyses.length).toBe(1);
    for (const analysis of analyses) {
      expect(() => assertValidNonAuthoritativeAnalysis(analysis)).not.toThrow();
      expect(analysis.non_authoritative).toBe(true);
      expect(analysis.simulated).toBe(true);
      expect(analysis.provenance.model).toBe('sos-managed-reference-reasoner');
      expect(analysis.provenance.version).toBe('1.0.0');
      expect(analysis.provenance.routing_decision_id.startsWith('route:')).toBe(true);
    }
    // The routing decisions are recorded (typed, auditable).
    const decisions = world.reasoning.routingDecisions();
    expect(decisions.length).toBe(1);
    expect(decisions[0]!.selected_provider_kind).toBe('managed');
  });

  it('NO verification record evidence references broker output (scan across the whole journey)', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    const report = await runJourney(world);
    expect(report.completed).toBe(true);
    // Every completed task's verification ref is a 'ver:' id — never an 'ra:' analysis id.
    for (const task of report.tasks) {
      expect(task.verification_ref!.startsWith('ver:')).toBe(true);
    }
    // The durable final verification records never embed broker analyses.
    const listed = await world.store.tasks.list({ limit: null });
    for (const record of listed.items) {
      expect(record.final_verification).not.toBeNull();
      for (const ref of record.final_verification!.evidence_refs) {
        expect(ref.startsWith('ra:')).toBe(false);
      }
      // Authority contexts never contain broker analysis ids either.
      for (const grantRef of record.authority_context.grant_refs) {
        expect(grantRef.startsWith('ra:')).toBe(false);
        expect(grantRef.startsWith('route:')).toBe(false);
      }
    }
    // The broker's own analysis ids are recorded but appear NOWHERE in
    // the durable task store's authority or verification surfaces.
    const analyses = world.reasoning.analyses();
    const analysisIds = new Set(analyses.map((analysis) => analysis.analysis_id));
    for (const record of listed.items) {
      const surfaces = JSON.stringify({
        authority: record.authority_context,
        verification: record.final_verification,
      });
      for (const analysisId of analysisIds) {
        expect(surfaces.includes(analysisId)).toBe(false);
      }
    }
  });

  it('presenting a broker analysis id as verification evidence is a TYPED violation naming the rule', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    const nodes = await world.graph.nodes();
    const node = nodes[0]!;
    const brokered = await world.reasoning.analyze({
      kind: 'summary',
      input: { tasks: 3 },
      context: { mission_ref: world.mission.envelope.id, max_cost_usd: null },
    });
    const forgedResult = {
      task_id: node.task_id,
      worker_id: 'worker-forged',
      status: 'COMPLETED_REPORT' as const,
      evidence_refs: [brokered.analysis.analysis_id],
      workspace_revision: { source_revision: null, deployment_revision: null },
      provenance: { worker_id: 'worker-forged', body_id: null, harness_id: null, reasoning: null },
      uncertainty: [],
      failure: null,
      ask: null,
      resumed_from_checkpoint: null,
      summary: 'attempting to launder broker output as verification evidence',
      steps_executed: 1,
      steps_total: 1,
    };
    let violation: SilentBypassViolationError | null = null;
    try {
      await world.verifier.verify({ task_id: node.task_id, worker_result: forgedResult });
    } catch (cause) {
      violation = cause as SilentBypassViolationError;
    }
    expect(violation).toBeInstanceOf(SilentBypassViolationError);
    expect(violation!.rule).toBe('broker-output-never-verification-evidence');
    expect(violation!.field).toContain('evidence_refs[');
    expect(violation!.message).toContain('non-authoritative');
  });

  it('an analysis WITHOUT the structural marker is a typed provenance violation', () => {
    const analysis = {
      analysis_id: 'ra:abc',
      kind: 'summary' as const,
      input_digest: '0'.repeat(64),
      content: {},
      provenance: { provider_id: 'x', provider_kind: 'managed' as const, model: 'm', version: '1', routing_decision_id: 'route:x', simulated: true },
      non_authoritative: false,
      simulated: true,
    };
    expect(() => assertValidNonAuthoritativeAnalysis(analysis)).toThrow(/non_authoritative|non-authoritative/);
  });

  it('the ask-escalation path consumes decision records + grants, never broker output', async () => {
    const world = createAcceptanceWorld();
    await world.store.authorityGrants.put(world.grant);
    const outcome = escalateAsk(
      {
        task_id: 'task-x',
        mission_ref: world.mission.envelope.id,
        authority_ref: world.grant.envelope.id,
        reason: { code: 'UNCERTAINTY', statement: 'Which target?', basis: 'two candidates, no ranking' },
        grants: [],
        now: '2026-02-01T10:00:00.000Z',
        provenance: ['p6-acceptance:escalation'],
      },
      { queue: world.askQueue },
    );
    expect(outcome.status).toBe('ESCALATED');
    if (outcome.status === 'ESCALATED') {
      expect(outcome.ask_ref.startsWith('sos://AskRequest/')).toBe(true);
      expect(outcome.decision_ref.startsWith('sos://Decision/')).toBe(true);
    }
    // The ask queue holds the first-class entry; nothing broker-shaped entered it.
    expect(world.askQueue.size).toBe(1);
    expect(world.askQueue.pending()[0]!.ask.envelope.kind).toBe('AskRequest');
  });
});
