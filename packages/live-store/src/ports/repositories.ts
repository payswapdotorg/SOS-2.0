/**
 * Repository ports (Work Order P2) — the durable, provider-neutral
 * repositories for the live product state.
 *
 * Support list (spec/productization-work-orders/P2-live-data-api.md):
 * Mission, Context, SystemState, Evidence, Architecture, Candidate,
 * Assurance, Experiment, Decision, AuthorityGrant, Package, history,
 * development state, task state, body lease state and observation events.
 *
 * RECORD SHAPES ARE THE OWNING PACKAGES' VERBATIM SHAPES: every repository
 * stores and returns the domain records exactly as the owning @sos-2/*
 * package defines them (validated by that package's own assert — consumed,
 * never reimplemented). Semantic ids and exact revisions are preserved —
 * never re-minted, never rewritten. The Semantic Spine remains the only
 * identity/serialization authority.
 *
 * Write semantics (identical for every repository — see results.ts):
 *   - identical write        -> IDENTICAL (no-op returning the stored record)
 *   - older revision         -> CONFLICT (STALE_REVISION, current revision)
 *   - expected-revision miss -> CONFLICT (REVISION_MISMATCH, current revision)
 *   - immutable id collision -> CONFLICT (IMMUTABLE_COLLISION)
 *   - otherwise              -> STORED
 */

import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import type { AssuranceCaseArtifact } from '@sos-2/assurance';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import type { CausalHypothesisArtifact } from '@sos-2/causal';
import type { ContextArtifact } from '@sos-2/context';
import type { DecisionRecord } from '@sos-2/decision';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { CandidateStateFixture, ExperimentArtifact } from '@sos-2/experiments';
import type { ArchitectureMemoryArtifact } from '@sos-2/memory';
import type { MissionArtifact } from '@sos-2/mission';
import type { PackageArtifact } from '@sos-2/packages';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { IngestEventOutcome, ListOptions, ListResult, PutOptions, PutResult } from '../results.js';
import type { BodyLeaseRecord } from '../records/body-lease.js';
import type { DevelopmentStateRecord } from '../records/development-state.js';
import type { ObservationEventInput, ObservationEventRecord } from '../records/observation-event.js';
import type { TaskArtifactRecord, TaskCheckpoint, TaskRecord, TaskVerificationRecord } from '../records/task.js';

/** The base repository contract every record family satisfies. */
export interface LiveRecordRepository<R> {
  /**
   * Write a record with idempotency and optimistic concurrency (typed
   * results — see results.ts; validation failures throw InvalidRecordError).
   */
  put(record: R, options?: PutOptions): Promise<PutResult<R>>;

  /** Fetch the record by id, or undefined when absent (verbatim shape). */
  get(id: string): Promise<R | undefined>;

  /** Deterministic list (ordered by record id), seek-paginated. */
  list(options?: ListOptions): Promise<ListResult<R>>;
}

/**
 * A repository of spine envelope artifacts (supersedes chains): revision
 * history is queryable from the durable chain (root -> head, over stored
 * rows; the walk stops honestly at a missing link).
 */
export interface RevisionedRecordRepository<R> extends LiveRecordRepository<R> {
  /**
   * The stored revision chain of an artifact, ordered root -> head. Only
   * STORED revisions appear (out-of-order/catch-up writes are accepted by
   * the durable store; the domain layer judges chain completeness).
   */
  history(id: string): Promise<R[]>;
}

export interface MissionRepository extends RevisionedRecordRepository<MissionArtifact> {}
export interface ContextRepository extends RevisionedRecordRepository<ContextArtifact> {}
export interface SystemStateRepository extends RevisionedRecordRepository<SystemStateArtifact> {}
export interface ArchitectureRepository extends RevisionedRecordRepository<ArchitectureGraphArtifact> {}
export interface CandidateRepository extends RevisionedRecordRepository<CandidateStateFixture> {}
export interface AssuranceRepository extends RevisionedRecordRepository<AssuranceCaseArtifact> {}
export interface ExperimentRepository extends RevisionedRecordRepository<ExperimentArtifact> {}
export interface DecisionRepository extends RevisionedRecordRepository<DecisionRecord> {}
export interface AuthorityGrantRepository extends RevisionedRecordRepository<AuthorityGrantArtifact> {}
export interface PackageRepository extends RevisionedRecordRepository<PackageArtifact> {}

/**
 * Evidence records are IMMUTABLE flat records (deterministic content
 * addressed ids, no revision): identical replay is a no-op; a different
 * record under an already-stored id is a typed IMMUTABLE_COLLISION.
 */
export interface EvidenceRepository extends LiveRecordRepository<EvidenceRecordW3> {}

/** History support: architecture memory and causal hypotheses. */
export interface MemoryHistoryRepository extends RevisionedRecordRepository<ArchitectureMemoryArtifact> {}
export interface CausalHypothesisRepository extends RevisionedRecordRepository<CausalHypothesisArtifact> {}

export interface HistoryRepository {
  /** Architecture memory artifacts (kind "ArchitectureMemory"). */
  readonly memories: MemoryHistoryRepository;
  /** Causal hypothesis artifacts (kind "CausalHypothesis"). */
  readonly hypotheses: CausalHypothesisRepository;
}

/** Development state snapshots (opaque, revisioned operational state). */
export interface DevelopmentStateRepository extends LiveRecordRepository<DevelopmentStateRecord> {}

/** Input for acquiring a body lease. */
export interface AcquireBodyLeaseInput {
  lease_id: string;
  task_ref: string;
  holder: string;
  body_id?: string | null;
  /** Lease expiry instant, RFC3339, or null for a non-expiring lease. */
  expires_at?: string | null;
}

/** Input for ending a body lease. */
export interface EndBodyLeaseInput {
  /** The end instant, RFC3339 (injected clock when omitted). */
  at?: string;
  reason: string;
}

/**
 * Body lease state: lease TRUTH is durable here (task durability survives
 * body loss); the coordination layer only mirrors liveness (never
 * canonical).
 */
export interface BodyLeaseRepository extends LiveRecordRepository<BodyLeaseRecord> {
  /**
   * Acquire a lease (single-use lease ids): a stored lease under the same
   * id is a typed conflict. Mirrors a coordination key in Redis (fast-path
   * liveness only).
   */
  acquire(input: AcquireBodyLeaseInput): Promise<PutResult<BodyLeaseRecord>>;

  /** Release an ACTIVE lease (terminal; never reactivates). */
  release(leaseId: string, input: EndBodyLeaseInput): Promise<PutResult<BodyLeaseRecord>>;

  /** Revoke an ACTIVE lease (terminal; never reactivates). */
  revoke(leaseId: string, input: EndBodyLeaseInput): Promise<PutResult<BodyLeaseRecord>>;

  /**
   * Transition every ACTIVE lease whose expiry has passed at the given
   * instant to EXPIRED (durable truth recomputed from records + clock —
   * works identically after a coordination flush). Returns the expired
   * leases in id order.
   */
  expireDue(nowEpochMs: number): Promise<BodyLeaseRecord[]>;
}

/**
 * Task state — the §6 task-durability shape. Checkpoints and the final
 * verification record append/update through revision-bumped writes; a body
 * crash, provider outage or user computer shutdown never erases the task.
 */
export interface TaskStateRepository extends LiveRecordRepository<TaskRecord> {
  /** Append a checkpoint to a task (revision-bumped, CAS-guarded). */
  appendCheckpoint(
    taskId: string,
    checkpoint: TaskCheckpoint,
    options?: PutOptions,
  ): Promise<PutResult<TaskRecord>>;

  /** Attach a produced artifact (content-addressed in the object store). */
  attachArtifact(
    taskId: string,
    artifact: TaskArtifactRecord,
    options?: PutOptions,
  ): Promise<PutResult<TaskRecord>>;

  /** Record the final verification record (revision-bumped, CAS-guarded). */
  recordVerification(
    taskId: string,
    verification: TaskVerificationRecord,
    options?: PutOptions,
  ): Promise<PutResult<TaskRecord>>;
}

/**
 * Observation events: ingestion with replay protection. Every event
 * carries an id; duplicate delivery is detected against the DURABLE event
 * index (the coordination layer is only a fast path) and answered with a
 * typed DUPLICATE record — never double-applied.
 */
export interface ObservationEventRepository {
  /** Ingest an event (idempotent by event id; replay-protected). */
  ingest(event: ObservationEventInput): Promise<IngestEventOutcome>;

  /**
   * Direct durable write of a stored observation event record (the
   * repair/restore path of PUT /observation). Events are IMMUTABLE flat
   * records: identical replay is a no-op; different content under a stored
   * id is a typed IMMUTABLE_COLLISION (expected_revision does not apply —
   * there is no revision).
   */
  put(record: ObservationEventRecord, options?: PutOptions): Promise<PutResult<ObservationEventRecord>>;

  /** The stored event by id, or undefined. */
  get(eventId: string): Promise<ObservationEventRecord | undefined>;

  /** All events, deterministic order by event id, seek-paginated. */
  list(options?: ListOptions): Promise<ListResult<ObservationEventRecord>>;

  /** Events of one source, deterministic order by event id, seek-paginated. */
  listBySource(source: string, options?: ListOptions): Promise<ListResult<ObservationEventRecord>>;
}
