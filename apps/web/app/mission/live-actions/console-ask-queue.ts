/**
 * THE CONSOLE'S LIVE ASK QUEUE (Work Order P18-B — integration seam).
 *
 * The live-mission surface resolves pending asks through the MERGED
 * @sos-2/ask AskQueue (the MOUNTING.md step-2 wiring): resolution
 * authority is the HUMAN resolver, the queue mints the Decision record
 * through @sos-2/decision, and an entry is resolved at most once
 * (terminal). The frozen P17-C action panel records exactly this design
 * ("Pending asks are resolved by HUMAN authority through the merged ASK
 * queue ... the same gateway mount").
 *
 * HONEST SCOPE (binding): there is NO durable ask store attached to this
 * console today — the canonical durable stores are DNS-unreachable
 * (Neon/Upstash UNAVAILABLE, recorded verbatim by the P18-A data-plane
 * lane) — so this queue is PROCESS-LOCAL: every server instance composes
 * the same deterministic reference ask below through the REAL decision
 * machinery (a real DecisionRequest evaluated by @sos-2/decision -> the
 * ASK action -> a real AskRequest artifact minted by
 * @sos-2/authority::createAskRequest -> enqueued through the merged
 * queue). The ask is a REAL artifact of the real machinery with a
 * DETERMINISTIC identity (fixed literals — no hidden clocks); it is the
 * console's reference ask, honestly labelled as such everywhere it
 * renders. Nothing here fabricates a provider state.
 */

import { AskQueue } from '@sos-2/ask';
import { composeAskContent } from '@sos-2/ask';
import { createAskRequest } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import type { DecisionRequest } from '@sos-2/decision';
import type { AskQueueEntry } from '@sos-2/ask';

// ---------------------------------------------------------------------------
// The deterministic console reference ask (fixed literals — no clocks)
// ---------------------------------------------------------------------------

/** The fixed evaluation instant of the console reference ask (RFC3339). */
export const CONSOLE_ASK_CREATED_AT = '2026-09-26T00:00:00.000Z';
/** The fixed provenance stamps carried by the console reference ask. */
export const CONSOLE_ASK_PROVENANCE = ['P18B:web-live-mission', 'surface:live-mission'] as const;

/** The decision request behind the console's reference ask (a real request, honestly scoped). */
const consoleAskDecisionRequest: DecisionRequest = {
  action_kind: 'REVISE',
  action_description: 'Revise the recorded mission to adopt the live-observed repository as the system under mission.',
  target: { kind: 'KIND', artifact_kind: 'Mission' },
  blast_radius: 'SERVICE',
  impact: 'MODERATE',
  risk: 'LOW',
  reversibility: 'REVERSIBLE',
  causal_claim: false,
  uncertainty: { uncertainty_class: 'MODERATE', basis: 'the live observation plane is not yet wired, so the observed system state is not yet machine-verified' },
  rollback_signals: [],
  evidence: [],
  grants: [],
  evaluation_point: { kind: 'TIME', now: CONSOLE_ASK_CREATED_AT },
  explicit_authority_decision_ref: null,
  confidence: null,
};

/**
 * The console's seeded pending ask entry (composed through the REAL
 * machinery at most once per queue instance). Deterministic: the same
 * literals produce the same content-addressed artifact ids on every
 * composition.
 */
export function seedConsoleAsk(queue: AskQueue): AskQueueEntry {
  const evaluation = evaluate(consoleAskDecisionRequest, {
    provenance: [...CONSOLE_ASK_PROVENANCE],
    created_at: CONSOLE_ASK_CREATED_AT,
  });
  if (evaluation.action !== 'ASK') {
    // Honest fail-closed composition: this fixture request carries no
    // grants, so the decision engine must answer ASK (authority first).
    throw new Error(`the console reference ask must evaluate to ASK, received ${evaluation.action}`);
  }
  const ask = createAskRequest({
    content: composeAskContent({ decision: evaluation.record }),
    provenance: [...CONSOLE_ASK_PROVENANCE],
    created_at: CONSOLE_ASK_CREATED_AT,
    version: 1,
  });
  return queue.enqueue({ ask, origin_decision: evaluation.record, enqueued_at: CONSOLE_ASK_CREATED_AT });
}

// ---------------------------------------------------------------------------
// The process-local queue singleton (the documented impure boundary)
// ---------------------------------------------------------------------------

const CONSOLE_ASK_QUEUE_GLOBAL = Symbol.for('sos-2.web-live-mission.console-ask-queue');

/** The queue singleton's storage (survives dev HMR and warm serverless reuse). */
interface ConsoleAskQueueStore {
  queue: AskQueue | null;
  seed: AskQueueEntry | null;
}

function store(): ConsoleAskQueueStore {
  const globals = globalThis as Record<symbol, ConsoleAskQueueStore | undefined>;
  const existing = globals[CONSOLE_ASK_QUEUE_GLOBAL];
  if (existing !== undefined) {
    return existing;
  }
  const fresh: ConsoleAskQueueStore = { queue: null, seed: null };
  globals[CONSOLE_ASK_QUEUE_GLOBAL] = fresh;
  return fresh;
}

/**
 * The console's live ask queue (process-local): the merged AskQueue with
 * the deterministic reference ask seeded. Resolutions mint real Decision
 * records bound to the ask's exact input digest.
 */
export function getConsoleAskQueue(): { readonly queue: AskQueue; readonly seed: AskQueueEntry } {
  const current = store();
  if (current.queue === null || current.seed === null) {
    const queue = new AskQueue();
    const seed = seedConsoleAsk(queue);
    current.queue = queue;
    current.seed = seed;
  }
  return { queue: current.queue, seed: current.seed };
}

/** The honest scope note rendered beside every ask surface (never a fabricated durable claim). */
export const CONSOLE_ASK_SCOPE_NOTE =
  'This queue is process-local: the durable ask store is not attached (Neon/Upstash are UNAVAILABLE — the recorded DNS facts). Resolutions mint real Decision records bound to the ask\u2019s exact input digest, but the queue itself does not survive a server restart.';

// ---------------------------------------------------------------------------
// The pure ask view (what the mission surface renders)
// ---------------------------------------------------------------------------

/** One pending ask as the mission surface renders it (the pure projection of a queue entry). */
export interface ConsoleAskView {
  readonly entryId: string;
  readonly decision: string;
  readonly alternatives: readonly { readonly id: string; readonly action: string; readonly description: string }[];
  readonly priority: string;
  readonly enqueuedAt: string;
  readonly authorityInsufficiency: string;
  readonly uncertaintyBasis: string;
  readonly riskSeverity: string;
  readonly evidenceQuality: string;
}

/** Project the queue's pending entries into renderable views (pure; deterministic). */
export function consoleAskViews(queue: AskQueue): readonly ConsoleAskView[] {
  return queue.pending().map((entry) => ({
    entryId: entry.id,
    decision: entry.ask.content.decision,
    alternatives: entry.ask.content.alternatives.map((alternative) => ({
      id: alternative.id,
      action: alternative.action,
      description: alternative.description,
    })),
    priority: entry.priority,
    enqueuedAt: entry.enqueued_at,
    authorityInsufficiency: entry.ask.content.authority_insufficiency,
    uncertaintyBasis: entry.ask.content.uncertainty.basis,
    riskSeverity: entry.ask.content.risk.severity,
    evidenceQuality: entry.ask.content.evidence_quality.quality,
  }));
}
