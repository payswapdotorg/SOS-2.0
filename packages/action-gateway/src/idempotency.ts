import type { ActionFamily } from './actions.js';
import type { ActionDenial } from './authority.js';
import type { OperationOutput } from './executors.js';
import type { RollbackVerificationRecord } from './evidence.js';
import type { ActorRef, Timestamp } from './types.js';

export type ActionReceiptStatus = 'SUCCEEDED' | 'FAILED' | 'DENIED';

export interface ActionFailure {
  readonly operation: string;
  readonly errorType: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ActionReceipt {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly family: ActionFamily;
  readonly actor: ActorRef;
  readonly status: ActionReceiptStatus;
  readonly sourceRevision: string;
  readonly deploymentRevision: string | null;
  readonly denial: ActionDenial | null;
  readonly failure: ActionFailure | null;
  readonly output: OperationOutput | null;
  readonly rollbackVerification: RollbackVerificationRecord | null;
  readonly evidenceIds: readonly string[];
  readonly executedAt: Timestamp;
}

export interface RecordedActionRecord {
  readonly idempotencyKey: string;
  readonly receipt: ActionReceipt;
  readonly recordedAt: Timestamp;
}

export interface IdempotencyStore {
  lookup(idempotencyKey: string): RecordedActionRecord | null;
  /**
   * Reserve the key for a first execution. Returns the existing record when
   * the key was already claimed (replay) and null when the caller now owns
   * the key. The durable binding is the P2 live-store discipline; the
   * in-memory reference below documents the shape.
   */
  claim(idempotencyKey: string): RecordedActionRecord | null;
  record(receipt: ActionReceipt, at: Timestamp): void;
}
