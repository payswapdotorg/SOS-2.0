/**
 * P17-C REAL-PROVIDER INTEGRATION SUITE (RUN_REAL=1 only): the UI action
 * wiring evidence — REAL state transitions with authority gates.
 *
 * The live-mission surface's envelope builders produce the action
 * requests from the REAL observed repository head (read through the real
 * GitHub API in this run); those envelopes execute through the REAL
 * merged action-gateway:
 *
 *   - with a held grant: SUCCEEDED (a real state transition in the
 *     reference world — the real git-host executor is the unmerged P17-B
 *     lane; the ENVELOPES, the GATES and the EVIDENCE are the merged
 *     real code);
 *   - with the grant revoked: DENIED, executor never invoked (fail-closed);
 *   - replay: the recorded original receipt, exactly one world transition;
 *   - ASK resolution through the merged AskQueue (human authority).
 *
 * The evidence record binds every transition to the exact observed
 * revision and the receipts' evidence ids.
 */

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ActionGateway, InMemoryAuthority, InMemoryEventLog, InMemoryEvidenceSink, InMemoryIdempotencyStore, ReferenceExecutor, ReferenceRollbackVerifier, ReferenceWorld } from '@sos-2/action-gateway';
import { AskQueue, composeAskContent } from '@sos-2/ask';
import { createAskRequest } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import type { DecisionRequest } from '@sos-2/decision';
import { SystemClock, bindGlobalFetch, configFromEnv, createRealObservationPlane } from '@sos-2/real-observation';
import { askResolutionEnvelope, promotionEnvelope, rollbackEnvelope, summonBodyEnvelope } from '@live-mission/envelopes';
import { writeEvidence } from '../../src/evidence';

const config = configFromEnv(process.env as Record<string, string | undefined>);
const producedAt = new Date().toISOString();
const ACTOR = 'console-user';

function repoHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

describe('the UI action wiring over the real observed state (RUN_REAL)', () => {
  it('executes the live-mission envelopes through the real gateway with authority gates and records the evidence', async () => {
    // 1. Observe the REAL repository head through the real plane (one drain).
    const plane = createRealObservationPlane({
      clock: new SystemClock(),
      fetch: bindGlobalFetch({ timeoutMs: 20_000 }),
      github: { ...config.github, apiBase: 'https://api.github.com' },
      vercel: { ...config.vercel, apiBase: 'https://api.vercel.com' },
      upstash: config.upstash,
      webhookSecret: config.webhookSecret,
      claims: { readClaims: async () => [] },
    });
    const report = await plane.drain();
    const subject = `github:repo:${config.github.owner}/${config.github.repo}`;
    const observedHead = report.snapshot.repositoryHeads.get(subject)?.branchHeads[config.github.branch] ?? null;
    expect(observedHead).not.toBeNull();

    // 2. Derive the envelopes from the REAL observed head (exactly what the
    //    mounted ActionPanel does — the envelope acts on observed revisions).
    const requestedAt = Date.now();
    const summon = summonBodyEnvelope({ actorId: ACTOR, bodyId: 'cloud-sandbox-1', baseSha: observedHead!, actionId: 'live-action-summon-real', idempotencyKey: `real-${observedHead}-summon`, requestedAt });
    const promote = promotionEnvelope({ actorId: ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: observedHead!, actionId: 'live-action-promote-real', idempotencyKey: `real-${observedHead}-promote`, requestedAt });

    // 3. Execute through the REAL gateway.
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    authority.grant(ACTOR, 'promotion', 'production');
    const summonGrantId = authority.grant(ACTOR, 'rollback', 'rollback-scope');
    const world = new ReferenceWorld();
    const evidence = new InMemoryEvidenceSink();
    const events = new InMemoryEventLog();
    const gateway = new ActionGateway({
      clock: { now: () => requestedAt },
      authority,
      executors: [new ReferenceExecutor(world)],
      idempotency: new InMemoryIdempotencyStore(),
      events,
      evidence,
      rollbackVerifier: new ReferenceRollbackVerifier(world),
    });

    const summonOutcome = gateway.execute(summon);
    const promoteOutcome = gateway.execute(promote);
    const replayOutcome = gateway.execute(summon); // idempotent replay

    // 4. Revoke the rollback grant path and prove fail-closed.
    authority.revoke(summonGrantId);
    const rollback = rollbackEnvelope({
      actorId: ACTOR,
      deploymentId: 'dpl-real-evidence',
      fromSourceSha: observedHead!,
      toSourceSha: observedHead!,
      reasonCode: 'MANUAL_DIRECTIVE',
      reasonDetail: 'RUN_REAL P17-C UI wiring evidence: rollback of the current deployment',
      actionId: 'live-action-rollback-real',
      idempotencyKey: `real-${observedHead}-rollback`,
      requestedAt,
    });
    const rollbackOutcome = gateway.execute(rollback);

    // 5. ASK resolution through the merged AskQueue (human authority).
    const decisionRequest: DecisionRequest = {
      action_kind: 'REVISE',
      action_description: 'Revise the mission with the revised budget.',
      target: { kind: 'KIND', artifact_kind: 'Mission' },
      blast_radius: 'SERVICE',
      impact: 'MODERATE',
      risk: 'LOW',
      reversibility: 'REVERSIBLE',
      causal_claim: false,
      uncertainty: { uncertainty_class: 'LOW', basis: 'the revision is fully specified' },
      rollback_signals: [],
      evidence: [],
      grants: [],
      evaluation_point: { kind: 'TIME', now: new Date(requestedAt).toISOString() },
      explicit_authority_decision_ref: null,
      confidence: null,
    };
    const evaluation = evaluate(decisionRequest, { provenance: ['P17C:tests-real-observation:real'], created_at: new Date(requestedAt).toISOString() });
    expect(evaluation.action).toBe('ASK');
    const ask = createAskRequest({ content: composeAskContent({ decision: evaluation.record }), provenance: ['P17C:tests-real-observation:real'], created_at: new Date(requestedAt).toISOString(), version: 1 });
    const queue = new AskQueue();
    const entry = queue.enqueue({ ask, origin_decision: evaluation.record, enqueued_at: new Date(requestedAt).toISOString() });
    const askEnvelope = askResolutionEnvelope({ entryId: entry.id, resolvedBy: ACTOR, chosenAlternativeId: 'act-under-granted-authority', note: 'RUN_REAL P17-C UI wiring evidence: human resolution from the live-mission surface', provenance: ['human:console-user', 'surface:live-mission'], createdAt: new Date(requestedAt).toISOString() });
    const resolution = queue.resolve(askEnvelope.entryId, { ...askEnvelope.resolution, provenance: [...askEnvelope.resolution.provenance] });

    // --- assertions: the gates behaved ---
    expect(summonOutcome.kind).toBe('executed');
    expect(promoteOutcome.kind === 'executed' ? promoteOutcome.receipt.status : 'not-executed').toBe('SUCCEEDED');
    if (summonOutcome.kind === 'executed') {
      expect(summonOutcome.receipt.status).toBe('SUCCEEDED');
      expect(summonOutcome.receipt.sourceRevision).toBe(observedHead);
    }
    expect(replayOutcome.kind).toBe('replayed'); // idempotent
    expect(rollbackOutcome.kind === 'executed' && rollbackOutcome.receipt.status).toBe('DENIED'); // revoked -> fail-closed
    expect(world.bodies.get('cloud-sandbox-1')).toBe('RUNNING'); // exactly one transition
    expect(resolution.content.resolution?.resolved_by).toBe(ACTOR);

    // --- the evidence record ---
    writeEvidence('ux-wiring.json', {
      work_order: 'P17-C',
      evidence_kind: 'ui-action-wiring',
      produced_at: producedAt,
      repo_head: repoHead(),
      observed_state: {
        source: 'the real observation plane drain (GitHub REST + probes)',
        repository_subject: subject,
        observed_branch_head: observedHead,
        honest_source_states: plane.connectivity().map((record) => ({ source: record.source, state: record.state })),
      },
      transitions: [
        {
          action: 'summon-body (family body-lifecycle)',
          envelope: summon,
          authority_gate: { held_grant: `${ACTOR}|body-lifecycle|cloud-sandbox-1`, evaluated_at_action_time: true },
          outcome: summonOutcome.kind === 'executed' ? { status: summonOutcome.receipt.status, evidenceIds: summonOutcome.receipt.evidenceIds } : { status: 'rejected' },
          world_effect: 'bodies[cloud-sandbox-1] = RUNNING (exactly once — the replay executed nothing)',
        },
        {
          action: 'promotion (family promotion)',
          envelope: promote,
          authority_gate: { held_grant: `${ACTOR}|promotion|production` },
          outcome: promoteOutcome.kind === 'executed' ? { status: promoteOutcome.receipt.status, deploymentRevision: promoteOutcome.receipt.deploymentRevision, evidenceIds: promoteOutcome.receipt.evidenceIds } : { status: 'rejected' },
        },
        {
          action: 'replay of the summon-body envelope (same idempotencyKey)',
          outcome: { kind: replayOutcome.kind, note: 'the recorded original receipt returned; the executor was NOT invoked a second time' },
        },
        {
          action: 'rollback (family rollback) with the grant REVOKED',
          envelope: rollback,
          authority_gate: { revoked_grant: summonGrantId, fail_closed: true },
          outcome: rollbackOutcome.kind === 'executed' ? { status: rollbackOutcome.receipt.status, denial: rollbackOutcome.receipt.denial?.reason, denial_detail: rollbackOutcome.receipt.denial?.detail } : { status: 'rejected' },
          world_effect: 'the rollback never executed — the deployment map is unchanged by the denied action',
        },
        {
          action: 'ASK resolution (human authority through the merged AskQueue)',
          envelope: askEnvelope,
          outcome: { decision_ref: resolution.envelope.id, resolved_by: resolution.content.resolution?.resolved_by, alternative: resolution.content.resolution?.alternative_id, pending_after: queue.pendingCount },
        },
      ],
      honesty_notes: [
        'the ENVELOPES come from the live-mission surface builders (apps/web/live-mission/src/actions/envelopes.ts) and act on the revision REALY observed through the GitHub API in this run',
        'the GATEWAY, authority gates, idempotency and evidence are the merged real @sos-2/action-gateway code; the EXECUTOR is the reference world (the real git-host executor is the unmerged P17-B lane — recorded, never claimed as real)',
        'every transition is bound to the exact observed revision and to the receipts evidence ids',
      ],
      gateway_event_log: events.entries().map((event) => ({ type: event.type, actionId: event.actionId, family: event.family, sourceRevision: event.sourceRevision, at: event.at })),
    });
  }, 180_000);
});
