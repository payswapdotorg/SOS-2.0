/**
 * The LiveStore facade (Work Order P2) — the one surface the API service
 * (and later the orchestrator/observation planes) consumes: every
 * repository, the event boundary, the artifact blobs, typed provider
 * health and typed coordination degradation.
 *
 * THE SEMANTIC SPINE REMAINS THE ONLY IDENTITY AUTHORITY: every domain
 * record stored here was minted by its owning frozen package; the store
 * extracts ids, validates with the owning guards and returns records
 * VERBATIM (bit-exact canonical round trips). This facade introduces no
 * second semantic registry (AGENTS.md section 4).
 *
 * `history` groups the three history-plane repositories: ArchitectureMemory
 * (@sos-2/memory), CausalHypothesis (@sos-2/causal) and ProvenanceRecord
 * (@sos-2/provenance).
 */

import type { ProviderHealthRecord } from '@sos-2/api-contracts';
import type { ArchitectureMemoryArtifact } from '@sos-2/memory';
import type { CausalHypothesisArtifact } from '@sos-2/causal';
import type { ProvenanceRecord } from '@sos-2/provenance';
import type { AssuranceCaseArtifact } from '@sos-2/assurance';
import type { CandidateStateFixture, ExperimentArtifact } from '@sos-2/experiments';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import type { ContextArtifact } from '@sos-2/context';
import type { DecisionRecord } from '@sos-2/decision';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { MissionArtifact } from '@sos-2/mission';
import type { PackageArtifact } from '@sos-2/packages';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { BodyLeaseRecord, DevelopmentStateRecord, TaskRecord } from './state-records.js';
import { ArtifactBlobStore } from './artifacts.js';
import type { ArtifactBlobPort } from './artifacts.js';
import { ObservationEventLog } from './event-log.js';
import type { EventIngestionPort } from './event-log.js';
import { InMemoryObjectStoreAdapter, InMemoryPostgresStoreAdapter, InMemoryRedisCoordinationAdapter } from './in-memory-providers.js';
import type {
  ObjectStoreAdapter,
  PostgresStoreAdapter,
  RedisCoordinationAdapter,
} from './provider-ports.js';
import {
  CoordinationDegradationLog,
  EnvelopedRecordSet,
  RevisionedRecordSet,
  type CoordinationDegradation,
  type EnvelopedRecordPort,
  type RepositoryDeps,
  type RevisionedRecordPort,
} from './repositories.js';
import {
  architectureAdapter,
  architectureMemoryAdapter,
  assuranceAdapter,
  authorityGrantAdapter,
  bodyLeaseAdapter,
  candidateAdapter,
  causalHypothesisAdapter,
  contextAdapter,
  decisionAdapter,
  developmentStateAdapter,
  evidenceAdapter,
  experimentAdapter,
  missionAdapter,
  packageAdapter,
  provenanceRecordAdapter,
  systemStateAdapter,
  taskAdapter,
} from './record-adapters.js';
import type { Clock } from './clock.js';

/** The three history-plane repositories. */
export interface HistoryRepositories {
  memory: EnvelopedRecordPort<ArchitectureMemoryArtifact>;
  causal: EnvelopedRecordPort<CausalHypothesisArtifact>;
  provenance: RevisionedRecordPort<ProvenanceRecord>;
}

/** The complete live store surface. */
export interface LiveStore {
  readonly mission: EnvelopedRecordPort<MissionArtifact>;
  readonly context: EnvelopedRecordPort<ContextArtifact>;
  readonly systemState: EnvelopedRecordPort<SystemStateArtifact>;
  readonly evidence: RevisionedRecordPort<EvidenceRecordW3>;
  readonly architecture: EnvelopedRecordPort<ArchitectureGraphArtifact>;
  readonly candidate: EnvelopedRecordPort<CandidateStateFixture>;
  readonly assurance: EnvelopedRecordPort<AssuranceCaseArtifact>;
  readonly experiment: EnvelopedRecordPort<ExperimentArtifact>;
  readonly decision: EnvelopedRecordPort<DecisionRecord>;
  readonly authorityGrant: EnvelopedRecordPort<AuthorityGrantArtifact>;
  readonly package: EnvelopedRecordPort<PackageArtifact>;
  readonly history: HistoryRepositories;
  readonly developmentState: RevisionedRecordPort<DevelopmentStateRecord>;
  readonly task: RevisionedRecordPort<TaskRecord>;
  readonly bodyLease: RevisionedRecordPort<BodyLeaseRecord>;
  readonly events: EventIngestionPort;
  readonly artifacts: ArtifactBlobPort;
  /** The active provider adapters (provider-neutral ports; production adapters attach later without contract change). */
  readonly providers: {
    readonly durable: PostgresStoreAdapter;
    readonly coordination: RedisCoordinationAdapter | null;
    readonly objectStore: ObjectStoreAdapter;
  };
  /** Typed per-provider availability (fixed role order; deterministic). */
  health(): ProviderHealthRecord[];
  /** Typed coordination-degradation records (Redis best-effort failures — recorded, never silent). */
  coordinationHealth(): CoordinationDegradation[];
}

export interface CreateInMemoryLiveStoreOptions {
  /** Injected clock (REQUIRED — no hidden clocks). */
  clock: Clock;
  /** An existing durable adapter to reuse (the durable substrate — facade recreation over the same adapter recovers all state). */
  durable?: PostgresStoreAdapter;
  /** An existing coordination adapter to reuse, or null to run WITHOUT coordination (the strongest never-canonical configuration). */
  coordination?: RedisCoordinationAdapter | null;
  /** An existing object-store adapter to reuse. */
  objectStore?: ObjectStoreAdapter;
}

/**
 * Create the in-memory reference live store: all repositories over the
 * in-memory provider adapters (the contracts a Neon/Upstash/R2 adapter
 * implements later, unchanged). The coordination layer is OPTIONAL — pass
 * coordination: null to prove semantics never depend on it.
 */
export function createInMemoryLiveStore(options: CreateInMemoryLiveStoreOptions): LiveStore {
  if (options.clock === undefined || options.clock === null) {
    throw new TypeError('createInMemoryLiveStore requires an injected clock (no hidden clocks)');
  }
  const durable = options.durable ?? new InMemoryPostgresStoreAdapter({ clock: options.clock });
  const coordination = options.coordination === undefined ? new InMemoryRedisCoordinationAdapter() : options.coordination;
  const objectStore = options.objectStore ?? new InMemoryObjectStoreAdapter();
  const degradation = new CoordinationDegradationLog();

  const deps: RepositoryDeps = { durable, coordination, clock: options.clock, degradation };

  const mission = new EnvelopedRecordSet(missionAdapter, { ...deps });
  const context = new EnvelopedRecordSet(contextAdapter, { ...deps });
  const systemState = new EnvelopedRecordSet(systemStateAdapter, { ...deps });
  const evidence = new RevisionedRecordSet(evidenceAdapter, { ...deps });
  const architecture = new EnvelopedRecordSet(architectureAdapter, { ...deps });
  const candidate = new EnvelopedRecordSet(candidateAdapter, { ...deps });
  const assurance = new EnvelopedRecordSet(assuranceAdapter, { ...deps });
  const experiment = new EnvelopedRecordSet(experimentAdapter, { ...deps });
  const decision = new EnvelopedRecordSet(decisionAdapter, { ...deps });
  const authorityGrant = new EnvelopedRecordSet(authorityGrantAdapter, { ...deps });
  const pkg = new EnvelopedRecordSet(packageAdapter, { ...deps });
  const memory = new EnvelopedRecordSet(architectureMemoryAdapter, { ...deps });
  const causal = new EnvelopedRecordSet(causalHypothesisAdapter, { ...deps });
  const provenance = new RevisionedRecordSet(provenanceRecordAdapter, { ...deps });
  const developmentState = new RevisionedRecordSet(developmentStateAdapter, { ...deps });
  const task = new RevisionedRecordSet(taskAdapter, { ...deps });
  const bodyLease = new RevisionedRecordSet(bodyLeaseAdapter, { ...deps });
  const events = new ObservationEventLog({ ...deps });
  const artifacts = new ArtifactBlobStore(objectStore);

  return {
    mission,
    context,
    systemState,
    evidence,
    architecture,
    candidate,
    assurance,
    experiment,
    decision,
    authorityGrant,
    package: pkg,
    history: { memory, causal, provenance },
    developmentState,
    task,
    bodyLease,
    events,
    artifacts,
    providers: { durable, coordination, objectStore },
    health(): ProviderHealthRecord[] {
      return [durable.health(), coordination?.health() ?? null, objectStore.health()].filter(
        (entry): entry is ProviderHealthRecord => entry !== null,
      );
    },
    coordinationHealth(): CoordinationDegradation[] {
      return degradation.list();
    },
  };
}
