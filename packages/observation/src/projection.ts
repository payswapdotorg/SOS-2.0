/**
 * Live projections — deterministic folds over the observation-event
 * stream (§5: "Observation updates System State and Evidence through
 * adapters ... canonical semantics remain in durable stores").
 *
 * A projection is a DERIVED VIEW: it is rebuilt from the durable event
 * list on every read (deterministic order — occurred_at then id), never
 * stored as canonical state, and never written back. Malformed event
 * payloads are counted honestly (malformedEvents) and skipped — a
 * broken event never crashes the fold and never silently projects.
 *
 * Freshness is explicit on every projection (FreshnessMark): FRESH,
 * STALE or NO_DATA — stale/unavailable observation is always
 * distinguishable from success (work-order acceptance).
 */

import type { Clock, ObservationEventRecord, ObservationEventRepository } from '@sos-2/live-store';

/** Explicit freshness, evaluated against the injected clock. */
export interface FreshnessMark {
  readonly state: 'FRESH' | 'STALE' | 'NO_DATA';
  readonly lastEventAt: string | null;
  readonly evaluatedAt: string;
  /** The freshness window (milliseconds) this mark was evaluated with. */
  readonly freshAfterMs: number;
}

/** Which sources observe a subject (composition wiring — never guessed). */
export interface SubjectQuery {
  /** Logical subject label used as the projection key. */
  readonly subject: string;
  /** Event source ids whose events observe this subject. */
  readonly sources: readonly string[];
}

export interface PullRequestView {
  readonly number: number;
  readonly head: string;
  readonly base: string;
  readonly openedAt: string;
}

export interface RepositoryHeadProjection {
  readonly subject: string;
  /** branch name -> head commit sha (updated by github.push events). */
  readonly branchHeads: Readonly<Record<string, string>>;
  readonly openPullRequests: readonly PullRequestView[];
  readonly lastEventAt: string | null;
  readonly freshness: FreshnessMark;
  readonly malformedEvents: number;
  /** Event ids that produced this projection, in fold (chronological) order. */
  readonly foldedEventIds: readonly string[];
}

export interface CiRunView {
  readonly runId: string;
  readonly ref: string;
  /** Capture-level truth state carried from the CI event payload, verbatim. */
  readonly status: string;
  readonly occurredAt: string;
}

export interface CiProjection {
  readonly subject: string;
  /** pipeline -> latest run (latest by (occurred_at, run id)). */
  readonly latestByPipeline: Readonly<Record<string, CiRunView>>;
  readonly lastEventAt: string | null;
  readonly freshness: FreshnessMark;
  readonly malformedEvents: number;
  /** Event ids that produced this projection, in fold (chronological) order. */
  readonly foldedEventIds: readonly string[];
}

export interface DeployedRevisionView {
  readonly revision: string;
  readonly since: string;
}

export interface DeploymentProjection {
  readonly subject: string;
  /** environment -> currently-deployed revision (latest deployment.change per environment). */
  readonly deployedByEnvironment: Readonly<Record<string, DeployedRevisionView>>;
  readonly lastEventAt: string | null;
  readonly freshness: FreshnessMark;
  readonly malformedEvents: number;
  /** Event ids that produced this projection, in fold (chronological) order. */
  readonly foldedEventIds: readonly string[];
}

export interface HealthSignalView {
  readonly provider: string;
  readonly status: string;
  readonly at: string;
}

export interface ProviderHealthProjection {
  readonly lastSignalByProvider: Readonly<Record<string, HealthSignalView>>;
  readonly lastEventAt: string | null;
  readonly freshness: FreshnessMark;
  readonly malformedEvents: number;
  /** Event ids that produced this projection, in fold (chronological) order. */
  readonly foldedEventIds: readonly string[];
}

export interface ProjectionSnapshot {
  readonly repositoryHeads: ReadonlyMap<string, RepositoryHeadProjection>;
  readonly ci: ReadonlyMap<string, CiProjection>;
  readonly deployments: ReadonlyMap<string, DeploymentProjection>;
  readonly providerHealth: ProviderHealthProjection;
}

export interface ObservationProjectionsDeps {
  readonly observationEvents: ObservationEventRepository;
  readonly clock: Clock;
  /** Freshness window in milliseconds. */
  readonly freshAfterMs: number;
  /** Subjects to project (the caller's wiring of sources to subjects). */
  readonly repositorySubjects: readonly SubjectQuery[];
  readonly ciSubjects: readonly SubjectQuery[];
  readonly deploymentSubjects: readonly SubjectQuery[];
  readonly providerHealthSources: readonly string[];
}

export class ObservationProjections {
  private readonly observationEvents: ObservationEventRepository;
  private readonly clock: Clock;
  private readonly freshAfterMs: number;
  private readonly repositorySubjects: readonly SubjectQuery[];
  private readonly ciSubjects: readonly SubjectQuery[];
  private readonly deploymentSubjects: readonly SubjectQuery[];
  private readonly providerHealthSources: readonly string[];

  constructor(deps: ObservationProjectionsDeps) {
    this.observationEvents = deps.observationEvents;
    this.clock = deps.clock;
    this.freshAfterMs = deps.freshAfterMs;
    this.repositorySubjects = deps.repositorySubjects;
    this.ciSubjects = deps.ciSubjects;
    this.deploymentSubjects = deps.deploymentSubjects;
    this.providerHealthSources = deps.providerHealthSources;
  }

  /** Full snapshot for all configured subjects. */
  async snapshot(): Promise<ProjectionSnapshot> {
    const events = await this.allEvents();
    const repositoryHeads = new Map<string, RepositoryHeadProjection>();
    for (const query of this.repositorySubjects) {
      repositoryHeads.set(query.subject, this.foldRepositoryHead(query, events));
    }
    const ci = new Map<string, CiProjection>();
    for (const query of this.ciSubjects) {
      ci.set(query.subject, this.foldCi(query, events));
    }
    const deployments = new Map<string, DeploymentProjection>();
    for (const query of this.deploymentSubjects) {
      deployments.set(query.subject, this.foldDeployments(query, events));
    }
    const providerHealth = this.foldProviderHealth(events);
    return { repositoryHeads, ci, deployments, providerHealth };
  }

  private async allEvents(): Promise<readonly ObservationEventRecord[]> {
    const collected: ObservationEventRecord[] = [];
    let afterId: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const result = await this.observationEvents.list({ limit: 1000, after_id: afterId });
      collected.push(...result.items);
      if (result.next_after_id === null) {
        break;
      }
      afterId = result.next_after_id;
    }
    return collected;
  }

  private foldRepositoryHead(query: SubjectQuery, events: readonly ObservationEventRecord[]): RepositoryHeadProjection {
    const relevant = ordered(events.filter((event) => query.sources.includes(event.source) && (event.kind === 'github.push' || event.kind === 'github.pull_request' || event.kind === 'scheduled-probe.result')));
    const branchHeads: Record<string, string> = {};
    const openPulls = new Map<number, PullRequestView>();
    let malformed = 0;
    let lastEventAt: string | null = null;
    const foldedEventIds: string[] = [];
    for (const event of relevant) {
      foldedEventIds.push(event.id);
      const payload = asObject(event.payload);
      if (payload === null) {
        malformed += 1;
        continue;
      }
      if (event.kind === 'github.push') {
        const ref = typeof payload['ref'] === 'string' ? payload['ref'] : null;
        const after = typeof payload['after'] === 'string' ? payload['after'] : null;
        if (ref === null || after === null) {
          malformed += 1;
          continue;
        }
        branchHeads[branchName(ref)] = after;
      } else if (event.kind === 'github.pull_request') {
        const action = typeof payload['action'] === 'string' ? payload['action'] : null;
        const number = typeof payload['number'] === 'number' ? payload['number'] : null;
        const head = typeof payload['head'] === 'string' ? payload['head'] : null;
        const base = typeof payload['base'] === 'string' ? payload['base'] : null;
        if (action === null || number === null || head === null || base === null) {
          malformed += 1;
          continue;
        }
        if (action === 'opened' || action === 'reopened') {
          openPulls.set(number, { number, head, base, openedAt: event.occurred_at });
        } else if (action === 'closed') {
          openPulls.delete(number);
        } else {
          malformed += 1;
        }
      } else if (event.kind === 'scheduled-probe.result') {
        // probe results carry subject_ref + branch + head — they fill
        // branch heads ONLY where no organic push exists (fold order is
        // chronological; organic pushes overwrite probe heads by order).
        const branch = typeof payload['branch'] === 'string' ? payload['branch'] : null;
        const head = typeof payload['head'] === 'string' ? payload['head'] : null;
        if (branch === null || head === null) {
          malformed += 1;
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(branchHeads, branch)) {
          branchHeads[branch] = head;
        }
      }
      lastEventAt = laterOf(lastEventAt, event.occurred_at);
    }
    return {
      subject: query.subject,
      branchHeads,
      openPullRequests: [...openPulls.values()].sort((left, right) => left.number - right.number),
      lastEventAt,
      freshness: this.freshness(lastEventAt),
      malformedEvents: malformed,
      foldedEventIds,
    };
  }

  private foldCi(query: SubjectQuery, events: readonly ObservationEventRecord[]): CiProjection {
    const relevant = ordered(events.filter((event) => query.sources.includes(event.source) && (event.kind === 'ci.run' || event.kind === 'scheduled-probe.result')));
    const latestByPipeline: Record<string, CiRunView> = {};
    let malformed = 0;
    let lastEventAt: string | null = null;
    const foldedEventIds: string[] = [];
    for (const event of relevant) {
      foldedEventIds.push(event.id);
      const payload = asObject(event.payload);
      if (payload === null) {
        malformed += 1;
        continue;
      }
      const pipeline = typeof payload['pipeline'] === 'string' ? payload['pipeline'] : null;
      const ref = typeof payload['ref'] === 'string' ? payload['ref'] : null;
      const status = typeof payload['status'] === 'string' ? payload['status'] : null;
      const runId = typeof payload['runId'] === 'string' ? payload['runId'] : null;
      if (pipeline === null || ref === null || status === null || runId === null || event.kind !== 'ci.run') {
        malformed += 1;
        continue;
      }
      const view: CiRunView = { runId, ref, status, occurredAt: event.occurred_at };
      const existing = latestByPipeline[pipeline];
      if (existing === undefined || view.occurredAt > existing.occurredAt || (view.occurredAt === existing.occurredAt && view.runId > existing.runId)) {
        latestByPipeline[pipeline] = view;
      }
      lastEventAt = laterOf(lastEventAt, event.occurred_at);
    }
    return { subject: query.subject, latestByPipeline, lastEventAt, freshness: this.freshness(lastEventAt), malformedEvents: malformed, foldedEventIds };
  }

  private foldDeployments(query: SubjectQuery, events: readonly ObservationEventRecord[]): DeploymentProjection {
    const relevant = ordered(events.filter((event) => query.sources.includes(event.source) && event.kind === 'deployment.change'));
    const deployedByEnvironment: Record<string, DeployedRevisionView> = {};
    let malformed = 0;
    let lastEventAt: string | null = null;
    const foldedEventIds: string[] = [];
    for (const event of relevant) {
      foldedEventIds.push(event.id);
      const payload = asObject(event.payload);
      if (payload === null) {
        malformed += 1;
        continue;
      }
      const environment = typeof payload['environment'] === 'string' ? payload['environment'] : null;
      const revision = typeof payload['revision'] === 'string' ? payload['revision'] : null;
      const action = typeof payload['action'] === 'string' ? payload['action'] : null;
      if (environment === null || revision === null || (action !== 'deployed' && action !== 'rolled-back')) {
        malformed += 1;
        continue;
      }
      const existing = deployedByEnvironment[environment];
      const view: DeployedRevisionView = { revision, since: event.occurred_at };
      if (existing === undefined || view.since >= existing.since) {
        deployedByEnvironment[environment] = view;
      }
      lastEventAt = laterOf(lastEventAt, event.occurred_at);
    }
    return { subject: query.subject, deployedByEnvironment, lastEventAt, freshness: this.freshness(lastEventAt), malformedEvents: malformed, foldedEventIds };
  }

  private foldProviderHealth(events: readonly ObservationEventRecord[]): ProviderHealthProjection {
    const relevant = ordered(events.filter((event) => this.providerHealthSources.includes(event.source) && event.kind === 'provider-health.signal'));
    const lastSignalByProvider: Record<string, HealthSignalView> = {};
    let malformed = 0;
    let lastEventAt: string | null = null;
    const foldedEventIds: string[] = [];
    for (const event of relevant) {
      foldedEventIds.push(event.id);
      const payload = asObject(event.payload);
      if (payload === null) {
        malformed += 1;
        continue;
      }
      const provider = typeof payload['provider'] === 'string' ? payload['provider'] : null;
      const status = typeof payload['status'] === 'string' ? payload['status'] : null;
      if (provider === null || status === null) {
        malformed += 1;
        continue;
      }
      const view: HealthSignalView = { provider, status, at: event.occurred_at };
      const existing = lastSignalByProvider[provider];
      if (existing === undefined || view.at >= existing.at) {
        lastSignalByProvider[provider] = view;
      }
      lastEventAt = laterOf(lastEventAt, event.occurred_at);
    }
    return { lastSignalByProvider, lastEventAt, freshness: this.freshness(lastEventAt), malformedEvents: malformed, foldedEventIds };
  }

  private freshness(lastEventAt: string | null): FreshnessMark {
    const evaluatedAt = new Date(this.clock.nowEpochMs()).toISOString();
    if (lastEventAt === null) {
      return { state: 'NO_DATA', lastEventAt: null, evaluatedAt, freshAfterMs: this.freshAfterMs };
    }
    const ageMs = this.clock.nowEpochMs() - Date.parse(lastEventAt);
    return { state: ageMs <= this.freshAfterMs ? 'FRESH' : 'STALE', lastEventAt, evaluatedAt, freshAfterMs: this.freshAfterMs };
  }
}

function ordered(events: readonly ObservationEventRecord[]): readonly ObservationEventRecord[] {
  return [...events].sort((left, right) => {
    if (left.occurred_at !== right.occurred_at) {
      return left.occurred_at < right.occurred_at ? -1 : 1;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function asObject(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

function branchName(ref: string): string {
  const prefix = 'refs/heads/';
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

function laterOf(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left >= right ? left : right;
}
