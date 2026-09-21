/**
 * The reference composition — the complete no-body Observation Plane.
 *
 * Assembles: durable in-memory P2 live-store + P7 event-ingestion
 * pipeline + telemetry runtime + live projections + read-only claims
 * port + detection engine + the observation loop. Everything injected
 * (the clock comes from the caller — SystemClock only at the process
 * boundary, ManualClock in tests). ZERO bodies, ZERO harnesses, ZERO
 * network: this is the whole point of §5 — governance without a
 * permanent coding agent.
 */

import { createInMemoryLiveStore } from '@sos-2/live-store';
import type { Clock, InMemoryLiveStore } from '@sos-2/live-store';
import { EventIngestionPipeline, CoverageLedger, ProbeScheduler } from '@sos-2/event-ingestion';
import type { EventSourcePort, ProbePort, ProbeScheduler as ProbeSchedulerType } from '@sos-2/event-ingestion';
import { ObservationProjections, DetectionEngine, ObservationLoop } from '@sos-2/observation';
import type { ObservedRevision, ProjectionSnapshot, StateRevisionClaim, SystemStateClaimsPort, SubjectQuery } from '@sos-2/observation';
import { TelemetryRuntime } from '@sos-2/telemetry-runtime';
import type { TelemetrySource } from '@sos-2/telemetry';

/** The canonical subject keys the reference composition wires. */
export const REFERENCE_SUBJECTS = {
  repository: 'github:repo:payswapdotorg/SOS-2.0',
  claimMain: 'github:repo:payswapdotorg/SOS-2.0@main',
  claimProduction: 'deploy:environment:production',
} as const;

export interface ReferenceObservationPlaneDeps {
  readonly clock: Clock;
  /** Organic event sources (github/CI/deployment/provider-health/...). */
  readonly sources: readonly EventSourcePort[];
  /** Telemetry backends (W3 TelemetrySource ports). */
  readonly telemetrySources?: readonly TelemetrySource[];
  /** Scheduled probes (only run where organic coverage is insufficient). */
  readonly probes?: readonly ProbePort[];
  /** Read-only System State claims. */
  readonly claims: SystemStateClaimsPort;
  /** Freshness window (ms) for projections + coverage. */
  readonly freshAfterMs?: number;
}

export interface ReferenceObservationPlane {
  readonly store: InMemoryLiveStore;
  readonly pipeline: EventIngestionPipeline;
  readonly coverage: CoverageLedger;
  readonly telemetry: TelemetryRuntime;
  readonly projections: ObservationProjections;
  readonly loop: ObservationLoop;
  readonly probes: ProbeSchedulerType | undefined;
}

const GITHUB_WEBHOOK_SOURCE = 'github:webhook:payswapdotorg/SOS-2.0';
const CI_SOURCE = 'ci:github-actions:payswapdotorg/SOS-2.0';
const DEPLOYMENT_SOURCE = 'deploy:tracker:production';
const PROVIDER_HEALTH_SOURCE = 'status:page:aggregate';
const REPO_PROBE_SOURCE = 'scheduled-probe:probe-repo-head';

export function createReferenceObservationPlane(deps: ReferenceObservationPlaneDeps): ReferenceObservationPlane {
  const store = createInMemoryLiveStore();
  const freshAfterMs = deps.freshAfterMs ?? 600_000;
  const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: deps.clock });
  const coverage = new CoverageLedger({
    observationEvents: store.observationEvents,
    clock: deps.clock,
    freshAfterMs,
    subjects: [
      { subject: REFERENCE_SUBJECTS.repository, sources: [GITHUB_WEBHOOK_SOURCE, CI_SOURCE, DEPLOYMENT_SOURCE, REPO_PROBE_SOURCE] },
    ],
  });

  const repositorySubject: SubjectQuery = { subject: REFERENCE_SUBJECTS.repository, sources: [GITHUB_WEBHOOK_SOURCE, REPO_PROBE_SOURCE] };
  const ciSubject: SubjectQuery = { subject: REFERENCE_SUBJECTS.repository, sources: [CI_SOURCE, REPO_PROBE_SOURCE] };
  const deploymentSubject: SubjectQuery = { subject: REFERENCE_SUBJECTS.repository, sources: [DEPLOYMENT_SOURCE] };

  const telemetry = new TelemetryRuntime({ sources: deps.telemetrySources ?? [], pipeline, clock: deps.clock });

  const probes =
    deps.probes !== undefined && deps.probes.length > 0
      ? new ProbeScheduler({
          clock: deps.clock,
          isCovered: (subject, family) => coverage.isCovered(subject, family),
          probes: deps.probes,
        })
      : undefined;

  const projections = new ObservationProjections({
    observationEvents: store.observationEvents,
    clock: deps.clock,
    freshAfterMs,
    repositorySubjects: [repositorySubject],
    ciSubjects: [ciSubject],
    deploymentSubjects: [deploymentSubject],
    providerHealthSources: [PROVIDER_HEALTH_SOURCE],
  });

  const detection = new DetectionEngine({
    headRevisionOf: (subject, snapshot) => {
      const projection = snapshot.repositoryHeads.get(subject);
      const head = projection?.branchHeads['main'];
      if (head === undefined) {
        return null;
      }
      return { revision: head, evidenceEventIds: projection?.foldedEventIds ?? [] };
    },
    deployedRevisionOf: (subject, environment, snapshot) => {
      const projection = snapshot.deployments.get(subject);
      const deployed = projection?.deployedByEnvironment[environment];
      if (deployed === undefined) {
        return null;
      }
      return { revision: deployed.revision, evidenceEventIds: projection?.foldedEventIds ?? [] };
    },
    primaryEnvironment: 'production',
    repositorySubjects: [REFERENCE_SUBJECTS.repository],
  });

  const loop = new ObservationLoop({
    pipeline,
    sources: deps.sources,
    probes,
    telemetry,
    projections,
    claims: deps.claims,
    detection,
    observeFor: (claim: StateRevisionClaim, snapshot: ProjectionSnapshot): ObservedRevision | undefined => {
      if (claim.subject === REFERENCE_SUBJECTS.claimMain) {
        const projection = snapshot.repositoryHeads.get(REFERENCE_SUBJECTS.repository);
        if (projection === undefined) {
          return undefined;
        }
        const head = projection.branchHeads['main'];
        return { subject: claim.subject, revision: head ?? null, lastEventAt: projection.lastEventAt, freshness: projection.freshness, evidenceEventIds: projection.foldedEventIds };
      }
      if (claim.subject === REFERENCE_SUBJECTS.claimProduction) {
        const projection = snapshot.deployments.get(REFERENCE_SUBJECTS.repository);
        if (projection === undefined) {
          return undefined;
        }
        const deployed = projection.deployedByEnvironment['production'];
        return { subject: claim.subject, revision: deployed?.revision ?? null, lastEventAt: projection.lastEventAt, freshness: projection.freshness, evidenceEventIds: projection.foldedEventIds };
      }
      return undefined;
    },
    clock: deps.clock,
  });

  return { store, pipeline, coverage, telemetry, projections, loop, probes };
}
