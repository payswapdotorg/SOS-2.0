/**
 * RollbackVM — the recovery-declaration view model (Work Order W11;
 * spec/architecture.md §13: "Live changes require bounded recovery unless a
 * governed exception defines another containment mechanism";
 * docs/assurance-model.md: every live change declares rollback mechanism,
 * trigger, authority and evidence).
 *
 * A pure projection of an @sos-2/recovery-control RecoveryDeclarationArtifact
 * (the W8 rollback contract: mechanism, trigger, authority, evidence,
 * governed exception) plus the optional promotion decision that carries the
 * W9 bounded-recovery wiring (rollback triggers wired to experiment
 * guardrails). Mechanism and trigger vocabularies are IMPORTED from
 * @sos-2/recovery-control; the decision action vocabulary from
 * @sos-2/promotion/@sos-2/authority — never redefined.
 */

import { isArtifactId, isArtifactStatus } from '@sos-2/semantic-spine';
import type { ArtifactStatus } from '@sos-2/semantic-spine';
import type {
  GovernedException,
  RecoveryDeclarationArtifact,
  RecoveryMechanism,
  RecoveryTrigger,
} from '@sos-2/recovery-control';
import { assertValidRecoveryDeclaration } from '@sos-2/recovery-control';
import type { PromotionDecisionArtifact } from '@sos-2/promotion';
import { assertValidPromotionDecision } from '@sos-2/promotion';
import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/** The recovery-declaration view model. */
export interface RollbackVM {
  id: string;
  version: number;
  status: ArtifactStatus;
  created_at: string;
  /** The live change this declaration is attached to (spine id). */
  change_ref: string;
  /** The declared recovery mechanism (typed vocabulary, imported). */
  mechanism: RecoveryMechanism;
  /** The declared recovery trigger (typed vocabulary, imported). */
  trigger: RecoveryTrigger;
  /** The authorizing AuthorityGrant id. */
  authority_ref: string;
  /** The Evidence id demonstrating the containment works. */
  evidence_ref: string;
  /** null, or the governed exception accepting another containment mechanism. */
  exception: GovernedException | null;
  /** The promotion decision bound to this recovery, or null. */
  promotion_decision: {
    id: string;
    /** One of the frozen six decision actions. */
    action: string;
    /** The W9 bounded-recovery declaration (mechanism + bound + wired triggers), or null. */
    recovery: {
      mechanism: string;
      max_recovery_seconds: number | null;
      wired_trigger_count: number;
    } | null;
    reasons: string[];
  } | null;
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface ProjectRollbackInput {
  declaration: RecoveryDeclarationArtifact;
  /** The promotion decision bound to this recovery, or null. */
  promotionDecision: PromotionDecisionArtifact | null;
  rationale: RationaleChain;
}

/** Project a recovery declaration (+ optional promotion decision) onto the rollback view model. */
export function projectRollback(input: ProjectRollbackInput): RollbackVM {
  assertValidRecoveryDeclaration(input.declaration);
  if (input.promotionDecision !== null) {
    assertValidPromotionDecision(input.promotionDecision);
  }
  if (input.rationale.subject_id !== input.declaration.envelope.id) {
    throw new UIContractError(
      `rationale chain subject ${JSON.stringify(input.rationale.subject_id)} does not match the declaration id ${JSON.stringify(input.declaration.envelope.id)}`,
    );
  }
  assertValidRationaleChain(input.rationale);

  const declaration = input.declaration;
  const promotion = input.promotionDecision;
  const vm: RollbackVM = {
    id: declaration.envelope.id,
    version: declaration.envelope.version,
    status: declaration.envelope.status,
    created_at: declaration.envelope.created_at,
    change_ref: declaration.content.change_ref,
    mechanism: structuredClone(declaration.content.mechanism),
    trigger: structuredClone(declaration.content.trigger),
    authority_ref: declaration.content.authority_ref,
    evidence_ref: declaration.content.evidence_ref,
    exception: declaration.content.exception === null ? null : structuredClone(declaration.content.exception),
    promotion_decision:
      promotion === null
        ? null
        : {
            id: promotion.envelope.id,
            action: promotion.content.action,
            recovery:
              promotion.content.recovery === null
                ? null
                : {
                    mechanism: promotion.content.recovery.mechanism,
                    max_recovery_seconds: promotion.content.recovery.max_recovery_seconds,
                    wired_trigger_count: promotion.content.recovery.rollback_triggers.length,
                  },
            reasons: [...promotion.content.reasons],
          },
    rationale: input.rationale,
  };
  assertValidRollbackVM(vm);
  return vm;
}

/** Validate a RollbackVM (throws UIContractError). */
export function assertValidRollbackVM(value: unknown): asserts value is RollbackVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`rollback view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set([
    'id',
    'version',
    'status',
    'created_at',
    'change_ref',
    'mechanism',
    'trigger',
    'authority_ref',
    'evidence_ref',
    'exception',
    'promotion_decision',
    'rationale',
  ]);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('rollback view model must have the exact W11 field set (mechanism + trigger + authority + evidence + rationale)');
  }
  if (!isNonEmptyString(record['id']) || !isArtifactId(record['id'])) {
    throw new UIContractError('rollback view model id must be a well-formed spine artifact id');
  }
  if (!isArtifactStatus(record['status'])) {
    throw new UIContractError('rollback view model status must be from the frozen envelope vocabulary');
  }
  if (!isNonEmptyString(record['change_ref']) || !isArtifactId(record['change_ref'])) {
    throw new UIContractError('rollback view model change_ref must be a well-formed spine artifact id');
  }
  const mechanism = record['mechanism'];
  const mechanismKinds = ['ROLLBACK_DEPLOYMENT', 'DISABLE_FEATURE', 'RESTORE_STATE', 'CUSTOM_PROCEDURE', 'UNSPECIFIED'];
  if (!isPlainObject(mechanism) || !mechanismKinds.includes((mechanism as Record<string, unknown>)['kind'] as string)) {
    throw new UIContractError(
      `rollback mechanism must be one of the frozen kinds (${mechanismKinds.join(', ')}), received: ${JSON.stringify(mechanism)}`,
    );
  }
  const trigger = record['trigger'];
  const triggerKinds = ['BUDGET', 'DEADLINE', 'MANUAL'];
  if (!isPlainObject(trigger) || !triggerKinds.includes((trigger as Record<string, unknown>)['kind'] as string)) {
    throw new UIContractError(
      `rollback trigger must be one of the frozen kinds (${triggerKinds.join(', ')}), received: ${JSON.stringify(trigger)}`,
    );
  }
  if (!isNonEmptyString(record['authority_ref']) || !isArtifactId(record['authority_ref'])) {
    throw new UIContractError('rollback view model authority_ref must be a well-formed spine artifact id');
  }
  if (!isNonEmptyString(record['evidence_ref']) || !isArtifactId(record['evidence_ref'])) {
    throw new UIContractError(
      'rollback view model evidence_ref must be a well-formed spine artifact id (the declared containment must be evidenced)',
    );
  }
  if (record['exception'] !== null) {
    const exception = record['exception'] as Record<string, unknown>;
    if (!isPlainObject(exception) || !isNonEmptyString(exception['containment']) || !Array.isArray(exception['provenance'])) {
      throw new UIContractError('rollback governed exception must carry { authority_ref, containment, provenance }');
    }
  }
  if (record['promotion_decision'] !== null) {
    const promotion = record['promotion_decision'] as Record<string, unknown>;
    if (!isPlainObject(promotion) || Object.keys(promotion).length !== 4) {
      throw new UIContractError('promotion decision summary must have the exact field set { id, action, recovery, reasons }');
    }
    const actions = ['ACT', 'EXPERIMENT', 'GATHER_EVIDENCE', 'ASK', 'REJECT', 'ROLLBACK'];
    if (!actions.includes(promotion['action'] as string)) {
      throw new UIContractError(`promotion decision action must be one of the frozen six, received: ${JSON.stringify(promotion['action'])}`);
    }
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`rollback view model rationale is invalid: ${(cause as Error).message}`);
  }
  const rationale = record['rationale'] as RationaleChain;
  if (rationale.subject_id !== record['id']) {
    throw new UIContractError('rollback view model rationale must bind this declaration id');
  }
  if (rationale.evidence_refs.length === 0) {
    throw new UIContractError(
      'rollback view model rationale must cite evidence (the declared containment must be demonstrably evidenced)',
    );
  }
}

/** Predicate form of assertValidRollbackVM. */
export function validateRollbackVM(value: unknown): value is RollbackVM {
  try {
    assertValidRollbackVM(value);
    return true;
  } catch {
    return false;
  }
}
