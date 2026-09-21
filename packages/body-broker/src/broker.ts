/**
 * The Body Broker (Work Order P5) — the body pool + lease authority of
 * the Spirit/Body architecture (§1-§3).
 *
 * WHAT THE BROKER OWNS:
 *   - body registration and health lifecycle (AVAILABLE/SUSPENDED/
 *     RELEASED — release is terminal; a replacement registers under a
 *     NEW body id);
 *   - CAPABILITY-BASED selection from declared §3 advertisements — never
 *     vendor identity (see selection.ts);
 *   - BODY LEASES over the durable P2 BodyLeaseRepository (consumed):
 *     acquire / renew / release / revoke, with lease ids single-use and
 *     deterministic, and authorization FAIL CLOSED (see lease-gate.ts);
 *   - SUSPEND/REPLACE/RELEASE WITHOUT LOSING THE TASK: ending a lease
 *     never touches the durable TaskRecord — the task's identity is its
 *     task_id in the live store, never its body. replaceBodyLease ends
 *     the current lease and acquires a NEW single-use lease for the SAME
 *     task on a capability-selected replacement body.
 *
 * Lease truth is DURABLE (the P2 repository); the broker keeps only the
 * in-memory pool of live body connections (bodies are ephemeral by
 * design — §1). The injected clock drives every instant; no hidden time,
 * no randomness, no network, no process.env.
 */

import { BodyBrokerError, BodyUnavailableError, InvalidBodyRecordError } from './errors.js';
import { authorizeLeaseOperation } from './lease-gate.js';
import type { LeaseAuthorization, LeaseDenial } from './lease-gate.js';
import { selectBody } from './selection.js';
import type { BodySelectionRequirements, BodySelectionResult } from './selection.js';
import { transitionBodyHealth } from './body-health.js';
import type { BodyRegistration, RegisterBodyInput } from './body-identity.js';
import { assertValidBodyId, assertValidRegisterBodyInput } from './body-identity.js';
import type { HarnessContract } from '@sos-2/harness';
import { isLeaseExpiredAt } from '@sos-2/live-store';
import type { BodyLeaseRecord, BodyLeaseRepository, Clock, PutConflictReason, PutResult } from '@sos-2/live-store';
import { assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';

/** Broker dependencies: the durable lease repository + the injected clock. */
export interface BodyBrokerDeps {
  /** The durable body lease repository (P2 port — lease truth lives here). */
  readonly leases: BodyLeaseRepository;
  /** The injected clock (no hidden time). */
  readonly clock: Clock;
}

/** Input for acquiring a body lease through the broker. */
export interface AcquireLeaseInput {
  /** The task that will own the lease (execution-fabric task id). */
  readonly task_ref: string;
  /** The body to bind (must be registered and AVAILABLE). */
  readonly body_id: string;
  /** The acquiring principal (e.g. "execution-fabric"). */
  readonly holder: string;
  /** Lease expiry instant (RFC3339), or null for a non-expiring lease. */
  readonly expires_at: string | null;
}

/** Input for renewing a body lease (extending the expiry of a LIVE lease). */
export interface RenewLeaseInput {
  /** The new expiry instant (RFC3339). */
  readonly extend_to: string;
}

/** The typed outcome of a lease acquisition. */
export type LeaseAcquisition =
  | { readonly status: 'ACQUIRED'; readonly lease: BodyLeaseRecord }
  | {
      readonly status: 'DENIED';
      readonly denial: { readonly code: 'BODY_NOT_FOUND' | 'BODY_NOT_AVAILABLE'; readonly body_id: string; readonly reason: string };
    }
  | {
      readonly status: 'CONFLICT';
      readonly reason: PutConflictReason;
      readonly current_revision: number | null;
      readonly current_record: BodyLeaseRecord;
    };

/** The typed outcome of a lease renewal. */
export type LeaseRenewal =
  | { readonly status: 'RENEWED'; readonly lease: BodyLeaseRecord }
  | { readonly status: 'DENIED'; readonly denial: LeaseDenial }
  | {
      readonly status: 'CONFLICT';
      readonly current_revision: number | null;
      readonly current_record: BodyLeaseRecord;
      readonly reason: string;
    };

/** Input for replacing a task's body lease (the body replacement flow). */
export interface ReplaceBodyLeaseInput {
  /** The task whose body is being replaced (task identity is preserved). */
  readonly task_ref: string;
  /** The lease to end (must belong to the task). */
  readonly current_lease_id: string;
  /** Why the body is being replaced (recorded as the lease end reason). */
  readonly reason: string;
  /** Requirements for the replacement body; defaults to the current body's advertisement. */
  readonly requirements?: BodySelectionRequirements | null;
}

/** Denial of a body replacement. */
export type BodyReplacementDenial =
  | LeaseDenial
  | { readonly code: 'NO_BODY_AVAILABLE'; readonly lease_id: null; readonly lease_state: null; readonly reason: string };

/** The typed outcome of a body replacement. */
export type BodyReplacement =
  | {
      readonly status: 'REPLACED';
      /** The ended lease (terminal — single-use lease ids never reactivate). */
      readonly ended_lease: BodyLeaseRecord;
      /** The NEW lease for the SAME task on the replacement body. */
      readonly new_lease: BodyLeaseRecord;
      /** The replacement body. */
      readonly body: BodyRegistration;
    }
  | { readonly status: 'DENIED'; readonly denial: BodyReplacementDenial };

/** The outcome of suspending or releasing a body. */
export interface BodyLifecycleOutcome {
  /** The registration after the transition. */
  readonly registration: BodyRegistration;
  /** ACTIVE leases of the body that were ended (revoked on suspend, released on release). */
  readonly endedLeases: readonly BodyLeaseRecord[];
}

/**
 * THE BODY BROKER. One instance owns the live body pool of one SOS
 * process; lease truth is durable in the P2 repository.
 */
export class BodyBroker {
  private readonly leases: BodyLeaseRepository;
  private readonly clock: Clock;
  private readonly registrations = new Map<string, { registration: BodyRegistration; harness: HarnessContract }>();
  private readonly order: string[] = [];

  constructor(deps: BodyBrokerDeps) {
    if (typeof deps !== 'object' || deps === null || typeof deps.leases !== 'object' || deps.leases === null) {
      throw new BodyBrokerError('INVALID', 'BodyBroker requires a durable body lease repository (the P2 port)');
    }
    if (typeof deps.clock !== 'object' || deps.clock === null || typeof deps.clock.nowEpochMs !== 'function') {
      throw new BodyBrokerError('INVALID', 'BodyBroker requires an injected clock (no hidden time)');
    }
    this.leases = deps.leases;
    this.clock = deps.clock;
  }

  // -------------------------------------------------------------------------
  // Registration + health lifecycle
  // -------------------------------------------------------------------------

  /** Register a body (health AVAILABLE). Duplicate body ids are loud. */
  registerBody(input: RegisterBodyInput): BodyRegistration {
    assertValidRegisterBodyInput(input);
    if (this.registrations.has(input.body_id)) {
      throw new InvalidBodyRecordError(
        'body-registration',
        `body ${JSON.stringify(input.body_id)} is already registered — body ids are single-use within a broker (register a replacement under a new id after release)`,
      );
    }
    const registration: BodyRegistration = {
      body_id: input.body_id,
      provider: input.provider,
      capabilities: input.capabilities,
      placement: input.placement,
      health: 'AVAILABLE',
    };
    this.registrations.set(input.body_id, { registration, harness: input.harness });
    this.order.push(input.body_id);
    return structuredClone(registration);
  }

  /** The registration of a body, or undefined. */
  body(bodyId: string): BodyRegistration | undefined {
    const entry = this.registrations.get(bodyId);
    return entry === undefined ? undefined : structuredClone(entry.registration);
  }

  /** All registrations in registration order (deterministic). */
  bodies(): BodyRegistration[] {
    return this.order.map((id) => structuredClone(this.registrations.get(id)!.registration));
  }

  /** The live harness contract handle of a body (loud when unknown or released). */
  harnessFor(bodyId: string): HarnessContract {
    const entry = this.registrations.get(bodyId);
    if (entry === undefined) {
      throw new BodyUnavailableError(bodyId, `no body registered under ${JSON.stringify(bodyId)}`);
    }
    return entry.harness;
  }

  /**
   * Suspend a body: health AVAILABLE -> SUSPENDED and every ACTIVE lease
   * of the body is REVOKED (terminal). The TASK survives — its durable
   * TaskRecord is untouched; a replacement lease continues the task.
   */
  async suspendBody(bodyId: string, reason: string): Promise<BodyLifecycleOutcome> {
    return this.endBody(bodyId, reason, 'SUSPENDED', 'revoke', 'body-suspended');
  }

  /** Resume a suspended body (SUSPENDED -> AVAILABLE). */
  resumeBody(bodyId: string): BodyRegistration {
    const entry = this.registrations.get(bodyId);
    if (entry === undefined) {
      throw new BodyUnavailableError(bodyId, `no body registered under ${JSON.stringify(bodyId)}`);
    }
    const next = transitionBodyHealth(entry.registration.health, 'AVAILABLE');
    entry.registration = { ...entry.registration, health: next };
    return structuredClone(entry.registration);
  }

  /**
   * Release a body (terminal): health -> RELEASED and every ACTIVE lease
   * of the body is RELEASED. A released body never returns; a replacement
   * registers under a NEW body id.
   */
  async releaseBody(bodyId: string, reason: string): Promise<BodyLifecycleOutcome> {
    return this.endBody(bodyId, reason, 'RELEASED', 'release', 'body-released');
  }

  private async endBody(
    bodyId: string,
    reason: string,
    health: 'SUSPENDED' | 'RELEASED',
    leaseEnd: 'revoke' | 'release',
    reasonPrefix: string,
  ): Promise<BodyLifecycleOutcome> {
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new InvalidBodyRecordError('body-lifecycle', 'a body lifecycle transition requires a non-empty reason');
    }
    const entry = this.registrations.get(bodyId);
    if (entry === undefined) {
      throw new BodyUnavailableError(bodyId, `no body registered under ${JSON.stringify(bodyId)}`);
    }
    const nextHealth = transitionBodyHealth(entry.registration.health, health);
    const ended: BodyLeaseRecord[] = [];
    for (const lease of await this.activeLeasesOfBody(bodyId)) {
      const endInput = { reason: `${reasonPrefix}: ${reason}` };
      const result = leaseEnd === 'revoke' ? await this.leases.revoke(lease.lease_id, endInput) : await this.leases.release(lease.lease_id, endInput);
      if (result.kind === 'STORED' || result.kind === 'IDENTICAL') {
        ended.push(result.record);
      }
    }
    entry.registration = { ...entry.registration, health: nextHealth };
    return { registration: structuredClone(entry.registration), endedLeases: ended };
  }

  private async activeLeasesOfBody(bodyId: string): Promise<BodyLeaseRecord[]> {
    const all = await this.leases.list({ limit: null });
    return all.items
      .filter((lease) => lease.body_id === bodyId && lease.state === 'ACTIVE')
      .sort((a, b) => (a.lease_id < b.lease_id ? -1 : a.lease_id > b.lease_id ? 1 : 0));
  }

  // -------------------------------------------------------------------------
  // Selection (capability-based, vendor-blind)
  // -------------------------------------------------------------------------

  /** Select a body for requirements from the registered pool. */
  select(requirements: BodySelectionRequirements): BodySelectionResult {
    return selectBody(requirements, this.bodies());
  }

  // -------------------------------------------------------------------------
  // Leases (durable truth in the P2 repository; fail-closed authorization)
  // -------------------------------------------------------------------------

  /** The durable lease repository (for audits and direct terminal operations). */
  get leaseRepository(): BodyLeaseRepository {
    return this.leases;
  }

  /**
   * Acquire a lease binding a task to a registered, AVAILABLE body. Lease
   * ids are broker-generated, deterministic and single-use:
   * `lease:<task_ref>:<sequence>`.
   */
  async acquireLease(input: AcquireLeaseInput): Promise<LeaseAcquisition> {
    if (typeof input !== 'object' || input === null) {
      throw new InvalidBodyRecordError('lease-acquisition', 'lease acquisition input must be an object');
    }
    try {
      assertValidRuntimeIdentifier(input.task_ref, 'lease acquisition task_ref');
    } catch (cause) {
      throw new InvalidBodyRecordError('lease-acquisition', (cause as Error).message);
    }
    try {
      assertValidBodyId(input.body_id);
    } catch (cause) {
      throw new InvalidBodyRecordError('lease-acquisition', (cause as Error).message);
    }
    if (typeof input.holder !== 'string' || input.holder.length === 0) {
      throw new InvalidBodyRecordError('lease-acquisition', 'lease acquisition holder must be a non-empty string');
    }
    const entry = this.registrations.get(input.body_id);
    if (entry === undefined) {
      return {
        status: 'DENIED',
        denial: {
          code: 'BODY_NOT_FOUND',
          body_id: input.body_id,
          reason: `no body registered under ${JSON.stringify(input.body_id)} — the lease cannot bind`,
        },
      };
    }
    if (entry.registration.health !== 'AVAILABLE') {
      return {
        status: 'DENIED',
        denial: {
          code: 'BODY_NOT_AVAILABLE',
          body_id: input.body_id,
          reason: `body ${JSON.stringify(input.body_id)} is ${entry.registration.health} — only AVAILABLE bodies can be leased (fail closed)`,
        },
      };
    }
    const leaseId = await this.nextLeaseIdForTask(input.task_ref);
    const result = await this.leases.acquire({
      lease_id: leaseId,
      task_ref: input.task_ref,
      holder: input.holder,
      body_id: input.body_id,
      expires_at: input.expires_at,
    });
    if (result.kind === 'STORED') {
      return { status: 'ACQUIRED', lease: result.record };
    }
    if (result.kind === 'IDENTICAL') {
      // Single-use lease ids make this a same-content replay under the
      // generated id — surface as an acquisition of the stored lease.
      return { status: 'ACQUIRED', lease: result.record };
    }
    return {
      status: 'CONFLICT',
      reason: result.reason,
      current_revision: result.current_revision,
      current_record: result.current_record,
    };
  }

  /**
   * Renew a LIVE lease: extend its expiry. FAIL CLOSED — a lease whose
   * expiry has passed (even if the durable record is still ACTIVE) is
   * DENIED: an expired lease never reauthorizes, not even its own
   * renewal. The write is CAS-guarded.
   */
  async renewLease(leaseId: string, input: RenewLeaseInput): Promise<LeaseRenewal> {
    const current = await this.leases.get(leaseId);
    if (current === undefined) {
      return {
        status: 'DENIED',
        denial: {
          code: 'LEASE_NOT_FOUND',
          lease_id: leaseId,
          lease_state: null,
          reason: `lease ${JSON.stringify(leaseId)} is not in the durable lease store — an unknown lease cannot be renewed`,
        },
      };
    }
    // Fail-closed gate consumed from the lease gate module.
    const authorization = await authorizeLeaseOperation(this.leases, {
      lease_id: leaseId,
      task_ref: current.task_ref,
      body_id: null,
      nowEpochMs: this.clock.nowEpochMs(),
    });
    if (!authorization.authorized) {
      return { status: 'DENIED', denial: authorization.denial };
    }
    const updated: BodyLeaseRecord = {
      ...structuredClone(current),
      expires_at: input.extend_to,
      revision: current.revision + 1,
    };
    const result = await this.leases.put(updated, { expected_revision: current.revision });
    if (result.kind === 'STORED') {
      return { status: 'RENEWED', lease: result.record };
    }
    if (result.kind === 'IDENTICAL') {
      return { status: 'RENEWED', lease: result.record };
    }
    return {
      status: 'CONFLICT',
      current_revision: result.current_revision,
      current_record: result.current_record,
      reason: `lease renewal lost the CAS race (concurrent writer bumped the revision): ${result.reason}`,
    };
  }

  /** End a lease by RELEASE (terminal; loud when the lease is not ACTIVE). */
  async releaseLease(leaseId: string, reason: string): Promise<PutResult<BodyLeaseRecord>> {
    return this.leases.release(leaseId, { reason });
  }

  /** End a lease by REVOCATION (terminal; loud when the lease is not ACTIVE). */
  async revokeLease(leaseId: string, reason: string): Promise<PutResult<BodyLeaseRecord>> {
    return this.leases.revoke(leaseId, { reason });
  }

  /** The FAIL-CLOSED operation gate (see lease-gate.ts). */
  async authorizeOperation(request: { lease_id: string; task_ref: string; body_id: string | null }): Promise<LeaseAuthorization> {
    return authorizeLeaseOperation(this.leases, { ...request, nowEpochMs: this.clock.nowEpochMs() });
  }

  /** Every lease ever taken for a task, in lease-id order (audit). */
  async leasesForTask(taskRef: string): Promise<BodyLeaseRecord[]> {
    try {
      assertValidRuntimeIdentifier(taskRef, 'task ref');
    } catch (cause) {
      throw new InvalidBodyRecordError('lease-audit', (cause as Error).message);
    }
    const all = await this.leases.list({ limit: null });
    return all.items
      .filter((lease) => lease.task_ref === taskRef)
      .sort((a, b) => (a.lease_id < b.lease_id ? -1 : a.lease_id > b.lease_id ? 1 : 0));
  }

  /**
   * Is the task's CURRENT lease live right now? (Recomputed from the
   * durable record + the injected clock — never a mirror.)
   */
  async isLeaseLive(leaseId: string): Promise<boolean> {
    const lease = await this.leases.get(leaseId);
    if (lease === undefined || lease.state !== 'ACTIVE') {
      return false;
    }
    return !isLeaseExpiredAt(lease, this.clock.nowEpochMs());
  }

  // -------------------------------------------------------------------------
  // Body replacement (the task survives)
  // -------------------------------------------------------------------------

  /**
   * Replace a task's body lease WITHOUT losing the task: end the current
   * lease (REVOKED, terminal), select a replacement body by requirements
   * (default: the current body's own advertisement) and acquire a NEW
   * single-use lease for the SAME task. The durable TaskRecord — the
   * task's identity — is never touched by the broker.
   */
  async replaceBodyLease(input: ReplaceBodyLeaseInput): Promise<BodyReplacement> {
    if (typeof input !== 'object' || input === null) {
      throw new InvalidBodyRecordError('body-replacement', 'body replacement input must be an object');
    }
    if (typeof input.reason !== 'string' || input.reason.length === 0) {
      throw new InvalidBodyRecordError('body-replacement', 'body replacement requires a non-empty reason');
    }
    const current = await this.leases.get(input.current_lease_id);
    if (current === undefined) {
      return {
        status: 'DENIED',
        denial: {
          code: 'LEASE_NOT_FOUND',
          lease_id: input.current_lease_id,
          lease_state: null,
          reason: `lease ${JSON.stringify(input.current_lease_id)} is not in the durable lease store`,
        },
      };
    }
    if (current.task_ref !== input.task_ref) {
      return {
        status: 'DENIED',
        denial: {
          code: 'LEASE_WRONG_TASK',
          lease_id: input.current_lease_id,
          lease_state: current.state,
          reason: `lease ${JSON.stringify(input.current_lease_id)} belongs to task ${JSON.stringify(current.task_ref)}, not ${JSON.stringify(input.task_ref)}`,
        },
      };
    }

    // Requirements: explicit, or the current body's own advertisement.
    let requirements = input.requirements ?? null;
    if (requirements === null && current.body_id !== null) {
      const currentBody = this.registrations.get(current.body_id);
      if (currentBody !== undefined) {
        requirements = {
          requiredCapabilities: currentBody.registration.capabilities.capabilities,
          placement: currentBody.registration.placement,
        };
      }
    }
    if (requirements === null) {
      requirements = { requiredCapabilities: ['terminal', 'filesystem'], placement: null };
    }

    // Select the replacement FIRST (fail closed: no replacement body => no
    // lease ending — the task keeps its current lease when replacement is
    // impossible).
    const selection = this.select(requirements);
    if (selection.status === 'NO_BODY_AVAILABLE') {
      return {
        status: 'DENIED',
        denial: { code: 'NO_BODY_AVAILABLE', lease_id: null, lease_state: null, reason: selection.reason },
      };
    }

    // End the current lease when it is still ACTIVE. An ALREADY-ENDED
    // lease (the body was killed/suspended first — the "kill mid-task"
    // flow) is carried as-is: the end already happened durably, and the
    // replacement proceeds (idempotent replacement).
    let endedLease: BodyLeaseRecord;
    if (current.state === 'ACTIVE') {
      const ended = await this.leases.revoke(input.current_lease_id, {
        reason: `body-replacement: ${input.reason}`,
      });
      if (ended.kind === 'CONFLICT') {
        throw new BodyBrokerError(
          'UNKNOWN',
          `ending lease ${JSON.stringify(input.current_lease_id)} failed with ${ended.reason} — replacement aborted, the lease stands as stored`,
        );
      }
      endedLease = ended.record;
    } else {
      endedLease = current;
    }

    // Acquire the NEW single-use lease for the SAME task.
    const acquisition = await this.acquireLease({
      task_ref: input.task_ref,
      body_id: selection.body.body_id,
      holder: current.holder,
      expires_at: current.expires_at,
    });
    if (acquisition.status !== 'ACQUIRED') {
      throw new BodyBrokerError(
        'UNKNOWN',
        `replacing body for task ${JSON.stringify(input.task_ref)} ended the old lease but could not acquire the new one (${JSON.stringify(acquisition)}) — the task survives; retry replacement`,
      );
    }

    return {
      status: 'REPLACED',
      ended_lease: endedLease,
      new_lease: acquisition.lease,
      body: selection.body,
    };
  }

  private async nextLeaseIdForTask(taskRef: string): Promise<string> {
    const existing = await this.leasesForTask(taskRef);
    return `lease:${taskRef}:${String(existing.length + 1).padStart(4, '0')}`;
  }
}
