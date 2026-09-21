/**
 * The in-memory reference repositories (Work Order P2) — the complete
 * reference implementation of the repository ports over the provider-port
 * adapters (InMemoryPostgresStoreAdapter as the durable canonical store,
 * InMemoryRedisCoordinationAdapter as the never-canonical coordination
 * layer, InMemoryObjectStoreAdapter for content-addressed artifacts).
 *
 * Every repository delegates its semantic discipline to ONE engine
 * (record-engine.ts) and its VALIDATION to the OWNING PACKAGE's assert —
 * consumed verbatim, never reimplemented. The record shapes below are the
 * owning packages' shapes, stored and returned verbatim.
 *
 * Real Neon/Upstash/R2 adapters attach later behind the same ports WITHOUT
 * contract change: these classes never touch provider specifics.
 */

import { assertValidArchitectureGraphArtifact } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { assertValidAssuranceCase } from '@sos-2/assurance';
import type { AssuranceCaseArtifact } from '@sos-2/assurance';
import { assertValidGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { assertValidCausalHypothesis } from '@sos-2/causal';
import type { CausalHypothesisArtifact } from '@sos-2/causal';
import { assertValidContext } from '@sos-2/context';
import type { ContextArtifact, ContextDimensionRegistry } from '@sos-2/context';
import { assertValidDecisionRecord } from '@sos-2/decision';
import type { DecisionRecord } from '@sos-2/decision';
import { assertValidEvidenceRecord } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { assertValidCandidateState, assertValidExperiment } from '@sos-2/experiments';
import type { CandidateStateFixture, ExperimentArtifact } from '@sos-2/experiments';
import { assertValidArchitectureMemory } from '@sos-2/memory';
import type { ArchitectureMemoryArtifact } from '@sos-2/memory';
import { assertValidMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { assertValidPackageArtifact } from '@sos-2/packages';
import type { PackageArtifact } from '@sos-2/packages';
import type { ArtifactEnvelope, JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { assertValidSystemStateArtifact } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { InvalidRecordError, UnknownStoreError } from '../errors.js';
import type {
  PostgresStoreAdapter,
  RedisCoordinationAdapter,
} from '../ports/provider-adapters.js';
import type {
  AcquireBodyLeaseInput,
  AuthorityGrantRepository,
  ArchitectureRepository,
  AssuranceRepository,
  BodyLeaseRepository,
  CandidateRepository,
  ContextRepository,
  DecisionRepository,
  DevelopmentStateRepository,
  EndBodyLeaseInput,
  EvidenceRepository,
  ExperimentRepository,
  HistoryRepository,
  LiveRecordRepository,
  MemoryHistoryRepository,
  MissionRepository,
  CausalHypothesisRepository,
  ObservationEventRepository,
  PackageRepository,
  RevisionedRecordRepository,
  SystemStateRepository,
  TaskStateRepository,
} from '../ports/repositories.js';
import type {
  IngestEventOutcome,
  ListOptions,
  ListResult,
  PutOptions,
  PutResult,
} from '../results.js';
import type { RecordDescriptor } from './record-engine.js';
import type { DevelopmentStateRecord } from '../records/development-state.js';
import { assertValidDevelopmentStateRecord, DEVELOPMENT_STATE_NAMESPACE } from '../records/development-state.js';
import type { BodyLeaseRecord } from '../records/body-lease.js';
import { assertValidBodyLeaseRecord, isLeaseExpiredAt, BODY_LEASE_NAMESPACE } from '../records/body-lease.js';
import type { ObservationEventInput, ObservationEventRecord } from '../records/observation-event.js';
import {
  assertValidObservationEventInput,
  assertValidObservationEventRecord,
  OBSERVATION_EVENT_NAMESPACE,
} from '../records/observation-event.js';
import type { TaskRecord } from '../records/task.js';
import { assertValidTaskRecord, TASK_NAMESPACE } from '../records/task.js';
import type { Clock } from '../clock.js';
import { formatRfc3339 } from '../clock.js';
import { RevisionedRecordEngine } from './record-engine.js';

// ─── namespaces (durable table analogues) ──────────────────────────────────

export const MISSION_NAMESPACE = 'mission';
export const CONTEXT_NAMESPACE = 'context';
export const SYSTEM_STATE_NAMESPACE = 'system-state';
export const EVIDENCE_NAMESPACE = 'evidence';
export const ARCHITECTURE_NAMESPACE = 'architecture';
export const CANDIDATE_NAMESPACE = 'candidate';
export const ASSURANCE_NAMESPACE = 'assurance';
export const EXPERIMENT_NAMESPACE = 'experiment';
export const DECISION_NAMESPACE = 'decision';
export const AUTHORITY_GRANT_NAMESPACE = 'authority-grant';
export const PACKAGE_NAMESPACE = 'package';
export const ARCHITECTURE_MEMORY_NAMESPACE = 'architecture-memory';
export const CAUSAL_HYPOTHESIS_NAMESPACE = 'causal-hypothesis';

// ─── descriptors ───────────────────────────────────────────────────────────

function envelopeDescriptor<R extends { envelope: ArtifactEnvelope }>(
  namespace: string,
  validate: (value: unknown) => asserts value is R,
): RecordDescriptor<R> {
  return {
    namespace,
    validate,
    idOf: (record) => record.envelope.id,
    revisionOf: (record) => record.envelope.version,
    supersedesOf: (record) => record.envelope.supersedes,
  };
}

function flatImmutableDescriptor<R extends { id: string }>(
  namespace: string,
  validate: (value: unknown) => asserts value is R,
): RecordDescriptor<R> {
  return {
    namespace,
    validate,
    idOf: (record) => record.id,
    revisionOf: () => null,
  };
}

function revisionedFlatDescriptor<R extends { revision: number }>(
  namespace: string,
  validate: (value: unknown) => asserts value is R,
  idOf: (record: R) => string,
): RecordDescriptor<R> {
  return {
    namespace,
    validate,
    idOf,
    revisionOf: (record) => record.revision,
  };
}

function missionValidate(value: unknown): asserts value is MissionArtifact {
  assertValidMission(value);
}

function systemStateValidate(value: unknown): asserts value is SystemStateArtifact {
  assertValidSystemStateArtifact(value);
}

function architectureValidate(value: unknown): asserts value is ArchitectureGraphArtifact {
  assertValidArchitectureGraphArtifact(value);
}

function candidateValidate(value: unknown): asserts value is CandidateStateFixture {
  assertValidCandidateState(value);
}

function assuranceValidate(value: unknown): asserts value is AssuranceCaseArtifact {
  assertValidAssuranceCase(value);
}

function experimentValidate(value: unknown): asserts value is ExperimentArtifact {
  assertValidExperiment(value);
}

function decisionValidate(value: unknown): asserts value is DecisionRecord {
  assertValidDecisionRecord(value);
}

function grantValidate(value: unknown): asserts value is AuthorityGrantArtifact {
  assertValidGrant(value);
}

function packageValidate(value: unknown): asserts value is PackageArtifact {
  assertValidPackageArtifact(value);
}

function memoryValidate(value: unknown): asserts value is ArchitectureMemoryArtifact {
  assertValidArchitectureMemory(value);
}

function hypothesisValidate(value: unknown): asserts value is CausalHypothesisArtifact {
  assertValidCausalHypothesis(value);
}

function evidenceValidate(value: unknown): asserts value is EvidenceRecordW3 {
  assertValidEvidenceRecord(value);
}

function taskValidate(value: unknown): asserts value is TaskRecord {
  assertValidTaskRecord(value);
}

function leaseValidate(value: unknown): asserts value is BodyLeaseRecord {
  assertValidBodyLeaseRecord(value);
}

function developmentStateValidate(value: unknown): asserts value is DevelopmentStateRecord {
  assertValidDevelopmentStateRecord(value);
}

function makeContextValidate(
  registry?: ContextDimensionRegistry,
): (value: unknown) => asserts value is ContextArtifact {
  return function contextValidate(value: unknown): asserts value is ContextArtifact {
    assertValidContext(value, registry);
  };
}

// ─── generic engine-backed repositories ────────────────────────────────────

class EngineRevisionedRepository<R> implements RevisionedRecordRepository<R> {
  protected readonly engine: RevisionedRecordEngine<R>;

  constructor(deps: {
    durable: PostgresStoreAdapter;
    coordination?: RedisCoordinationAdapter | null;
    descriptor: RecordDescriptor<R>;
  }) {
    this.engine = new RevisionedRecordEngine<R>(deps);
  }

  put(record: R, options?: PutOptions): Promise<PutResult<R>> {
    return this.engine.put(record, options);
  }

  get(id: string): Promise<R | undefined> {
    return this.engine.get(id);
  }

  list(options?: ListOptions): Promise<ListResult<R>> {
    return this.engine.list(options);
  }

  history(id: string): Promise<R[]> {
    return this.engine.history(id);
  }
}

class EngineFlatRepository<R> implements LiveRecordRepository<R> {
  protected readonly engine: RevisionedRecordEngine<R>;

  constructor(deps: {
    durable: PostgresStoreAdapter;
    coordination?: RedisCoordinationAdapter | null;
    descriptor: RecordDescriptor<R>;
  }) {
    this.engine = new RevisionedRecordEngine<R>(deps);
  }

  put(record: R, options?: PutOptions): Promise<PutResult<R>> {
    return this.engine.put(record, options);
  }

  get(id: string): Promise<R | undefined> {
    return this.engine.get(id);
  }

  list(options?: ListOptions): Promise<ListResult<R>> {
    return this.engine.list(options);
  }
}

export class InMemoryMissionRepository
  extends EngineRevisionedRepository<MissionArtifact>
  implements MissionRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(MISSION_NAMESPACE, missionValidate) });
  }
}

export class InMemorySystemStateRepository
  extends EngineRevisionedRepository<SystemStateArtifact>
  implements SystemStateRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(SYSTEM_STATE_NAMESPACE, systemStateValidate) });
  }
}

export class InMemoryArchitectureRepository
  extends EngineRevisionedRepository<ArchitectureGraphArtifact>
  implements ArchitectureRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(ARCHITECTURE_NAMESPACE, architectureValidate) });
  }
}

export class InMemoryCandidateRepository
  extends EngineRevisionedRepository<CandidateStateFixture>
  implements CandidateRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(CANDIDATE_NAMESPACE, candidateValidate) });
  }
}

export class InMemoryAssuranceRepository
  extends EngineRevisionedRepository<AssuranceCaseArtifact>
  implements AssuranceRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(ASSURANCE_NAMESPACE, assuranceValidate) });
  }
}

export class InMemoryExperimentRepository
  extends EngineRevisionedRepository<ExperimentArtifact>
  implements ExperimentRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(EXPERIMENT_NAMESPACE, experimentValidate) });
  }
}

export class InMemoryDecisionRepository
  extends EngineRevisionedRepository<DecisionRecord>
  implements DecisionRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(DECISION_NAMESPACE, decisionValidate) });
  }
}

export class InMemoryAuthorityGrantRepository
  extends EngineRevisionedRepository<AuthorityGrantArtifact>
  implements AuthorityGrantRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(AUTHORITY_GRANT_NAMESPACE, grantValidate) });
  }
}

export class InMemoryPackageRepository
  extends EngineRevisionedRepository<PackageArtifact>
  implements PackageRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(PACKAGE_NAMESPACE, packageValidate) });
  }
}

export class InMemoryMemoryHistoryRepository
  extends EngineRevisionedRepository<ArchitectureMemoryArtifact>
  implements MemoryHistoryRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(ARCHITECTURE_MEMORY_NAMESPACE, memoryValidate) });
  }
}

export class InMemoryCausalHypothesisRepository
  extends EngineRevisionedRepository<CausalHypothesisArtifact>
  implements CausalHypothesisRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: envelopeDescriptor(CAUSAL_HYPOTHESIS_NAMESPACE, hypothesisValidate) });
  }
}

/** Evidence: immutable flat records (deterministic content-addressed ids). */
export class InMemoryEvidenceRepository
  extends EngineFlatRepository<EvidenceRecordW3>
  implements EvidenceRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({ durable: deps.durable, coordination: deps.coordination, descriptor: flatImmutableDescriptor(EVIDENCE_NAMESPACE, evidenceValidate) });
  }
}

/** Development state: opaque revisioned snapshots. */
export class InMemoryDevelopmentStateRepository
  extends EngineFlatRepository<DevelopmentStateRecord>
  implements DevelopmentStateRepository
{
  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    super({
      durable: deps.durable,
      coordination: deps.coordination,
      descriptor: revisionedFlatDescriptor(DEVELOPMENT_STATE_NAMESPACE, developmentStateValidate, (record) => record.state_id),
    });
  }
}

/** Context artifacts (validated against the configured dimension registry). */
export class InMemoryContextRepository implements ContextRepository {
  private readonly engine: RevisionedRecordEngine<ContextArtifact>;

  constructor(deps: {
    durable: PostgresStoreAdapter;
    coordination?: RedisCoordinationAdapter | null;
    registry?: ContextDimensionRegistry;
  }) {
    this.engine = new RevisionedRecordEngine<ContextArtifact>({
      durable: deps.durable,
      coordination: deps.coordination,
      descriptor: envelopeDescriptor(CONTEXT_NAMESPACE, makeContextValidate(deps.registry)),
    });
  }

  put(record: ContextArtifact, options?: PutOptions): Promise<PutResult<ContextArtifact>> {
    return this.engine.put(record, options);
  }

  get(id: string): Promise<ContextArtifact | undefined> {
    return this.engine.get(id);
  }

  list(options?: ListOptions): Promise<ListResult<ContextArtifact>> {
    return this.engine.list(options);
  }

  history(id: string): Promise<ContextArtifact[]> {
    return this.engine.history(id);
  }
}

/** History support: memory artifacts + causal hypotheses. */
export class InMemoryHistoryRepository implements HistoryRepository {
  readonly memories: MemoryHistoryRepository;
  readonly hypotheses: CausalHypothesisRepository;

  constructor(deps: { durable: PostgresStoreAdapter; coordination?: RedisCoordinationAdapter | null }) {
    this.memories = new InMemoryMemoryHistoryRepository({
      durable: deps.durable,
      coordination: deps.coordination,
    });
    this.hypotheses = new InMemoryCausalHypothesisRepository({
      durable: deps.durable,
      coordination: deps.coordination,
    });
  }
}

// ─── task state (the §6 durability shape) ──────────────────────────────────

export class InMemoryTaskStateRepository implements TaskStateRepository {
  private readonly engine: RevisionedRecordEngine<TaskRecord>;
  private readonly clock: Clock;

  constructor(deps: {
    durable: PostgresStoreAdapter;
    coordination?: RedisCoordinationAdapter | null;
    clock: Clock;
  }) {
    this.engine = new RevisionedRecordEngine<TaskRecord>({
      durable: deps.durable,
      coordination: deps.coordination,
      descriptor: revisionedFlatDescriptor(TASK_NAMESPACE, taskValidate, (record) => record.task_id),
    });
    this.clock = deps.clock;
  }

  put(record: TaskRecord, options?: PutOptions): Promise<PutResult<TaskRecord>> {
    return this.engine.put(record, options);
  }

  get(id: string): Promise<TaskRecord | undefined> {
    return this.engine.get(id);
  }

  list(options?: ListOptions): Promise<ListResult<TaskRecord>> {
    return this.engine.list(options);
  }

  private async mutate(
    taskId: string,
    mutate: (current: TaskRecord) => TaskRecord,
    options?: PutOptions,
  ): Promise<PutResult<TaskRecord>> {
    const current = await this.engine.get(taskId);
    if (current === undefined) {
      throw new UnknownStoreError(`unknown task id: ${JSON.stringify(taskId)} (cannot append to a task that is not stored)`);
    }
    const updated = mutate(structuredClone(current));
    updated.updated_at = formatRfc3339(this.clock.nowEpochMs());
    return this.engine.put(updated, {
      expected_revision: options?.expected_revision ?? current.revision,
    });
  }

  appendCheckpoint(taskId: string, checkpoint: TaskRecord['checkpoints'][number], options?: PutOptions): Promise<PutResult<TaskRecord>> {
    return this.mutate(
      taskId,
      (current) => {
        const updated: TaskRecord = {
          ...current,
          checkpoints: [...current.checkpoints, structuredClone(checkpoint)],
          revision: current.revision + 1,
        };
        assertValidTaskRecord(updated);
        return updated;
      },
      options,
    );
  }

  attachArtifact(taskId: string, artifact: TaskRecord['artifacts'][number], options?: PutOptions): Promise<PutResult<TaskRecord>> {
    return this.mutate(
      taskId,
      (current) => {
        const updated: TaskRecord = {
          ...current,
          artifacts: [...current.artifacts, structuredClone(artifact)],
          revision: current.revision + 1,
        };
        assertValidTaskRecord(updated);
        return updated;
      },
      options,
    );
  }

  recordVerification(taskId: string, verification: TaskRecord['final_verification'], options?: PutOptions): Promise<PutResult<TaskRecord>> {
    return this.mutate(
      taskId,
      (current) => {
        const updated: TaskRecord = {
          ...current,
          final_verification: structuredClone(verification),
          revision: current.revision + 1,
        };
        assertValidTaskRecord(updated);
        return updated;
      },
      options,
    );
  }
}

// ─── body leases (durable truth + coordination mirror) ─────────────────────

export class InMemoryBodyLeaseRepository implements BodyLeaseRepository {
  private readonly engine: RevisionedRecordEngine<BodyLeaseRecord>;
  private readonly coordination: RedisCoordinationAdapter | null;
  private readonly clock: Clock;

  constructor(deps: {
    durable: PostgresStoreAdapter;
    coordination?: RedisCoordinationAdapter | null;
    clock: Clock;
  }) {
    this.engine = new RevisionedRecordEngine<BodyLeaseRecord>({
      durable: deps.durable,
      coordination: deps.coordination,
      descriptor: revisionedFlatDescriptor(BODY_LEASE_NAMESPACE, leaseValidate, (record) => record.lease_id),
    });
    this.coordination = deps.coordination ?? null;
    this.clock = deps.clock;
  }

  put(record: BodyLeaseRecord, options?: PutOptions): Promise<PutResult<BodyLeaseRecord>> {
    return this.engine.put(record, options);
  }

  get(id: string): Promise<BodyLeaseRecord | undefined> {
    return this.engine.get(id);
  }

  list(options?: ListOptions): Promise<ListResult<BodyLeaseRecord>> {
    return this.engine.list(options);
  }

  private async mirrorAcquire(lease: BodyLeaseRecord): Promise<void> {
    if (this.coordination === null) {
      return;
    }
    const expiresAtEpochMs = lease.expires_at === null ? null : Date.parse(lease.expires_at);
    try {
      await this.coordination.leaseAcquire(`lease:${lease.lease_id}`, lease.holder, expiresAtEpochMs);
    } catch {
      // The coordination layer is a best-effort mirror — never canonical.
    }
  }

  private async mirrorRelease(leaseId: string, holder: string): Promise<void> {
    if (this.coordination === null) {
      return;
    }
    try {
      await this.coordination.leaseRelease(`lease:${leaseId}`, holder);
    } catch {
      // Never canonical.
    }
  }

  async acquire(input: AcquireBodyLeaseInput): Promise<PutResult<BodyLeaseRecord>> {
    if (typeof input !== 'object' || input === null) {
      throw new InvalidRecordError(BODY_LEASE_NAMESPACE, 'lease acquire input must be an object');
    }
    const record: BodyLeaseRecord = {
      lease_id: input.lease_id,
      task_ref: input.task_ref,
      body_id: input.body_id ?? null,
      holder: input.holder,
      state: 'ACTIVE',
      acquired_at: formatRfc3339(this.clock.nowEpochMs()),
      expires_at: input.expires_at ?? null,
      released_at: null,
      release_reason: null,
      revision: 1,
    };
    assertValidBodyLeaseRecord(record);
    // Lease ids are single-use: acquiring under a stored id is a typed
    // conflict (expected_revision 0 never matches a stored revision).
    const result = await this.engine.put(record, { expected_revision: 0 });
    if (result.kind === 'STORED') {
      await this.mirrorAcquire(record);
    } else if (result.kind === 'IDENTICAL') {
      await this.mirrorAcquire(result.record);
    }
    return result;
  }

  private async end(leaseId: string, state: 'RELEASED' | 'REVOKED', input: EndBodyLeaseInput): Promise<PutResult<BodyLeaseRecord>> {
    const current = await this.engine.get(leaseId);
    if (current === undefined) {
      throw new UnknownStoreError(`unknown lease id: ${JSON.stringify(leaseId)}`);
    }
    if (current.state !== 'ACTIVE') {
      throw new InvalidRecordError(
        BODY_LEASE_NAMESPACE,
        `cannot ${state === 'RELEASED' ? 'release' : 'revoke'} lease ${JSON.stringify(leaseId)} in terminal state ${current.state} (an ended lease never reactivates)`,
      );
    }
    const at = input.at ?? formatRfc3339(this.clock.nowEpochMs());
    const updated: BodyLeaseRecord = {
      ...current,
      state,
      released_at: at,
      release_reason: input.reason,
      revision: current.revision + 1,
    };
    assertValidBodyLeaseRecord(updated);
    const result = await this.engine.put(updated, { expected_revision: current.revision });
    if (result.kind !== 'CONFLICT') {
      await this.mirrorRelease(leaseId, current.holder);
    }
    return result;
  }

  release(leaseId: string, input: EndBodyLeaseInput): Promise<PutResult<BodyLeaseRecord>> {
    return this.end(leaseId, 'RELEASED', input);
  }

  revoke(leaseId: string, input: EndBodyLeaseInput): Promise<PutResult<BodyLeaseRecord>> {
    return this.end(leaseId, 'REVOKED', input);
  }

  async expireDue(nowEpochMs: number): Promise<BodyLeaseRecord[]> {
    const { items } = await this.engine.list({ limit: null });
    const expired: BodyLeaseRecord[] = [];
    for (const lease of items) {
      if (lease.state !== 'ACTIVE' || !isLeaseExpiredAt(lease, nowEpochMs)) {
        continue;
      }
      const updated: BodyLeaseRecord = {
        ...lease,
        state: 'EXPIRED',
        released_at: formatRfc3339(nowEpochMs),
        release_reason: 'lease expired',
        revision: lease.revision + 1,
      };
      const result = await this.engine.put(updated, { expected_revision: lease.revision });
      if (result.kind !== 'CONFLICT') {
        await this.mirrorRelease(lease.lease_id, lease.holder);
        expired.push(result.kind === 'STORED' ? result.record : lease);
      }
    }
    return expired.sort((a, b) => (a.lease_id < b.lease_id ? -1 : a.lease_id > b.lease_id ? 1 : 0));
  }
}

// ─── observation events (replay-protected ingestion) ───────────────────────

export class InMemoryObservationEventRepository implements ObservationEventRepository {
  private readonly durable: PostgresStoreAdapter;
  private readonly coordination: RedisCoordinationAdapter | null;
  private readonly clock: Clock;

  constructor(deps: {
    durable: PostgresStoreAdapter;
    coordination?: RedisCoordinationAdapter | null;
    clock: Clock;
  }) {
    this.durable = deps.durable;
    this.coordination = deps.coordination ?? null;
    this.clock = deps.clock;
  }

  private idempotencyKey(eventId: string): string {
    return `event:${eventId}`;
  }

  private async markIdempotency(eventId: string): Promise<void> {
    if (this.coordination === null) {
      return;
    }
    try {
      await this.coordination.idempotencyMark(this.idempotencyKey(eventId));
    } catch {
      // Acceleration only — the durable index is the authority.
    }
  }

  private async validateStored(data: unknown): Promise<ObservationEventRecord> {
    try {
      assertValidObservationEventRecord(data);
    } catch (cause) {
      throw new UnknownStoreError(`stored observation event failed validation: ${(cause as Error).message}`);
    }
    return data as ObservationEventRecord;
  }

  async put(record: ObservationEventRecord, options?: PutOptions): Promise<PutResult<ObservationEventRecord>> {
    void options; // Immutable flat records carry no revision — CAS does not apply.
    assertValidObservationEventRecord(record);
    const existing = await this.durable.getRow(OBSERVATION_EVENT_NAMESPACE, record.id);
    if (existing !== null) {
      const stored = await this.validateStored(existing.data);
      if (canonicalSerialize(stored) === canonicalSerialize(record)) {
        return { kind: 'IDENTICAL', record: structuredClone(stored) };
      }
      return {
        kind: 'CONFLICT',
        reason: 'IMMUTABLE_COLLISION',
        id: record.id,
        current_revision: null,
        current_record: structuredClone(stored),
      };
    }
    const inserted = await this.durable.putRow(
      OBSERVATION_EVENT_NAMESPACE,
      record.id,
      record as unknown as JsonValue,
      { if_absent: true },
    );
    if (inserted.ok) {
      await this.markIdempotency(record.id);
      return { kind: 'STORED', record: structuredClone(record) };
    }
    // Lost the insert race: the winner's record decides the typed conflict.
    const row = await this.durable.getRow(OBSERVATION_EVENT_NAMESPACE, record.id);
    if (row === null) {
      throw new UnknownStoreError(`durable event index reported an existing row for ${JSON.stringify(record.id)} but cannot read it`);
    }
    const stored = await this.validateStored(row.data);
    return {
      kind: 'CONFLICT',
      reason: 'IMMUTABLE_COLLISION',
      id: record.id,
      current_revision: null,
      current_record: structuredClone(stored),
    };
  }

  async ingest(event: ObservationEventInput): Promise<IngestEventOutcome> {
    assertValidObservationEventInput(event);

    // Fast path ONLY (never authoritative): a coordination-layer "seen" is
    // advisory; the DURABLE index decides. (A flushed or stale Redis can
    // never reject a first delivery — that would make it canonical.)
    const durableRow = await this.durable.getRow(OBSERVATION_EVENT_NAMESPACE, event.id);
    if (durableRow !== null) {
      const stored = await this.validateStored(durableRow.data);
      await this.markIdempotency(event.id);
      return {
        kind: 'DUPLICATE',
        event_id: event.id,
        first_received_at: stored.received_at,
        event: structuredClone(stored),
      };
    }

    const record: ObservationEventRecord = {
      id: event.id,
      source: event.source,
      kind: event.kind,
      occurred_at: event.occurred_at,
      payload: structuredClone(event.payload),
      provenance: [...event.provenance],
      received_at: formatRfc3339(this.clock.nowEpochMs()),
    };

    const inserted = await this.durable.putRow(OBSERVATION_EVENT_NAMESPACE, event.id, record as unknown as JsonValue, {
      if_absent: true,
    });
    if (!inserted.ok) {
      // A concurrent ingestion of the same event id won the race: replay.
      const row = await this.durable.getRow(OBSERVATION_EVENT_NAMESPACE, event.id);
      if (row === null) {
        throw new UnknownStoreError(
          `durable event index reported an existing row for ${JSON.stringify(event.id)} but cannot read it`,
        );
      }
      const stored = await this.validateStored(row.data);
      await this.markIdempotency(event.id);
      return {
        kind: 'DUPLICATE',
        event_id: event.id,
        first_received_at: stored.received_at,
        event: structuredClone(stored),
      };
    }

    await this.markIdempotency(event.id);
    return { kind: 'APPLIED', event: structuredClone(record) };
  }

  async get(eventId: string): Promise<ObservationEventRecord | undefined> {
    const row = await this.durable.getRow(OBSERVATION_EVENT_NAMESPACE, eventId);
    if (row === null) {
      return undefined;
    }
    const record = await this.validateStored(row.data);
    return structuredClone(record);
  }

  async list(options?: ListOptions): Promise<ListResult<ObservationEventRecord>> {
    return this.listWhere(options, () => true);
  }

  async listBySource(source: string, options?: ListOptions): Promise<ListResult<ObservationEventRecord>> {
    return this.listWhere(options, (event) => event.source === source);
  }

  private async listWhere(
    options: ListOptions | undefined,
    predicate: (event: ObservationEventRecord) => boolean,
  ): Promise<ListResult<ObservationEventRecord>> {
    const afterId = options?.after_id ?? null;
    const limit = options?.limit ?? null;
    const rows = await this.durable.listRows(OBSERVATION_EVENT_NAMESPACE);
    const records: ObservationEventRecord[] = [];
    for (const row of rows) {
      const record = await this.validateStored(row.data);
      if (predicate(record)) {
        records.push(record);
      }
    }
    const filtered = afterId === null ? records : records.filter((event) => event.id > afterId);
    const slice = limit === null ? filtered : filtered.slice(0, limit);
    const hasMore = limit !== null && filtered.length > limit;
    const last = slice.length === 0 ? null : slice[slice.length - 1]!;
    return {
      items: slice.map((event) => structuredClone(event)),
      next_after_id: hasMore && last !== null ? last.id : null,
    };
  }
}
