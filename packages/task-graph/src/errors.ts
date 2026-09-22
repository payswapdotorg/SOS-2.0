/**
 * Typed errors of the durable task graph (Work Order P6).
 *
 * The graph NEVER fails silently: malformed nodes, illegal state
 * transitions, scope collisions, orphaned references and recovery
 * violations throw TYPED errors naming the violated rule; honest
 * operational outcomes (denials, CAS conflicts) flow through typed
 * result unions instead.
 */

export const TASK_GRAPH_ERROR_CODES = ['INVALID', 'TRANSITION', 'SCOPE', 'STRUCTURE', 'RECOVERY'] as const;

export type TaskGraphErrorCode = (typeof TASK_GRAPH_ERROR_CODES)[number];

/** Base class of every typed task-graph error. */
export class TaskGraphError extends Error {
  readonly code: TaskGraphErrorCode;

  constructor(code: TaskGraphErrorCode, message: string) {
    super(message);
    this.name = 'TaskGraphError';
    this.code = code;
  }
}

/** A task node (or node input) failed shape validation (typed INVALID). */
export class InvalidTaskNodeError extends TaskGraphError {
  constructor(message: string) {
    super('INVALID', message);
    this.name = 'InvalidTaskNodeError';
  }
}

/** An illegal state-machine transition was attempted (typed TRANSITION). */
export class IllegalTaskTransitionError extends TaskGraphError {
  readonly from: string;
  readonly to: string;
  /** The rule that forbids the transition (named — never a silent refusal). */
  readonly rule: string;

  constructor(from: string, to: string, rule: string) {
    super('TRANSITION', `illegal task transition ${from} -> ${to}: ${rule}`);
    this.name = 'IllegalTaskTransitionError';
    this.from = from;
    this.to = to;
    this.rule = rule;
  }
}

/** A typed assignment denial (scope collision / lane exhaustion / dependency). */
export class AssignmentDeniedError extends TaskGraphError {
  readonly denial: {
    readonly code: 'SCOPE_COLLISION' | 'LANE_EXHAUSTED' | 'DEPENDENCY_UNSATISFIED' | 'TASK_NOT_PENDING';
    readonly reason: string;
    readonly details: Readonly<Record<string, unknown>>;
  };

  constructor(
    code: 'SCOPE_COLLISION' | 'LANE_EXHAUSTED' | 'DEPENDENCY_UNSATISFIED' | 'TASK_NOT_PENDING',
    reason: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super('SCOPE', `assignment denied (${code}): ${reason}`);
    this.name = 'AssignmentDeniedError';
    this.denial = { code, reason, details };
  }
}

/** The graph structure is invalid (cycles, orphaned references — typed STRUCTURE). */
export class TaskGraphStructureError extends TaskGraphError {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super('STRUCTURE', `task graph structure is invalid (${violations.length} violation(s)): ${violations.join('; ')}`);
    this.name = 'TaskGraphStructureError';
    this.violations = violations;
  }
}

/** A recovery-discipline violation (typed RECOVERY — recovery never lies). */
export class TaskRecoveryError extends TaskGraphError {
  constructor(message: string) {
    super('RECOVERY', message);
    this.name = 'TaskRecoveryError';
  }
}
