import type { ActionFamily } from './actions.js';
import type { ActorRef, Timestamp } from './types.js';

export type ActionEventType = 'action.succeeded' | 'action.failed' | 'action.denied' | 'action.replayed';

export interface ActionEvent {
  readonly type: ActionEventType;
  readonly actionId: string;
  readonly family: ActionFamily;
  readonly actor: ActorRef;
  readonly sourceRevision: string;
  readonly deploymentRevision: string | null;
  readonly at: Timestamp;
  readonly payloadDigest: string;
}

export interface AppendResult {
  readonly accepted: boolean;
  readonly sequence: number;
  readonly duplicateOf: number | null;
  readonly eventId: string;
}

/**
 * Durable, ordered, replay-protected event log (the P2 live-store ingestion
 * discipline): appending the same event twice is an accepted no-op returning
 * the original sequence.
 */
export interface DurableEventLog {
  append(event: ActionEvent): AppendResult;
}
