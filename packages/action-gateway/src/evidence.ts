import type { ActionFamily, RollbackReason } from './actions.js';
import type { ActionDenial } from './authority.js';
import type { OperationOutput } from './executors.js';
import type { ActionFailure, ActionReceiptStatus } from './idempotency.js';
import { contentAddress } from './types.js';
import type { ActorRef, Timestamp } from './types.js';

export interface ActionEvidenceRecord {
  readonly evidenceType: 'action.outcome';
  readonly family: ActionFamily;
  readonly actionId: string;
  readonly actor: ActorRef;
  readonly status: ActionReceiptStatus;
  readonly sourceRevision: string;
  readonly deploymentRevision: string | null;
  readonly observedAt: Timestamp;
  readonly detail: string;
}

export interface RollbackEvidenceRecord {
  readonly evidenceType: 'rollback.outcome';
  readonly actionId: string;
  readonly deploymentId: string;
  readonly fromSourceSha: string;
  readonly toSourceSha: string;
  readonly reason: RollbackReason;
  readonly observedAt: Timestamp;
}

export interface RollbackVerificationRecord {
  readonly evidenceType: 'rollback.verification';
  readonly actionId: string;
  readonly deploymentId: string;
  readonly expectedSourceSha: string;
  readonly observedSourceSha: string | null;
  readonly verdict: 'VERIFIED' | 'FAILED' | 'UNKNOWN';
  readonly limitation: string | null;
  readonly observedAt: Timestamp;
}

export type EvidenceRecord = ActionEvidenceRecord | RollbackEvidenceRecord | RollbackVerificationRecord;
export type StoredEvidence = EvidenceRecord & { readonly evidenceId: string };

/** Provenance discipline: every evidence record is content-addressed. */
export function addressEvidence(record: EvidenceRecord): StoredEvidence {
  return { ...record, evidenceId: contentAddress(record, 'action-evidence') };
}

export interface EvidenceSink {
  emit(record: EvidenceRecord): StoredEvidence;
  all(): readonly StoredEvidence[];
}

export interface RollbackVerifierObservation {
  readonly verdict: 'VERIFIED' | 'FAILED' | 'UNKNOWN';
  readonly observedSourceSha: string | null;
  readonly limitation: string | null;
}

export interface RollbackVerifier {
  verify(deploymentId: string, expectedSourceSha: string, at: Timestamp): RollbackVerifierObservation;
}

/** Convenience for callers assembling denial details. */
export function denialDetail(denial: ActionDenial): string {
  return `denied: ${denial.reason} — ${denial.detail}`;
}

export function failureDetail(failure: ActionFailure): string {
  return `failed: ${failure.errorType} at ${failure.operation} — ${failure.message}`;
}
