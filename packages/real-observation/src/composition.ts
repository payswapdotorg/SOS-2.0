/**
 * The real-observation composition — the complete REAL Observation Plane
 * (P17-C): the merged P7 plane (durable P2 store + ingestion pipeline +
 * telemetry runtime + projections + read-only claims port + detection +
 * loop) wired to the REAL sources of this package.
 *
 * Mirrors apps/observation's reference composition one-to-one (the same
 * subject keys, the same coverage/projection/detection wiring) with the
 * reference sources replaced by the real adapters:
 *
 *   github:rest-events:{owner}/{repo}        REST events polling (PAT)
 *   github:webhook                            the webhook-shaped receiver
 *   ci:github-actions:{owner}/{repo}         GitHub Actions runs polling
 *   deploy:vercel                             Vercel deployments API
 *   provider-health:real-probes               real per-provider probes
 *   telemetry:github-rate-limit               real W3 TelemetrySource
 *   telemetry:upstash-redis                   real W3 TelemetrySource
 *   scheduled-probe:*                         real fallback probes
 *
 * Everything is injected (clock, FetchPort, claims, subjects); ZERO
 * ambient network/time/env in this module — the process boundary passes
 * config values explicitly (configFromEnv below is a PURE function over
 * a caller-supplied env record). The plane runs WITHOUT a permanent
 * body: the task and body-lease stores stay empty through full drains.
 */

import { createInMemoryLiveStore } from '@sos-2/live-store';
import type { Clock, InMemoryLiveStore } from '@sos-2/live-store';
import { CoverageLedger, EventIngestionPipeline, ProbeScheduler } from '@sos-2/event-ingestion';
import type { EventSourcePort, ProbePort, ProbeScheduler as ProbeSchedulerType } from '@sos-2/event-ingestion';
import { DetectionEngine, ObservationLoop, ObservationProjections } from '@sos-2/observation';
import type { ObservationDrainReport, ObservedRevision, ProjectionSnapshot, StateRevisionClaim, SystemStateClaimsPort, SubjectQuery } from '@sos-2/observation';
import { TelemetryRuntime } from '@sos-2/telemetry-runtime';
import type { GitHubEventsSource } from './github-events.js';
import type { GitHubCiSource } from './github-ci.js';
import type { VercelDeploymentsSource } from './vercel-deployments.js';
import type { GitHubWebhookReceiver } from './github-webhook.js';
import { GitHubWebhookReceiver as GitHubWebhookReceiverClass } from './github-webhook.js';
import { GitHubEventsSource as GitHubEventsSourceClass } from './github-events.js';
import { GitHubCiSource as GitHubCiSourceClass } from './github-ci.js';
import { VercelDeploymentsSource as VercelDeploymentsSourceClass } from './vercel-deployments.js';
import { ProviderHealthSource as ProviderHealthSourceClass } from './provider-health.js';
import type { ProviderHealthSource } from './provider-health.js';
import { GitHubRateLimitTelemetrySource, UpstashRedisTelemetrySource } from './runtime-telemetry.js';
import type { RealTelemetrySourceAdapter } from './runtime-telemetry.js';
import { RepoHeadProbe, CiLatestProbe, DeploymentLatestProbe } from './scheduled-probes.js';
import { ConnectivityTracker } from './honest-state.js';
import type { SourceConnectivityRecord } from './honest-state.js';
import { TranscriptRecorder } from './transcript.js';
import type { FetchPort } from './http.js';

/** The subject keys the real composition wires (mirrors the reference keys). */
export interface RealObservationSubjects {
  readonly repository: string;
  readonly claimMain: string;
  readonly claimProduction: string;
}

export function defaultSubjects(owner: string, repo: string, branch: string): RealObservationSubjects {
  return {
    repository: `github:repo:${owner}/${repo}`,
    claimMain: `github:repo:${owner}/${repo}@${branch}`,
    claimProduction: 'deploy:environment:production',
  };
}

export interface RealObservationPlaneDeps {
  readonly clock: Clock;
  readonly fetch: FetchPort;
  readonly github: { owner: string; repo: string; branch: string; token: string; tokenEnvName: string; apiBase?: string };
  readonly vercel: { token: string; tokenEnvName: string; apiBase?: string; projectId?: string | null; projectName?: string | null };
  readonly upstash: { restUrl: string; token: string; tokenEnvName: string };
  readonly webhookSecret: { secret: string; secretEnvName: string };
  readonly claims: SystemStateClaimsPort;
  readonly freshAfterMs?: number;
  /** Extra event sources (the webhook receiver attaches as a second github-family source via its own ingestion path). */
  readonly extraSources?: readonly EventSourcePort[];
  /** Extra telemetry sources (e.g. the deployed runtime's JSON metrics endpoint). */
  readonly extraTelemetrySources?: readonly RealTelemetrySourceAdapter[];
  /** Skip the vercel/preview deployment subject, when the deployment plane is out of scope for this composition. */
  readonly withoutVercel?: boolean;
}

export interface RealObservationPlane {
  readonly store: InMemoryLiveStore;
  readonly pipeline: EventIngestionPipeline;
  readonly coverage: CoverageLedger;
  readonly telemetry: TelemetryRuntime;
  readonly projections: ObservationProjections;
  readonly loop: ObservationLoop;
  readonly probes: ProbeSchedulerType | undefined;
  readonly tracker: ConnectivityTracker;
  readonly transcript: TranscriptRecorder;
  readonly githubEvents: GitHubEventsSource;
  readonly githubCi: GitHubCiSource;
  readonly vercelDeployments: VercelDeploymentsSource | null;
  readonly providerHealth: ProviderHealthSource;
  readonly webhookReceiver: GitHubWebhookReceiver;
  readonly telemetrySources: readonly RealTelemetrySourceAdapter[];
  readonly subjects: RealObservationSubjects;
  /** One bounded drain (refresh real telemetry first, then the merged loop drain). */
  drain(): Promise<ObservationDrainReport>;
  /** The honest per-source connectivity snapshot (CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED + probe evidence). */
  connectivity(): readonly SourceConnectivityRecord[];
}

export function createRealObservationPlane(deps: RealObservationPlaneDeps): RealObservationPlane {
  const store = createInMemoryLiveStore();
  const freshAfterMs = deps.freshAfterMs ?? 600_000;
  const tracker = new ConnectivityTracker();
  const transcript = new TranscriptRecorder({
    authorizationReference: (source) => {
      if (source.startsWith('github') || source.includes('rate-limit')) {
        return 'PAYSWAP_GITHUB_TOKEN';
      }
      if (source.startsWith('deploy:vercel')) {
        return 'PAYSWAP_VERCEL_TOKEN';
      }
      if (source.startsWith('upstash')) {
        return 'UPSTASH_REDIS_REST_TOKEN';
      }
      return null;
    },
  });
  const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: deps.clock });

  const githubEvents = new GitHubEventsSourceClass({
    config: { owner: deps.github.owner, repo: deps.github.repo, token: deps.github.token, tokenEnvName: deps.github.tokenEnvName, apiBase: deps.github.apiBase },
    fetch: deps.fetch,
    clock: deps.clock,
    tracker,
    transcript,
  });
  const githubCi = new GitHubCiSourceClass({
    config: { owner: deps.github.owner, repo: deps.github.repo, token: deps.github.token, tokenEnvName: deps.github.tokenEnvName, apiBase: deps.github.apiBase, branch: deps.github.branch },
    fetch: deps.fetch,
    clock: deps.clock,
    tracker,
    transcript,
  });
  const vercelDeployments = deps.withoutVercel
    ? null
    : new VercelDeploymentsSourceClass({
        config: { token: deps.vercel.token, tokenEnvName: deps.vercel.tokenEnvName, apiBase: deps.vercel.apiBase, projectId: deps.vercel.projectId ?? null, projectName: deps.vercel.projectName ?? null, githubRepoFilter: deps.github.repo },
        fetch: deps.fetch,
        clock: deps.clock,
        tracker,
        transcript,
      });
  const providerHealth = new ProviderHealthSourceClass({
    probes: [
      {
        provider: 'github',
        request: { method: 'GET', url: `${deps.github.apiBase ?? 'https://api.github.com'}/rate_limit`, headers: { authorization: `Bearer ${deps.github.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, body: null },
        expectBody: (body) => body.includes('resources'),
        apiRevision: 'github.v3',
      },
      ...(deps.withoutVercel
        ? []
        : [
            {
              provider: 'vercel',
              request: { method: 'GET' as const, url: `${deps.vercel.apiBase ?? 'https://api.vercel.com'}/v6/deployments?limit=1`, headers: { authorization: `Bearer ${deps.vercel.token}` }, body: null },
              expectBody: (body: string) => body.includes('deployments'),
              apiRevision: 'vercel.v6',
            },
          ]),
      {
        provider: 'upstash',
        request: { method: 'POST', url: `${deps.upstash.restUrl}/pipeline`, headers: { authorization: `Bearer ${deps.upstash.token}`, 'content-type': 'application/json' }, body: '[["PING"]]' },
        expectBody: (body) => body.includes('PONG'),
        apiRevision: 'upstash-rest',
      },
    ],
    fetch: deps.fetch,
    clock: deps.clock,
    tracker,
    transcript,
  });

  const subjects = defaultSubjects(deps.github.owner, deps.github.repo, deps.github.branch);
  const repoProbeId = `probe-repo-head:${deps.github.owner}/${deps.github.repo}@${deps.github.branch}`;
  const ciProbeId = `probe-ci-latest:${deps.github.owner}/${deps.github.repo}`;

  const probeDeps = { fetch: deps.fetch, clock: deps.clock, tracker, transcript };
  const probes: ProbePort[] = [
    new RepoHeadProbe({ ...probeDeps, owner: deps.github.owner, repo: deps.github.repo, branch: deps.github.branch, subject: subjects.repository, token: deps.github.token, apiBase: deps.github.apiBase }),
    new CiLatestProbe({ ...probeDeps, owner: deps.github.owner, repo: deps.github.repo, subject: subjects.repository, token: deps.github.token, apiBase: deps.github.apiBase }),
    ...(deps.withoutVercel
      ? []
      : [new DeploymentLatestProbe({ ...probeDeps, subject: subjects.repository, token: deps.vercel.token, apiBase: deps.vercel.apiBase, projectId: deps.vercel.projectId ?? null, githubRepoFilter: deps.github.repo })]),
  ];

  const coverage = new CoverageLedger({
    observationEvents: store.observationEvents,
    clock: deps.clock,
    freshAfterMs,
    subjects: [
      {
        subject: subjects.repository,
        sources: [
          githubEvents.sourceId(),
          githubCi.sourceId(),
          ...(vercelDeployments !== null ? [vercelDeployments.sourceId()] : []),
          `scheduled-probe:${repoProbeId}`,
        ],
      },
    ],
  });

  const repositorySubject: SubjectQuery = { subject: subjects.repository, sources: [githubEvents.sourceId(), 'github:webhook', `scheduled-probe:${repoProbeId}`] };
  const ciSubject: SubjectQuery = { subject: subjects.repository, sources: [githubCi.sourceId(), `scheduled-probe:${ciProbeId}`] };
  const deploymentSubject: SubjectQuery = {
    subject: subjects.repository,
    sources: [...(vercelDeployments !== null ? [vercelDeployments.sourceId()] : []), 'scheduled-probe:probe-deployment-latest'],
  };

  const telemetrySources: RealTelemetrySourceAdapter[] = [
    new GitHubRateLimitTelemetrySource({ clock: deps.clock, fetch: deps.fetch, token: deps.github.token, tokenEnvName: deps.github.tokenEnvName, apiBase: deps.github.apiBase, tracker, transcript }),
    new UpstashRedisTelemetrySource({ clock: deps.clock, fetch: deps.fetch, restUrl: deps.upstash.restUrl, token: deps.upstash.token, tokenEnvName: deps.upstash.tokenEnvName, tracker, transcript }),
    ...(deps.extraTelemetrySources ?? []),
  ];
  const telemetry = new TelemetryRuntime({ sources: telemetrySources, pipeline, clock: deps.clock });

  const probeScheduler = new ProbeScheduler({
    clock: deps.clock,
    isCovered: (subject, family) => coverage.isCovered(subject, family),
    probes,
  });

  const projections = new ObservationProjections({
    observationEvents: store.observationEvents,
    clock: deps.clock,
    freshAfterMs,
    repositorySubjects: [repositorySubject],
    ciSubjects: [ciSubject],
    deploymentSubjects: [deploymentSubject],
    providerHealthSources: [providerHealth.describe().source],
  });

  const detection = new DetectionEngine({
    headRevisionOf: (subject, snapshot) => {
      const projection = snapshot.repositoryHeads.get(subject);
      const head = projection?.branchHeads[deps.github.branch];
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
    repositorySubjects: [subjects.repository],
  });

  /** The telemetry port with the real refresh step: refresh each real source FIRST, then run the merged runtime poll. */
  const telemetryPort = {
    pollAll: async (): Promise<readonly { sourceId: string; captured: number; gaps: number; failure: string | null }[]> => {
      for (const source of telemetrySources) {
        await source.refresh();
      }
      return telemetry.pollAll();
    },
  };

  const loop = new ObservationLoop({
    pipeline,
    sources: [githubEvents, githubCi, ...(vercelDeployments !== null ? [vercelDeployments] : []), providerHealth, ...(deps.extraSources ?? [])],
    probes: probeScheduler,
    telemetry: telemetryPort,
    projections,
    claims: deps.claims,
    detection,
    observeFor: (claim: StateRevisionClaim, snapshot: ProjectionSnapshot): ObservedRevision | undefined => {
      if (claim.subject === subjects.claimMain) {
        const projection = snapshot.repositoryHeads.get(subjects.repository);
        if (projection === undefined) {
          return undefined;
        }
        const head = projection.branchHeads[deps.github.branch];
        return { subject: claim.subject, revision: head ?? null, lastEventAt: projection.lastEventAt, freshness: projection.freshness, evidenceEventIds: projection.foldedEventIds };
      }
      if (claim.subject === subjects.claimProduction) {
        const projection = snapshot.deployments.get(subjects.repository);
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

  const webhookReceiver = new GitHubWebhookReceiverClass({
    secret: deps.webhookSecret.secret,
    secretEnvName: deps.webhookSecret.secretEnvName,
    pipeline,
    clock: deps.clock,
  });

  return {
    store,
    pipeline,
    coverage,
    telemetry,
    projections,
    loop,
    probes: probeScheduler,
    tracker,
    transcript,
    githubEvents,
    githubCi,
    vercelDeployments,
    providerHealth,
    webhookReceiver,
    telemetrySources,
    subjects,
    drain: () => loop.drain(),
    connectivity: () => tracker.snapshot(),
  };
}

/**
 * The PURE environment reader (P17-C). Takes an env RECORD (the process
 * boundary passes process.env; nothing in src touches the ambient
 * environment) and returns the typed real-observation config or a typed
 * error naming the missing variable NAMES (never values).
 */
export interface RealObservationEnvConfig {
  readonly github: { owner: string; repo: string; branch: string; token: string; tokenEnvName: string };
  readonly vercel: { token: string; tokenEnvName: string; projectId: string | null; projectName: string | null };
  readonly upstash: { restUrl: string; token: string; tokenEnvName: string };
  readonly webhookSecret: { secret: string; secretEnvName: string };
}

export function configFromEnv(env: Record<string, string | undefined>): RealObservationEnvConfig {
  const githubToken = env['PAYSWAP_GITHUB_TOKEN'];
  const vercelToken = env['PAYSWAP_VERCEL_TOKEN'];
  const upstashUrl = env['UPSTASH_REDIS_REST_URL'];
  const upstashToken = env['UPSTASH_REDIS_REST_TOKEN'];
  const webhookSecret = env['PAYSWAP_GITHUB_WEBHOOK_SECRET'];
  const owner = env['PAYSWAP_GITHUB_OWNER'];
  const repo = env['PAYSWAP_GITHUB_REPO'];
  const branch = env['PAYSWAP_GITHUB_BRANCH'];
  const vercelProject = env['PAYSWAP_VERCEL_PROJECT'] ?? null;
  const vercelProjectId = env['PAYSWAP_VERCEL_PROJECT_ID'] ?? null;
  const missing: string[] = [];
  if (githubToken === undefined || githubToken === '') missing.push('PAYSWAP_GITHUB_TOKEN');
  if (vercelToken === undefined || vercelToken === '') missing.push('PAYSWAP_VERCEL_TOKEN');
  if (upstashUrl === undefined || upstashUrl === '') missing.push('UPSTASH_REDIS_REST_URL');
  if (upstashToken === undefined || upstashToken === '') missing.push('UPSTASH_REDIS_REST_TOKEN');
  if (owner === undefined || owner === '') missing.push('PAYSWAP_GITHUB_OWNER');
  if (repo === undefined || repo === '') missing.push('PAYSWAP_GITHUB_REPO');
  if (branch === undefined || branch === '') missing.push('PAYSWAP_GITHUB_BRANCH');
  if (missing.length > 0) {
    throw new Error(`REAL_OBSERVATION_CONFIG_INCOMPLETE: missing environment variables (names only): ${missing.join(', ')}`);
  }
  return {
    github: { owner: owner!, repo: repo!, branch: branch!, token: githubToken!, tokenEnvName: 'PAYSWAP_GITHUB_TOKEN' },
    vercel: { token: vercelToken!, tokenEnvName: 'PAYSWAP_VERCEL_TOKEN', projectId: vercelProjectId, projectName: vercelProject },
    upstash: { restUrl: upstashUrl!, token: upstashToken!, tokenEnvName: 'UPSTASH_REDIS_REST_TOKEN' },
    webhookSecret: { secret: webhookSecret ?? 'unset-local-secret', secretEnvName: 'PAYSWAP_GITHUB_WEBHOOK_SECRET' },
  };
}
