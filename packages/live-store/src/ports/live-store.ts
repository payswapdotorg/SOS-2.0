/**
 * The LiveStore facade port (Work Order P2) — the durable, provider-neutral
 * live product state the API serves.
 *
 * The facade composes the repositories (durable, behind the
 * PostgresStoreAdapter port) with the coordination and object-store ports.
 * Provider adapters attach later WITHOUT contract change: every repository
 * and port here is provider-neutral; domain packages never import provider
 * specifics (the boundary is one-directional: live-store consumes the
 * frozen domain packages; nothing consumes live-store at this base).
 */

import type { ObjectStoreAdapter, ProviderHealthReport } from './provider-adapters.js';
import type {
  ArchitectureRepository,
  AssuranceRepository,
  AuthorityGrantRepository,
  BodyLeaseRepository,
  CandidateRepository,
  ContextRepository,
  DecisionRepository,
  DevelopmentStateRepository,
  EvidenceRepository,
  ExperimentRepository,
  HistoryRepository,
  MissionRepository,
  ObservationEventRepository,
  PackageRepository,
  SystemStateRepository,
  TaskStateRepository,
} from './repositories.js';

/** The live product state surface (P2 Support list, one field per family). */
export interface LiveStore {
  /** Mission artifacts (kind "Mission"). */
  readonly missions: MissionRepository;
  /** Context artifacts (kind "Context"). */
  readonly contexts: ContextRepository;
  /** SystemState artifacts (kind "SystemState"). */
  readonly systemStates: SystemStateRepository;
  /** Evidence records (immutable, kind "Evidence"). */
  readonly evidence: EvidenceRepository;
  /** Architecture graph artifacts (kind "ArchitectureGraph"). */
  readonly architecture: ArchitectureRepository;
  /** Candidate state fixtures (kind "CandidateState"). */
  readonly candidates: CandidateRepository;
  /** Assurance case artifacts (kind "AssuranceCase"). */
  readonly assurance: AssuranceRepository;
  /** Experiment artifacts (kind "Experiment"). */
  readonly experiments: ExperimentRepository;
  /** Decision records (kind "Decision"). */
  readonly decisions: DecisionRepository;
  /** Authority grant artifacts (kind "AuthorityGrant"). */
  readonly authorityGrants: AuthorityGrantRepository;
  /** Package artifacts (kind "Package"). */
  readonly packages: PackageRepository;
  /** History: architecture memory + causal hypotheses. */
  readonly history: HistoryRepository;
  /** Development state snapshots (operational, revisioned). */
  readonly developmentState: DevelopmentStateRepository;
  /** Task state — the §6 task-durability shape. */
  readonly tasks: TaskStateRepository;
  /** Body lease state (durable truth; coordination mirrors only). */
  readonly bodyLeases: BodyLeaseRepository;
  /** Observation events (replay-protected ingestion). */
  readonly observationEvents: ObservationEventRepository;
  /** Large immutable artifacts by content hash (R2 target). */
  readonly objects: ObjectStoreAdapter;

  /**
   * Typed per-provider availability (AVAILABLE / UNAVAILABLE / UNKNOWN).
   * Unconfigured providers report UNKNOWN — never fabricated success.
   */
  health(): ProviderHealthReport;
}
