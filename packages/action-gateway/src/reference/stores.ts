import type { ActionFamily } from '../actions.js';
import type { AuthorityPort, AuthorityQuery, AuthorityReason, AuthoritySnapshot } from '../authority.js';
import type { ActionEvent, AppendResult, DurableEventLog } from '../events.js';
import { addressEvidence } from '../evidence.js';
import type { EvidenceRecord, EvidenceSink, RollbackVerifier, RollbackVerifierObservation, StoredEvidence } from '../evidence.js';
import type { ActionReceipt, IdempotencyStore, RecordedActionRecord } from '../idempotency.js';
import { contentAddress } from '../types.js';
import type { Timestamp } from '../types.js';
import type { ReferenceWorld } from './world.js';

interface GrantSpec {
  readonly grantId: string;
  readonly expiresAt: Timestamp | null;
  revoked: boolean;
}

/**
 * Scriptable in-memory authority standing in for the @sos-2/authority
 * binding. Grants are keyed actor|family|scope ('*' scope wildcard) and can
 * be revoked or given expiry timestamps; evaluation always uses the
 * caller-supplied `now`, so expiry is deterministic under the injected clock.
 */
export class InMemoryAuthority implements AuthorityPort {
  private readonly grants = new Map<string, GrantSpec>();
  private grantCounter = 0;
  readonly evaluations: Array<{ readonly query: AuthorityQuery; readonly now: Timestamp; readonly snapshot: AuthoritySnapshot }> = [];

  grant(actorId: string, family: ActionFamily, scope: string, options?: { grantId?: string; expiresAt?: Timestamp | null }): string {
    this.grantCounter += 1;
    const grantId = options?.grantId ?? `grant-${this.grantCounter}`;
    this.grants.set(keyFor(actorId, family, scope), {
      grantId,
      expiresAt: options?.expiresAt ?? null,
      revoked: false,
    });
    return grantId;
  }

  revoke(grantId: string): boolean {
    for (const spec of this.grants.values()) {
      if (spec.grantId === grantId) {
        spec.revoked = true;
        return true;
      }
    }
    return false;
  }

  evaluateCurrent(query: AuthorityQuery, now: Timestamp): AuthoritySnapshot {
    const exact = this.grants.get(keyFor(query.actor.id, query.family, query.scope)) ?? null;
    const wildcard = this.grants.get(keyFor(query.actor.id, query.family, '*')) ?? null;
    const spec = exact ?? wildcard;
    let reason: AuthorityReason;
    let grantId: string | null = null;
    if (spec === null) {
      reason = 'GRANT_NEVER_HELD';
    } else if (spec.revoked) {
      reason = 'GRANT_REVOKED';
      grantId = spec.grantId;
    } else if (spec.expiresAt !== null && now >= spec.expiresAt) {
      reason = 'GRANT_EXPIRED';
      grantId = spec.grantId;
    } else {
      reason = 'GRANTED';
      grantId = spec.grantId;
    }
    const snapshot: AuthoritySnapshot = {
      granted: reason === 'GRANTED',
      reason,
      grantId,
      evaluatedAt: now,
      detail:
        reason === 'GRANTED'
          ? `grant ${grantId} is currently live for ${query.actor.id}|${query.family}|${query.scope}`
          : `no currently-live grant for ${query.actor.id}|${query.family}|${query.scope}: ${reason}`,
    };
    this.evaluations.push({ query, now, snapshot });
    return snapshot;
  }
}

function keyFor(actorId: string, family: ActionFamily, scope: string): string {
  return `${actorId}|${family}|${scope}`;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, RecordedActionRecord>();

  lookup(idempotencyKey: string): RecordedActionRecord | null {
    return this.records.get(idempotencyKey) ?? null;
  }

  claim(idempotencyKey: string): RecordedActionRecord | null {
    // Single-threaded reference: claim and lookup coincide here. The durable
    // live-store binding provides an atomic claim-and-insert.
    return this.records.get(idempotencyKey) ?? null;
  }

  record(receipt: ActionReceipt, at: Timestamp): void {
    this.records.set(receipt.idempotencyKey, {
      idempotencyKey: receipt.idempotencyKey,
      receipt,
      recordedAt: at,
    });
  }

  size(): number {
    return this.records.size;
  }
}

export class InMemoryEventLog implements DurableEventLog {
  private readonly seen = new Map<string, number>();
  private readonly log: Array<ActionEvent & { readonly eventId: string; readonly sequence: number }> = [];

  append(event: ActionEvent): AppendResult {
    const eventId = contentAddress(event, 'action-event');
    const prior = this.seen.get(eventId);
    if (prior !== undefined) {
      return { accepted: false, sequence: prior, duplicateOf: prior, eventId };
    }
    const sequence = this.log.length + 1;
    this.seen.set(eventId, sequence);
    this.log.push({ ...event, eventId, sequence });
    return { accepted: true, sequence, duplicateOf: null, eventId };
  }

  entries(): readonly (ActionEvent & { readonly eventId: string; readonly sequence: number; })[] {
    return [...this.log];
  }
}

export class InMemoryEvidenceSink implements EvidenceSink {
  private readonly records: StoredEvidence[] = [];

  emit(record: EvidenceRecord): StoredEvidence {
    const stored = addressEvidence(record);
    this.records.push(stored);
    return stored;
  }

  all(): readonly StoredEvidence[] {
    return [...this.records];
  }

  ofType(type: EvidenceRecord['evidenceType']): readonly StoredEvidence[] {
    return this.records.filter((record) => record.evidenceType === type);
  }
}

/** Verifier over the reference world: honestly UNKNOWN when the deployment is unobserved. */
export class ReferenceRollbackVerifier implements RollbackVerifier {
  constructor(private readonly world: ReferenceWorld) {}

  verify(deploymentId: string, expectedSourceSha: string): RollbackVerifierObservation {
    const deployment = this.world.deployments.get(deploymentId) ?? null;
    if (deployment === null) {
      return { verdict: 'UNKNOWN', observedSourceSha: null, limitation: `deployment ${deploymentId} was not observed` };
    }
    if (deployment.status !== 'ACTIVE') {
      return { verdict: 'FAILED', observedSourceSha: deployment.sourceSha, limitation: `deployment status is ${deployment.status}` };
    }
    if (deployment.sourceSha === expectedSourceSha) {
      return { verdict: 'VERIFIED', observedSourceSha: deployment.sourceSha, limitation: null };
    }
    return {
      verdict: 'FAILED',
      observedSourceSha: deployment.sourceSha,
      limitation: `observed ${deployment.sourceSha}, expected ${expectedSourceSha}`,
    };
  }
}
