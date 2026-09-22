/**
 * Typed errors of the Spirit Orchestrator (Work Order P6).
 *
 * The orchestrator NEVER silently bypasses assurance or authority: every
 * bypass attempt is a TYPED violation naming the violated rule and the
 * implicated field (pinned by tests).
 */

export const ORCHESTRATOR_ERROR_CODES = ['INVALID', 'SILENT_BYPASS', 'GATE', 'DECISION'] as const;

export type OrchestratorErrorCode = (typeof ORCHESTRATOR_ERROR_CODES)[number];

/** Base class of every typed orchestrator error. */
export class OrchestratorError extends Error {
  readonly code: OrchestratorErrorCode;

  constructor(code: OrchestratorErrorCode, message: string) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
  }
}

/**
 * A SILENT-BYPASS attempt — typed, loud, naming the rule and the field
 * (pinned: the orchestrator never silently bypasses assurance or
 * authority; ASK escalations are first-class; broker output never
 * reaches authority or verification verdicts).
 */
export class SilentBypassViolationError extends OrchestratorError {
  /** The named rule that was violated (e.g. 'verification-gates-completion'). */
  readonly rule: string;
  /** The implicated field (e.g. 'evidence_refs[2]'). */
  readonly field: string;

  constructor(rule: string, field: string, message: string) {
    super('SILENT_BYPASS', message);
    this.name = 'SilentBypassViolationError';
    this.rule = rule;
    this.field = field;
  }
}

/** An architect-gate violation (typed GATE — the gate cannot mint authority). */
export class ArchitectGateViolationError extends OrchestratorError {
  readonly rule: string;
  readonly field: string;

  constructor(rule: string, field: string, message: string) {
    super('GATE', message);
    this.name = 'ArchitectGateViolationError';
    this.rule = rule;
    this.field = field;
  }
}

/** A malformed orchestrator input (typed INVALID). */
export class InvalidOrchestratorInputError extends OrchestratorError {
  constructor(message: string) {
    super('INVALID', message);
    this.name = 'InvalidOrchestratorInputError';
  }
}

/** An escalation decision violation (typed DECISION — honest escalation only). */
export class EscalationDecisionError extends OrchestratorError {
  constructor(message: string) {
    super('DECISION', message);
    this.name = 'EscalationDecisionError';
  }
}
