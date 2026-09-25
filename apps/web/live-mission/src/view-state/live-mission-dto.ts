/**
 * The live-mission data contract (Work Order P17-C).
 *
 * SELF-CONTAINED, SERIALIZABLE, ZERO domain imports: this module is the
 * boundary between the real-observation plane (packages/real-observation,
 * process side) and the live-mission UI surface. The route's server
 * component (mounted by the architect's P18 integration pass — see
 * MOUNTING.md) produces a LiveObservationData through
 * liveObservationFromDrain() and renders LiveMissionPage with it; until
 * data is wired, emptyLiveObservation() renders the honest UNKNOWN
 * state (never fabricated live state).
 *
 * The producer's input is a STRUCTURAL subset of the merged observation
 * plane's drain report (ObservationDrainReport — plain JSON shapes +
 * Maps), so no dependency edge from apps/web is created: TypeScript
 * structural typing accepts the real report at the call site.
 */

// ---------------------------------------------------------------------------
// Honest source states (the P17-C four-state machine, UI vocabulary)
// ---------------------------------------------------------------------------

export const LIVE_SOURCE_STATES = ['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED'] as const;
export type LiveSourceState = (typeof LIVE_SOURCE_STATES)[number];

/** One real source's honest connectivity state + its probe evidence. */
export interface LiveSourceStatus {
  readonly source: string;
  readonly provider: string;
  /** The §5 observation family this source serves ('github' | 'ci' | 'deployment' | 'telemetry' | 'provider-health' | 'scheduled-probe'). */
  readonly family: string;
  readonly state: LiveSourceState;
  readonly detail: string;
  readonly lastError: string | null;
  readonly lastProbedAt: string | null;
  readonly apiRevision: string | null;
}

// ---------------------------------------------------------------------------
// Live projection views (mirrors of the merged plane's projections)
// ---------------------------------------------------------------------------

export type LiveFreshness = 'FRESH' | 'STALE' | 'NO_DATA';

export interface LiveBranchHead {
  readonly branch: string;
  readonly head: string;
  readonly lastEventAt: string | null;
  readonly freshness: LiveFreshness;
  readonly evidenceEventIds: readonly string[];
}

export interface LivePullRequest {
  readonly number: number;
  readonly head: string;
  readonly base: string;
  readonly openedAt: string;
}

export interface LiveCiRun {
  readonly runId: string;
  readonly pipeline: string;
  readonly ref: string;
  /** Capture-level truth carried verbatim (SUCCESS / FAILURE / IN_PROGRESS / ...). */
  readonly status: string;
  readonly occurredAt: string;
}

export interface LiveDeployment {
  readonly environment: string;
  readonly revision: string;
  readonly since: string;
}

export type LiveFindingKind = 'ALIGNED' | 'DIVERGED' | 'UNVERIFIED' | 'STALE';

export interface LiveFinding {
  readonly subject: string;
  readonly kind: LiveFindingKind;
  readonly claimedRevision: string;
  readonly observedRevision: string | null;
  readonly evidenceEventIds: readonly string[];
}

export interface LiveDetection {
  readonly code: string;
  readonly subject: string;
  readonly message: string;
}

export interface LiveProviderHealth {
  readonly provider: string;
  readonly status: string;
  readonly at: string;
}

/** The complete live observation data the live-mission surface renders. */
export interface LiveObservationData {
  /** The durable store the events live in (the LIVE provenance reference). */
  readonly storeRef: string;
  /** When this snapshot was read (RFC3339; caller-supplied — never a hidden clock). */
  readonly asOf: string;
  readonly drainedAt: string | null;
  readonly sources: readonly LiveSourceStatus[];
  readonly eventsInWindow: number;
  readonly repository: {
    readonly subject: string;
    readonly branchHeads: readonly LiveBranchHead[];
    readonly openPullRequests: readonly LivePullRequest[];
    readonly freshness: LiveFreshness;
  };
  readonly ci: { readonly latestByPipeline: readonly LiveCiRun[]; readonly freshness: LiveFreshness };
  readonly deployments: { readonly byEnvironment: readonly LiveDeployment[]; readonly freshness: LiveFreshness };
  readonly providerHealth: readonly LiveProviderHealth[];
  readonly findings: readonly LiveFinding[];
  readonly detections: readonly LiveDetection[];
  /** True when no body lease is active — the §5 note: observation does not use a working body. */
  readonly watchingWithoutBody: boolean;
}

/** A resumable mission entry (from the authoritative mission store). */
export interface LiveMissionEntry {
  readonly missionId: string;
  readonly status: string;
  readonly purposeSummary: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// The producer: drain report (structural subset) -> LiveObservationData
// ---------------------------------------------------------------------------

/** The structural subset of the merged ObservationDrainReport the producer consumes. */
export interface DrainReportLike {
  readonly drainedAt: string;
  readonly snapshot: {
    readonly repositoryHeads: ReadonlyMap<string, { branchHeads: Record<string, string>; openPullRequests: readonly { number: number; head: string; base: string; openedAt: string }[]; lastEventAt: string | null; freshness: { state: LiveFreshness }; foldedEventIds: readonly string[] }>;
    readonly ci: ReadonlyMap<string, { latestByPipeline: Record<string, { runId: string; ref: string; status: string; occurredAt: string }>; lastEventAt: string | null; freshness: { state: LiveFreshness } }>;
    readonly deployments: ReadonlyMap<string, { deployedByEnvironment: Record<string, { revision: string; since: string }>; lastEventAt: string | null; freshness: { state: LiveFreshness } }>;
    readonly providerHealth: { lastSignalByProvider: Record<string, { provider: string; status: string; at: string }>; freshness: { state: LiveFreshness } };
  };
  readonly findings: readonly { subject: string; kind: LiveFindingKind; claimedRevision: string; observedRevision: string | null; evidenceEventIds: readonly string[] }[];
  readonly detections: readonly { code: string; subject: string; message?: string }[];
}

/** The structural subset of the P17-C connectivity snapshot the producer consumes. */
export interface ConnectivitySnapshotLike {
  readonly sources: readonly {
    source: string;
    provider: string;
    state: LiveSourceState;
    detail: string;
    lastError: string | null;
    lastProbedAt: string | null;
    probes: readonly { apiRevision: string | null }[];
  }[];
}

/** Map the §5 family for a source id (github / ci / deployment / telemetry / provider-health / scheduled-probe). */
export function familyForSource(source: string): string {
  if (source.startsWith('github:')) return 'github';
  if (source.startsWith('ci:')) return 'ci';
  if (source.startsWith('deploy:')) return 'deployment';
  if (source.startsWith('telemetry:')) return 'telemetry';
  if (source.startsWith('provider-health:')) return 'provider-health';
  if (source.startsWith('scheduled-probe:')) return 'scheduled-probe';
  return 'user-observation';
}

export function liveObservationFromDrain(input: {
  report: DrainReportLike;
  connectivity: ConnectivitySnapshotLike;
  repositorySubject: string;
  storeRef: string;
  asOf: string;
  eventsInWindow: number;
  watchingWithoutBody: boolean;
}): LiveObservationData {
  const repository = input.report.snapshot.repositoryHeads.get(input.repositorySubject);
  const ci = input.report.snapshot.ci.get(input.repositorySubject);
  const deployments = input.report.snapshot.deployments.get(input.repositorySubject);
  return {
    storeRef: input.storeRef,
    asOf: input.asOf,
    drainedAt: input.report.drainedAt,
    sources: input.connectivity.sources.map((source) => ({
      source: source.source,
      provider: source.provider,
      family: familyForSource(source.source),
      state: source.state,
      detail: source.detail,
      lastError: source.lastError,
      lastProbedAt: source.lastProbedAt,
      apiRevision: source.probes.length > 0 ? (source.probes[source.probes.length - 1]?.apiRevision ?? null) : null,
    })),
    eventsInWindow: input.eventsInWindow,
    repository: {
      subject: input.repositorySubject,
      branchHeads: Object.entries(repository?.branchHeads ?? {}).map(([branch, head]) => ({
        branch,
        head,
        lastEventAt: repository?.lastEventAt ?? null,
        freshness: repository?.freshness.state ?? 'NO_DATA',
        evidenceEventIds: repository?.foldedEventIds ?? [],
      })),
      openPullRequests: repository?.openPullRequests.map((pull) => ({ number: pull.number, head: pull.head, base: pull.base, openedAt: pull.openedAt })) ?? [],
      freshness: repository?.freshness.state ?? 'NO_DATA',
    },
    ci: {
      latestByPipeline: Object.entries(ci?.latestByPipeline ?? {}).map(([pipeline, run]) => ({ runId: run.runId, pipeline, ref: run.ref, status: run.status, occurredAt: run.occurredAt })),
      freshness: ci?.freshness.state ?? 'NO_DATA',
    },
    deployments: {
      byEnvironment: Object.entries(deployments?.deployedByEnvironment ?? {}).map(([environment, view]) => ({ environment, revision: view.revision, since: view.since })),
      freshness: deployments?.freshness.state ?? 'NO_DATA',
    },
    providerHealth: Object.values(input.report.snapshot.providerHealth.lastSignalByProvider).map((signal) => ({ provider: signal.provider, status: signal.status, at: signal.at })),
    findings: input.report.findings.map((finding) => ({
      subject: finding.subject,
      kind: finding.kind,
      claimedRevision: finding.claimedRevision,
      observedRevision: finding.observedRevision,
      evidenceEventIds: finding.evidenceEventIds,
    })),
    detections: input.report.detections.map((detection) => ({ code: detection.code, subject: detection.subject, message: detection.message ?? detection.code })),
    watchingWithoutBody: input.watchingWithoutBody,
  };
}

/** The honest empty/unknown snapshot — rendered until live data is wired (never fabricated). */
export function emptyLiveObservation(storeRef: string, asOf: string, repositorySubject: string): LiveObservationData {
  return {
    storeRef,
    asOf,
    drainedAt: null,
    sources: [],
    eventsInWindow: 0,
    repository: { subject: repositorySubject, branchHeads: [], openPullRequests: [], freshness: 'NO_DATA' },
    ci: { latestByPipeline: [], freshness: 'NO_DATA' },
    deployments: { byEnvironment: [], freshness: 'NO_DATA' },
    providerHealth: [],
    findings: [],
    detections: [],
    watchingWithoutBody: true,
  };
}
