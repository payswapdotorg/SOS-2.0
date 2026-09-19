/**
 * The Decision action vocabulary — frozen from spec/architecture.md §5:
 *
 *     "Decision: ACT, EXPERIMENT, GATHER_EVIDENCE, ASK, REJECT or ROLLBACK."
 *
 * ASK is a FIRST-CLASS decision outcome and a SUCCESS state (Work Order W1,
 * spec/requirements.md R16 "First-class ASK"): asking the right authority is
 * a valid, successful result — never an error class. The AskRequest artifact
 * (ask.ts) is what a system produces when the decision is ASK.
 *
 * (The decision ENGINE — enforcing decisions using evidence, calibrated
 * uncertainty, impact, risk, reversibility and blast radius — is Work Order
 * W10; this module pins the frozen vocabulary it builds on.)
 */

export const DECISION_ACTIONS = [
  'ACT',
  'EXPERIMENT',
  'GATHER_EVIDENCE',
  'ASK',
  'REJECT',
  'ROLLBACK',
] as const;

export type DecisionAction = (typeof DECISION_ACTIONS)[number];

const DECISION_ACTION_SET: ReadonlySet<string> = new Set(DECISION_ACTIONS);

export function isDecisionAction(value: unknown): value is DecisionAction {
  return typeof value === 'string' && DECISION_ACTION_SET.has(value);
}

/** ASK is a SUCCESS state (a valid outcome), not an error — pinned by tests. */
export const ASK_DECISION_ACTION: DecisionAction = 'ASK';
