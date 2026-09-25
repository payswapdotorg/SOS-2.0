/**
 * The live-mission view models (Work Order P17-C): the LIVE projections
 * of the real observation plane rendered through the same product
 * discipline as the P1/P4 shells — every consequential surface answers
 * the six product review questions (what / why / evidence / uncertainty /
 * authority / next) and carries an explicit LIVE data-source
 * provenance ({kind: 'LIVE', store_ref, as_of} — the merged
 * @sos-2/web-contracts DataSource LIVE variant), so live state can
 * never render as DEMO fixture state and vice versa.
 *
 * Pure functions over the DTO (live-mission-dto.ts): deterministic,
 * total, zero domain logic — the projections map, sort and label.
 */

import type {
  LiveBranchHead,
  LiveCiRun,
  LiveDeployment,
  LiveFinding,
  LiveMissionEntry,
  LiveObservationData,
  LiveSourceState,
  LiveSourceStatus,
} from './live-mission-dto';

/** The merged web-contracts LIVE provenance shape (imported as a TYPE-ONLY mirror — no runtime edge). */
export interface LiveProvenanceView {
  readonly kind: 'LIVE';
  readonly store_ref: string;
  readonly as_of: string;
}

/** The six-question review core every live surface carries. */
export interface LiveReviewCore {
  readonly what: string;
  readonly why: string;
  readonly evidence: readonly string[];
  readonly uncertainty: string;
  readonly authority: string;
  readonly next: string;
}

/** The hero view of the actionable mission surface. */
export interface LiveMissionHeroView {
  readonly data_source: LiveProvenanceView;
  readonly review: LiveReviewCore;
  readonly anySourceConnected: boolean;
  readonly unprobedSources: number;
  readonly unavailableSources: number;
  readonly degradedSources: number;
  readonly totalEventsInWindow: number;
  readonly watchingWithoutBody: boolean;
}

/** One honest source row view. */
export interface LiveSourceRowView {
  readonly source: LiveSourceStatus;
  readonly tone: 'POSITIVE' | 'CAUTION' | 'NEGATIVE' | 'EPISTEMIC';
  readonly stateLabel: string;
}

export function dataSourceOf(data: LiveObservationData): LiveProvenanceView {
  return { kind: 'LIVE', store_ref: data.storeRef, as_of: data.asOf };
}

export function heroView(data: LiveObservationData): LiveMissionHeroView {
  const connected = data.sources.filter((source) => source.state === 'CONNECTED').length;
  const unknown = data.sources.filter((source) => source.state === 'UNKNOWN').length;
  const unavailable = data.sources.filter((source) => source.state === 'UNAVAILABLE').length;
  const degraded = data.sources.filter((source) => source.state === 'DEGRADED').length;
  const what =
    data.drainedAt === null
      ? 'No live observation drain has run yet — this surface shows honest UNKNOWN until the real sources are probed.'
      : `The real observation plane drained at ${data.drainedAt}: ${connected} of ${data.sources.length} sources CONNECTED${degraded > 0 ? `, ${degraded} DEGRADED` : ''}${unavailable > 0 ? `, ${unavailable} UNAVAILABLE` : ''}${unknown > 0 ? `, ${unknown} UNKNOWN (never probed)` : ''}.`;
  const why =
    data.drainedAt === null
      ? 'The plane reports nothing until a real probe has answered — absence of information is never health.'
      : 'Every state above comes from a REAL HTTP round-trip through the injected provider adapters (GitHub REST, Vercel API, Upstash REST); no state is fabricated.';
  return {
    data_source: dataSourceOf(data),
    review: {
      what,
      why,
      evidence: data.repository.branchHeads.flatMap((head) => head.evidenceEventIds.slice(0, 3)),
      uncertainty:
        unknown > 0
          ? `${unknown} source(s) were never probed — their state is UNKNOWN, not healthy; ${data.repository.freshness === 'NO_DATA' ? 'the repository projection has NO_DATA yet' : `repository data is ${data.repository.freshness}`}.`
          : `Repository data is ${data.repository.freshness}; CI is ${data.ci.freshness}; deployments are ${data.deployments.freshness}.`,
      authority: 'Observation is read-only and needs no authority; consequential actions below are authority-gated per action.',
      next: data.detections.length > 0 ? `Review the ${data.detections.length} detected shortfall(s)/opportunity(ies), then act through the authority-gated actions.` : 'Act through the authority-gated actions below, or start/resume a mission.',
    },
    anySourceConnected: connected > 0,
    unprobedSources: unknown,
    unavailableSources: unavailable,
    degradedSources: degraded,
    totalEventsInWindow: data.eventsInWindow,
    watchingWithoutBody: data.watchingWithoutBody,
  };
}

const STATE_LABELS: Record<LiveSourceState, string> = {
  CONNECTED: 'CONNECTED — real probe answered',
  UNKNOWN: 'UNKNOWN — never probed',
  UNAVAILABLE: 'UNAVAILABLE — real error recorded',
  DEGRADED: 'DEGRADED — throttled/partial',
};

export function sourceRowView(source: LiveSourceStatus): LiveSourceRowView {
  const tone: LiveSourceRowView['tone'] =
    source.state === 'CONNECTED' ? 'POSITIVE' : source.state === 'DEGRADED' ? 'CAUTION' : source.state === 'UNAVAILABLE' ? 'NEGATIVE' : 'EPISTEMIC';
  return { source, tone, stateLabel: STATE_LABELS[source.state] };
}

export function sortedSources(sources: readonly LiveSourceStatus[]): readonly LiveSourceStatus[] {
  const rank: Record<LiveSourceState, number> = { UNAVAILABLE: 0, DEGRADED: 1, UNKNOWN: 2, CONNECTED: 3 };
  return [...sources].sort((left, right) => {
    if (rank[left.state] !== rank[right.state]) {
      return rank[left.state] - rank[right.state];
    }
    return left.source < right.source ? -1 : left.source > right.source ? 1 : 0;
  });
}

export function sortedBranches(heads: readonly LiveBranchHead[]): readonly LiveBranchHead[] {
  return [...heads].sort((left, right) => (left.branch < right.branch ? -1 : left.branch > right.branch ? 1 : 0));
}

export function sortedCiRuns(runs: readonly LiveCiRun[]): readonly LiveCiRun[] {
  return [...runs].sort((left, right) => (left.pipeline < right.pipeline ? -1 : left.pipeline > right.pipeline ? 1 : left.runId < right.runId ? -1 : 1));
}

export function sortedDeployments(entries: readonly LiveDeployment[]): readonly LiveDeployment[] {
  return [...entries].sort((left, right) => (left.environment < right.environment ? -1 : left.environment > right.environment ? 1 : 0));
}

export function sortedFindings(findings: readonly LiveFinding[]): readonly LiveFinding[] {
  const rank: Record<LiveFinding['kind'], number> = { DIVERGED: 0, STALE: 1, UNVERIFIED: 2, ALIGNED: 3 };
  return [...findings].sort((left, right) => {
    if (rank[left.kind] !== rank[right.kind]) {
      return rank[left.kind] - rank[right.kind];
    }
    return left.subject < right.subject ? -1 : left.subject > right.subject ? 1 : 0;
  });
}

export function resumableMissions(missions: readonly LiveMissionEntry[]): readonly LiveMissionEntry[] {
  return [...missions]
    .filter((mission) => mission.status !== 'ARCHIVED')
    .sort((left, right) => (left.updatedAt > right.updatedAt ? -1 : left.updatedAt < right.updatedAt ? 1 : left.missionId < right.missionId ? -1 : 1));
}

/** Shorten a commit sha for display (never for evidence — the full sha is always carried alongside). */
export function shortSha(sha: string): string {
  return sha.length > 12 ? sha.slice(0, 12) : sha;
}
