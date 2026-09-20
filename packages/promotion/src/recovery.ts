/**
 * Bounded recovery declaration — the W9 structural mirror of the (unmerged)
 * @sos-2/recovery-control contract.
 *
 * W9 PARALLELIZATION RULE: W9 must be implementable without W8 source
 * dependencies, so the rollback contract is mirrored STRUCTURALLY here
 * (exactly as the Work Order prescribes: "integrate or structurally mirror
 * @sos-2/recovery-control types via fixtures — do not import unmerged W8
 * source"). When W8 merges, this declaration is compatible by shape: a
 * recovery MECHANISM description, a BOUNDED recovery time, and rollback
 * TRIGGERS wired to @sos-2/experiments guardrail trigger records.
 *
 * spec/architecture.md §13: "Live changes require bounded recovery unless a
 * governed exception defines another containment mechanism."
 * docs/assurance-model.md: "Every live change declares: rollback mechanism,
 * trigger, authority and evidence."
 *
 * Realization (validated, fail-loud):
 *   - `mechanism`      WHAT the bounded recovery is (non-empty)
 *   - `max_recovery_seconds`  the BOUND (positive integer) — required on
 *                      the default path
 *   - `containment_exception`  a GOVERNED exception declaring another
 *                      containment mechanism INSTEAD of bounded recovery:
 *                      requires an authority_ref (the authorizing grant
 *                      spine id) and a note; exactly one of
 *                      bounded-recovery/containment-exception may be
 *                      declared
 *   - `rollback_triggers`  the WIRED triggers: guardrail trigger records
 *                      from @sos-2/experiments (kind ROLLBACK) plus their
 *                      experiment ids — promotion records declare the
 *                      triggers that would fire the rollback
 *   - `authority_ref`  the authority authorizing the live change (spine id
 *                      or null when the promotion gate supplies it)
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import { PromotionError } from './errors.js';
import type { TriggerRecord } from '@sos-2/experiments';

/** One wired rollback trigger: a guardrail trigger record + its experiment. */
export interface RollbackTriggerWiring {
  /** The experiment whose guardrails are wired (sos://Experiment/<segment>). */
  experiment_id: string;
  /** The typed trigger record (kind must be ROLLBACK). */
  trigger: TriggerRecord;
}

/** A governed containment exception (replaces bounded recovery). */
export interface ContainmentException {
  /** The authorizing artifact id (a grant or governing artifact). */
  authority_ref: string;
  /** Why another containment mechanism applies (non-empty). */
  note: string;
}

/** The bounded recovery declaration of a promotion record. */
export interface BoundedRecoveryDeclaration {
  /** WHAT the bounded recovery mechanism is (non-empty). */
  mechanism: string;
  /** The recovery-time bound in seconds (positive integer). REQUIRED unless a containment exception is declared. */
  max_recovery_seconds: number | null;
  /** The governed containment exception, or null. Exactly one of the two paths may be declared. */
  containment_exception: ContainmentException | null;
  /** The rollback triggers wired to experiment guardrail records (>= 1). */
  rollback_triggers: RollbackTriggerWiring[];
  /** The authority authorizing the live change, or null. */
  authority_ref: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

/** Validate one rollback trigger wiring (throws PromotionError). */
export function assertValidRollbackTriggerWiring(value: unknown): asserts value is RollbackTriggerWiring {
  if (!isPlainObject(value) || Object.keys(value).length !== 2) {
    throw new PromotionError('rollback trigger wiring must have the exact field set { experiment_id, trigger }');
  }
  if (!isArtifactId(value['experiment_id']) || !value['experiment_id'].startsWith('sos://Experiment/')) {
    throw new PromotionError(
      `rollback trigger wiring experiment_id must be a well-formed sos://Experiment/ id, received: ${JSON.stringify(value['experiment_id'])}`,
    );
  }
  const trigger = value['trigger'];
  if (!isPlainObject(trigger)) {
    throw new PromotionError('rollback trigger wiring requires a typed trigger record from @sos-2/experiments');
  }
  const keys = ['kind', 'rule_id', 'description', 'triggered', 'reason', 'conditions'];
  if (Object.keys(trigger).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(trigger, key))) {
    throw new PromotionError(
      'wired trigger must be an @sos-2/experiments TriggerRecord with the exact field set ' +
        '{ kind, rule_id, description, triggered, reason, conditions }',
    );
  }
  if (trigger['kind'] !== 'ROLLBACK') {
    throw new PromotionError(
      `wired trigger kind must be ROLLBACK (guardrail-wired rollback triggers), received: ${JSON.stringify(trigger['kind'])}`,
    );
  }
  if (!isNonEmptyString(trigger['rule_id'])) {
    throw new PromotionError(`wired trigger rule_id must be a non-empty string, received: ${JSON.stringify(trigger['rule_id'])}`);
  }
  if (!isNonEmptyString(trigger['description'])) {
    throw new PromotionError(`wired trigger description must be a non-empty string, received: ${JSON.stringify(trigger['description'])}`);
  }
  if (typeof trigger['triggered'] !== 'boolean') {
    throw new PromotionError(`wired trigger triggered must be a boolean, received: ${JSON.stringify(trigger['triggered'])}`);
  }
  if (!isNonEmptyString(trigger['reason'])) {
    throw new PromotionError(`wired trigger reason must be a non-empty string, received: ${JSON.stringify(trigger['reason'])}`);
  }
  const conditions = trigger['conditions'];
  if (!Array.isArray(conditions)) {
    throw new PromotionError('wired trigger conditions must be an array of { condition, satisfied }');
  }
  for (const condition of conditions) {
    if (!isPlainObject(condition) || Object.keys(condition).length !== 2) {
      throw new PromotionError('wired trigger condition entries must have the exact field set { condition, satisfied }');
    }
    if (!isNonEmptyString(condition['condition'])) {
      throw new PromotionError(`condition text must be a non-empty string, received: ${JSON.stringify(condition['condition'])}`);
    }
    if (typeof condition['satisfied'] !== 'boolean') {
      throw new PromotionError(`condition satisfied must be a boolean, received: ${JSON.stringify(condition['satisfied'])}`);
    }
  }
}

/**
 * Full validation of a BoundedRecoveryDeclaration (throws PromotionError):
 *
 *   - exactly one of { max_recovery_seconds, containment_exception } is
 *     declared (a live change requires bounded recovery UNLESS a governed
 *     containment exception replaces it — never both, never neither);
 *   - the containment exception carries an authority_ref (governed — an
 *     ungoverned exception is rejected);
 *   - at least one rollback trigger is WIRED to an experiment guardrail
 *     record (every live change declares its rollback trigger);
 *   - max_recovery_seconds, when present, is a positive integer bound.
 */
export function assertValidBoundedRecovery(value: unknown): asserts value is BoundedRecoveryDeclaration {
  if (!isPlainObject(value)) {
    throw new PromotionError(`bounded recovery declaration must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = ['mechanism', 'max_recovery_seconds', 'containment_exception', 'rollback_triggers', 'authority_ref'];
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new PromotionError(`bounded recovery declaration must have the exact field set { ${keys.join(', ')} }`);
  }
  if (!isNonEmptyString(record['mechanism'])) {
    throw new PromotionError(`recovery mechanism must be a non-empty string, received: ${JSON.stringify(record['mechanism'])}`);
  }
  const bounded = record['max_recovery_seconds'];
  if (bounded !== null && !isPositiveInteger(bounded)) {
    throw new PromotionError(
      `max_recovery_seconds must be null or a positive integer (the recovery bound), received: ${JSON.stringify(bounded)}`,
    );
  }
  const exception = record['containment_exception'];
  if (exception !== null) {
    if (!isPlainObject(exception) || Object.keys(exception).length !== 2) {
      throw new PromotionError('containment exception must have the exact field set { authority_ref, note }');
    }
    if (!isArtifactId(exception['authority_ref'])) {
      throw new PromotionError(
        `containment exception authority_ref must be a well-formed spine artifact id (the exception is GOVERNED), received: ${JSON.stringify(exception['authority_ref'])}`,
      );
    }
    if (!isNonEmptyString(exception['note'])) {
      throw new PromotionError(`containment exception note must be a non-empty string, received: ${JSON.stringify(exception['note'])}`);
    }
  }
  if (bounded === null && exception === null) {
    throw new PromotionError(
      'a live change requires bounded recovery: declare max_recovery_seconds, or a governed containment exception ' +
        '(spec/architecture.md §13 — never neither)',
    );
  }
  if (bounded !== null && exception !== null) {
    throw new PromotionError(
      'declare EITHER a bounded recovery time OR a governed containment exception — never both (spec/architecture.md §13)',
    );
  }
  const triggers = record['rollback_triggers'];
  if (!Array.isArray(triggers) || triggers.length === 0) {
    throw new PromotionError(
      'bounded recovery requires at least one rollback trigger WIRED to an experiment guardrail record ' +
        '(every live change declares its rollback trigger — docs/assurance-model.md)',
    );
  }
  for (const wiring of triggers) {
    assertValidRollbackTriggerWiring(wiring);
  }
  if (record['authority_ref'] !== null && !isArtifactId(record['authority_ref'])) {
    throw new PromotionError(
      `recovery authority_ref must be null or a well-formed spine artifact id, received: ${JSON.stringify(record['authority_ref'])}`,
    );
  }
}

/** Predicate form of assertValidBoundedRecovery. */
export function validateBoundedRecovery(value: unknown): value is BoundedRecoveryDeclaration {
  try {
    assertValidBoundedRecovery(value);
    return true;
  } catch {
    return false;
  }
}
