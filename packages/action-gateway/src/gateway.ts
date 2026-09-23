import { validateRequest } from './actions.js';
import type { ActionFamily, ActionRequest, ActionValidationRejection } from './actions.js';
import { authorityQueryFor } from './authority.js';
import type { ActionDenial, AuthorityPort, PlanningRef } from './authority.js';
import { addressEvidence } from './evidence.js';
import type { EvidenceSink, RollbackVerificationRecord, RollbackVerifier } from './evidence.js';
import { isDeploymentFamily, operationsFor } from './executors.js';
import type { ActionExecutor, ExecutionContext, OperationOutput } from './executors.js';
import type { ActionEvent, ActionEventType, DurableEventLog } from './events.js';
import type { ActionFailure, ActionReceipt, ActionReceiptStatus, IdempotencyStore } from './idempotency.js';
import { contentAddress } from './types.js';
import type { Clock, Timestamp } from './types.js';

export type GatewayOutcome =
  | { readonly kind: 'rejected'; readonly rejection: ActionValidationRejection }
  | { readonly kind: 'executed'; readonly receipt: ActionReceipt }
  | { readonly kind: 'replayed'; readonly receipt: ActionReceipt };

export interface GatewayDeps {
  readonly clock: Clock;
  readonly authority: AuthorityPort;
  readonly executors: readonly ActionExecutor[];
  readonly idempotency: IdempotencyStore;
  readonly events: DurableEventLog;
  readonly evidence: EvidenceSink;
  readonly rollbackVerifier: RollbackVerifier | null;
}

interface ReceiptCore {
  readonly status: ActionReceiptStatus;
  readonly deploymentRevision: string | null;
  readonly denial: ActionDenial | null;
  readonly failure: ActionFailure | null;
  readonly output: OperationOutput | null;
  readonly rollbackVerification: RollbackVerificationRecord | null;
}

/**
 * The authority-gated action gateway. Execution order is fixed and fail-closed:
 *   1. envelope validation (typed rejection; smuggled authority fields are named),
 *   2. idempotency claim (replay returns the recorded original outcome),
 *   3. CURRENT authority re-evaluation at action time — exactly ONE evaluation;
 *      a revoked/expired/never-held grant is a typed ACTION_AUTHORITY_DENIED
 *      denial, executors are never invoked, and there is no retry,
 *   4. executor-seam execution (typed operations in, typed results out),
 *   5. evidence + event emission bound to the exact revisions acted on.
 */
export class ActionGateway {
  constructor(private readonly deps: GatewayDeps) {}

  execute(raw: unknown, planning?: PlanningRef): GatewayOutcome {
    const validated = validateRequest(raw);
    if (!validated.ok) return { kind: 'rejected', rejection: validated.rejection };
    const request = validated.request;
    const at = this.deps.clock.now();

    const existing = this.deps.idempotency.claim(request.idempotencyKey);
    if (existing !== null) {
      this.appendEvent(request, 'action.replayed', existing.receipt.sourceRevision, existing.receipt.deploymentRevision, at);
      return { kind: 'replayed', receipt: existing.receipt };
    }

    const snapshot = this.deps.authority.evaluateCurrent(authorityQueryFor(request, planning), at);
    if (!snapshot.granted) {
      return this.complete(request, at, {
        status: 'DENIED',
        deploymentRevision: null,
        denial: {
          reason: 'ACTION_AUTHORITY_DENIED',
          authority: snapshot,
          detail: `authority re-evaluated at action time: ${snapshot.reason} (${snapshot.detail})`,
        },
        failure: null,
        output: null,
        rollbackVerification: null,
      });
    }

    const executor = this.deps.executors.find((candidate) => candidate.families.includes(request.family)) ?? null;
    if (executor === null) {
      return this.complete(request, at, {
        status: 'FAILED',
        deploymentRevision: null,
        denial: null,
        failure: {
          operation: 'route',
          errorType: 'NO_EXECUTOR_BOUND',
          message: `no executor bound for family ${request.family}`,
          retryable: false,
        },
        output: null,
        rollbackVerification: null,
      });
    }

    const context: ExecutionContext = {
      actionId: request.actionId,
      idempotencyKey: request.idempotencyKey,
      actor: request.actor,
      targetRevision: request.targetRevision,
      at,
    };

    let deploymentRevision: string | null = null;
    let output: OperationOutput | null = null;
    for (const operation of operationsFor(request)) {
      const result = executor.execute(operation, context);
      if (result.status === 'error') {
        return this.complete(request, at, {
          status: 'FAILED',
          deploymentRevision,
          denial: null,
          failure: {
            operation: operation.op,
            errorType: result.errorType,
            message: result.message,
            retryable: result.retryable,
          },
          output,
          rollbackVerification: null,
        });
      }
      output = result.output;
      if ('produced' in result.output) {
        const deploymentId = result.output.produced['deploymentId'];
        if (isDeploymentFamily(request.family) && typeof deploymentId === 'string') {
          deploymentRevision = deploymentId;
        }
      }
    }

    const rollbackVerification =
      request.family === 'rollback' ? this.verifyRollback(request, deploymentRevision, at) : null;

    return this.complete(request, at, {
      status: 'SUCCEEDED',
      deploymentRevision,
      denial: null,
      failure: null,
      output,
      rollbackVerification,
    });
  }

  private verifyRollback(request: ActionRequest, deploymentRevision: string | null, at: Timestamp): RollbackVerificationRecord | null {
    if (request.payload.family !== 'rollback' || deploymentRevision === null) return null;
    const payload = request.payload.rollback;
    const observation =
      this.deps.rollbackVerifier !== null
        ? this.deps.rollbackVerifier.verify(deploymentRevision, payload.toSourceSha, at)
        : { verdict: 'UNKNOWN' as const, observedSourceSha: null, limitation: 'no rollback verifier configured' };
    return {
      evidenceType: 'rollback.verification',
      actionId: request.actionId,
      deploymentId: deploymentRevision,
      expectedSourceSha: payload.toSourceSha,
      observedSourceSha: observation.observedSourceSha,
      verdict: observation.verdict,
      limitation: observation.limitation,
      observedAt: at,
    };
  }

  private complete(request: ActionRequest, at: Timestamp, core: ReceiptCore): GatewayOutcome {
    const evidenceIds: string[] = [];

    const detail =
      core.status === 'DENIED'
        ? `denied: ${core.denial?.reason} — ${core.denial?.detail}`
        : core.status === 'FAILED'
          ? `failed: ${core.failure?.errorType} at ${core.failure?.operation} — ${core.failure?.message}`
          : 'succeeded';

    const outcomeEvidence = this.deps.evidence.emit({
      evidenceType: 'action.outcome',
      family: request.family,
      actionId: request.actionId,
      actor: request.actor,
      status: core.status,
      sourceRevision: request.targetRevision.sha,
      deploymentRevision: core.deploymentRevision,
      observedAt: at,
      detail,
    });
    evidenceIds.push(outcomeEvidence.evidenceId);

    if (request.family === 'rollback' && request.payload.family === 'rollback' && core.status === 'SUCCEEDED') {
      const payload = request.payload.rollback;
      const rollbackEvidence = this.deps.evidence.emit({
        evidenceType: 'rollback.outcome',
        actionId: request.actionId,
        deploymentId: payload.deploymentId,
        fromSourceSha: payload.fromSourceSha,
        toSourceSha: payload.toSourceSha,
        reason: payload.reason,
        observedAt: at,
      });
      evidenceIds.push(rollbackEvidence.evidenceId);
      if (core.rollbackVerification !== null) {
        const verification = this.deps.evidence.emit(core.rollbackVerification);
        evidenceIds.push(verification.evidenceId);
      }
    }

    const receipt: ActionReceipt = {
      actionId: request.actionId,
      idempotencyKey: request.idempotencyKey,
      family: request.family,
      actor: request.actor,
      status: core.status,
      sourceRevision: request.targetRevision.sha,
      deploymentRevision: core.deploymentRevision,
      denial: core.denial,
      failure: core.failure,
      output: core.output,
      rollbackVerification: core.rollbackVerification,
      evidenceIds,
      executedAt: at,
    };
    this.deps.idempotency.record(receipt, at);
    this.appendEvent(request, eventTypeFor(core.status), receipt.sourceRevision, receipt.deploymentRevision, at);
    return { kind: 'executed', receipt };
  }

  private appendEvent(
    request: ActionRequest,
    type: ActionEventType,
    sourceRevision: string,
    deploymentRevision: string | null,
    at: Timestamp,
  ): void {
    const event: ActionEvent = {
      type,
      actionId: request.actionId,
      family: request.family,
      actor: request.actor,
      sourceRevision,
      deploymentRevision,
      at,
      payloadDigest: contentAddress(request.payload, 'action-payload'),
    };
    this.deps.events.append(event);
  }
}

function eventTypeFor(status: ActionReceiptStatus): ActionEventType {
  if (status === 'SUCCEEDED') return 'action.succeeded';
  if (status === 'FAILED') return 'action.failed';
  return 'action.denied';
}

export type { ActionFamily };
