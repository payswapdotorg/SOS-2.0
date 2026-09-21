/**
 * The in-memory reference LiveStore (Work Order P2) — the complete reference
 * backend composing every repository over the provider ports.
 *
 * Defaults are DETERMINISTIC: a ManualClock at epoch 0 and the three
 * in-memory provider adapters. Production wires real adapters (Neon /
 * Upstash / R2, later waves) behind the same ports and a real clock at the
 * app boundary — WITHOUT contract change.
 *
 * health() is the typed failure model: every unconfigured provider reports
 * UNKNOWN (never fabricated AVAILABLE); a configured-but-failing provider
 * adapter reports UNAVAILABLE from its own health().
 */

import type { ContextDimensionRegistry } from '@sos-2/context';
import type { Clock } from '../clock.js';
import { ManualClock } from '../clock.js';
import type { LiveStore } from '../ports/live-store.js';
import type {
  ObjectStoreAdapter,
  PostgresStoreAdapter,
  ProviderHealthRecord,
  ProviderHealthReport,
  RedisCoordinationAdapter,
} from '../ports/provider-adapters.js';
import { InMemoryObjectStoreAdapter } from './in-memory-object-store.js';
import { InMemoryPostgresStoreAdapter } from './in-memory-postgres.js';
import { InMemoryRedisCoordinationAdapter } from './in-memory-redis.js';
import {
  InMemoryArchitectureRepository,
  InMemoryAssuranceRepository,
  InMemoryAuthorityGrantRepository,
  InMemoryBodyLeaseRepository,
  InMemoryCandidateRepository,
  InMemoryContextRepository,
  InMemoryDecisionRepository,
  InMemoryDevelopmentStateRepository,
  InMemoryEvidenceRepository,
  InMemoryExperimentRepository,
  InMemoryHistoryRepository,
  InMemoryMissionRepository,
  InMemoryObservationEventRepository,
  InMemoryPackageRepository,
  InMemorySystemStateRepository,
  InMemoryTaskStateRepository,
} from './repositories.js';

/** Options for the reference live store (all defaults deterministic). */
export interface InMemoryLiveStoreOptions {
  /** Injected clock (default: ManualClock at epoch 0 — deterministic). */
  clock?: Clock;
  /** Durable canonical store (default: in-memory reference adapter). */
  durable?: PostgresStoreAdapter;
  /**
   * Coordination layer (default: in-memory reference adapter). Pass null to
   * run with NO coordination layer at all — the store keeps working
   * (coordination is never canonical).
   */
  coordination?: RedisCoordinationAdapter | null;
  /** Object store (default: in-memory reference adapter). */
  objects?: ObjectStoreAdapter;
  /** Context dimension registry (defaults to the process-wide registry). */
  contextDimensionRegistry?: ContextDimensionRegistry;
}

const NO_COORDINATION_HEALTH: ProviderHealthRecord = {
  provider: 'redis',
  role: 'coordination-only-never-canonical',
  status: 'UNKNOWN',
  detail: 'no coordination adapter configured (coordination is optional — never canonical)',
};

export class InMemoryLiveStore implements LiveStore {
  readonly missions: InMemoryMissionRepository;
  readonly contexts: InMemoryContextRepository;
  readonly systemStates: InMemorySystemStateRepository;
  readonly evidence: InMemoryEvidenceRepository;
  readonly architecture: InMemoryArchitectureRepository;
  readonly candidates: InMemoryCandidateRepository;
  readonly assurance: InMemoryAssuranceRepository;
  readonly experiments: InMemoryExperimentRepository;
  readonly decisions: InMemoryDecisionRepository;
  readonly authorityGrants: InMemoryAuthorityGrantRepository;
  readonly packages: InMemoryPackageRepository;
  readonly history: InMemoryHistoryRepository;
  readonly developmentState: InMemoryDevelopmentStateRepository;
  readonly tasks: InMemoryTaskStateRepository;
  readonly bodyLeases: InMemoryBodyLeaseRepository;
  readonly observationEvents: InMemoryObservationEventRepository;
  readonly objects: ObjectStoreAdapter;

  private readonly durableAdapter: PostgresStoreAdapter;
  private readonly coordinationAdapter: RedisCoordinationAdapter | null;

  constructor(options?: InMemoryLiveStoreOptions) {
    const clock = options?.clock ?? new ManualClock(0);
    const durable = options?.durable ?? new InMemoryPostgresStoreAdapter();
    const coordination =
      options?.coordination === undefined
        ? new InMemoryRedisCoordinationAdapter({ clock })
        : options.coordination;
    const objects = options?.objects ?? new InMemoryObjectStoreAdapter();

    this.missions = new InMemoryMissionRepository({ durable, coordination });
    this.contexts = new InMemoryContextRepository({
      durable,
      coordination,
      registry: options?.contextDimensionRegistry,
    });
    this.systemStates = new InMemorySystemStateRepository({ durable, coordination });
    this.evidence = new InMemoryEvidenceRepository({ durable, coordination });
    this.architecture = new InMemoryArchitectureRepository({ durable, coordination });
    this.candidates = new InMemoryCandidateRepository({ durable, coordination });
    this.assurance = new InMemoryAssuranceRepository({ durable, coordination });
    this.experiments = new InMemoryExperimentRepository({ durable, coordination });
    this.decisions = new InMemoryDecisionRepository({ durable, coordination });
    this.authorityGrants = new InMemoryAuthorityGrantRepository({ durable, coordination });
    this.packages = new InMemoryPackageRepository({ durable, coordination });
    this.history = new InMemoryHistoryRepository({ durable, coordination });
    this.developmentState = new InMemoryDevelopmentStateRepository({ durable, coordination });
    this.tasks = new InMemoryTaskStateRepository({ durable, coordination, clock });
    this.bodyLeases = new InMemoryBodyLeaseRepository({ durable, coordination, clock });
    this.observationEvents = new InMemoryObservationEventRepository({ durable, coordination, clock });
    this.objects = objects;

    this.durableAdapter = durable;
    this.coordinationAdapter = coordination;
  }

  health(): ProviderHealthReport {
    return {
      postgres: this.durableAdapter.health(),
      redis: this.coordinationAdapter === null ? NO_COORDINATION_HEALTH : this.coordinationAdapter.health(),
      objectStore: this.objects.health(),
    };
  }
}

/** Build the reference live store (deterministic defaults). */
export function createInMemoryLiveStore(options?: InMemoryLiveStoreOptions): InMemoryLiveStore {
  return new InMemoryLiveStore(options);
}
