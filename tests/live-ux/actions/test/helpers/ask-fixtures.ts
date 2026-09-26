/**
 * The deterministic ASK fixture (Work Order P18-B): composes a PENDING ask
 * queue entry through the REAL merged decision engine + the REAL AskQueue
 * (the tests/real-observation action-wiring precedent — a real REVISE
 * decision request that escalates to ASK, then a real enqueue).
 */

import { AskQueue, composeAskContent } from '@sos-2/ask';
import { createAskRequest } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import type { DecisionRequest } from '@sos-2/decision';

export function pendingAsk(provenance: readonly string[]): { queue: AskQueue; entryId: string } {
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
    evaluation_point: { kind: 'TIME', now: '2026-09-26T00:00:00.000Z' },
    explicit_authority_decision_ref: null,
    confidence: null,
  };
  const evaluation = evaluate(decisionRequest, { provenance: [...provenance], created_at: '2026-09-26T00:00:00.000Z' });
  if (evaluation.action !== 'ASK') {
    throw new Error(`fixture expects ASK, received ${evaluation.action}`);
  }
  const ask = createAskRequest({
    content: composeAskContent({ decision: evaluation.record }),
    provenance: [...provenance],
    created_at: '2026-09-26T00:00:00.000Z',
    version: 1,
  });
  const queue = new AskQueue();
  const entry = queue.enqueue({ ask, origin_decision: evaluation.record, enqueued_at: '2026-09-26T00:00:00.000Z' });
  return { queue, entryId: entry.id };
}
