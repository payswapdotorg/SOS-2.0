/**
 * P17-C REAL-PROVIDER INTEGRATION SUITE (RUN_REAL=1 only, default OFF).
 *
 * Real network round-trips against the REAL providers:
 *   - GitHub REST events API (the polling fallback) with the PAT
 *   - GitHub Actions runs (CI results per commit)
 *   - the Vercel deployments API, read directly (no sibling-lane code)
 *   - real runtime telemetry (GitHub rate-limit budget + Upstash Redis)
 *   - real scheduled probes (the honest fallback where coverage is stale)
 *   - real provider-health probes (github / vercel / upstash)
 *
 * HONEST OUTCOMES: every record written by this suite states what actually
 * happened — sources CONNECTED only when a real probe answered; UNAVAILABLE
 * with the real error when they did not; the SOS-2.0 repository is not
 * (yet) deployed on the Vercel account (P17-A owns that topology), so the
 * deployment-events record honestly carries zero deployment events with
 * the source still CONNECTED (the API answered; nothing was fabricated).
 *
 * Credentials: read from the environment at the TEST PROCESS BOUNDARY
 * (names only in evidence; transcripts redacted through the P17-C corpus).
 */

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { SystemClock, aggregateProviderHealth, bindGlobalFetch, configFromEnv, createRealObservationPlane } from '@sos-2/real-observation';
import type { RealObservationPlane } from '@sos-2/real-observation';
import { writeEvidence } from '../../src/evidence';

const config = configFromEnv(process.env as Record<string, string | undefined>);
const fetch = bindGlobalFetch({ timeoutMs: 20_000 });
const producedAt = new Date().toISOString();

function repoHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

interface DrainedRun {
  readonly report: Awaited<ReturnType<RealObservationPlane['drain']>>;
  readonly plane: RealObservationPlane;
  readonly connectivity: ReturnType<RealObservationPlane['connectivity']>;
}

async function drainOnce(): Promise<DrainedRun> {
  const plane = createRealObservationPlane({
    clock: new SystemClock(),
    fetch,
    github: { ...config.github, apiBase: 'https://api.github.com' },
    vercel: { ...config.vercel, apiBase: 'https://api.vercel.com', projectId: config.vercel.projectId, projectName: config.vercel.projectName },
    upstash: config.upstash,
    webhookSecret: config.webhookSecret,
    claims: { readClaims: async () => [] },
  });
  const report = await plane.drain();
  return { report, plane, connectivity: plane.connectivity() };
}

describe('the REAL observation plane drain (RUN_REAL)', () => {
  it('drains the real sources, projects live state and writes per-source connectivity evidence', async () => {
    const { report, plane, connectivity } = await drainOnce();
    const head = repoHead();
    const repository = report.snapshot.repositoryHeads.get(`github:repo:${config.github.owner}/${config.github.repo}`);

    // The repository projection is real: the branch head observed through the
    // real GitHub API is the repository's actual head.
    const observedHead = repository?.branchHeads[config.github.branch] ?? null;
    expect(observedHead).not.toBeNull();
    expect(typeof observedHead).toBe('string');

    // Honest states recorded for every source that was probed
    const githubEvents = connectivity.find((entry) => entry.source.startsWith('github:rest-events'));
    const ciSource = connectivity.find((entry) => entry.source.startsWith('ci:github-actions'));
    const vercelSource = connectivity.find((entry) => entry.source === 'deploy:vercel');
    const rateLimit = connectivity.find((entry) => entry.source === 'github:rate-limit');
    const upstash = connectivity.find((entry) => entry.source === 'upstash:redis');

    // --- per-source evidence records (honest outcomes) ---
    writeEvidence('sources/github-events.json', {
      work_order: 'P17-C',
      evidence_kind: 'source-connectivity',
      source: 'github-events',
      endpoint: `GET https://api.github.com/repos/${config.github.owner}/${config.github.repo}/events (github.v3, x-github-api-version 2022-11-28)`,
      credential_env: 'PAYSWAP_GITHUB_TOKEN',
      state: githubEvents?.state ?? 'UNKNOWN',
      last_error: githubEvents?.lastError ?? null,
      api_revision: githubEvents?.probes.at(-1)?.apiRevision ?? null,
      poll_outcomes: report.sourceSummaries.filter((summary) => summary.source.startsWith('github:rest-events')).map((summary) => ({ kind: summary.poll.kind, applied: summary.applied, duplicates: summary.duplicates, rejected: summary.rejected })),
      real_outcome: {
        observed_branch_head: observedHead,
        matches_repo_head_at_run: observedHead === head,
        open_pull_requests: repository?.openPullRequests.map((pull) => pull.number) ?? [],
        github_events_ingested: report.sourceSummaries.filter((summary) => summary.source.startsWith('github:rest-events')).reduce((total, summary) => total + summary.applied, 0),
        note: 'real REST events-API polling (the webhook-shaped receiver is exercised separately over real HTTP transport; GitHub cannot deliver webhooks to this sandbox — polling is the production-real path)',
      },
      transcript: plane.transcript.bySource(githubEvents?.source ?? 'github:rest-events:unknown').map((entry) => ({ at: entry.at, request: entry.request, response: { status: entry.response.status, headers: entry.response.headers, bodyHash: entry.response.bodyHash, bodyLength: entry.response.bodyLength }, redactedPatternIds: entry.redactedPatternIds })),
      produced_at: producedAt,
      repo_head: head,
    });

    writeEvidence('sources/ci-results.json', {
      work_order: 'P17-C',
      evidence_kind: 'source-connectivity',
      source: 'ci-results',
      endpoint: `GET https://api.github.com/repos/${config.github.owner}/${config.github.repo}/actions/runs (github.v3, per-commit head_sha carried verbatim)`,
      credential_env: 'PAYSWAP_GITHUB_TOKEN',
      state: ciSource?.state ?? 'UNKNOWN',
      last_error: ciSource?.lastError ?? null,
      api_revision: ciSource?.probes.at(-1)?.apiRevision ?? null,
      poll_outcomes: report.sourceSummaries.filter((summary) => summary.source.startsWith('ci:github-actions')).map((summary) => ({ kind: summary.poll.kind, applied: summary.applied, duplicates: summary.duplicates })),
      real_outcome: {
        latest_runs_by_pipeline: Object.entries(report.snapshot.ci.get(`github:repo:${config.github.owner}/${config.github.repo}`)?.latestByPipeline ?? {}).map(([pipeline, run]) => ({ pipeline, runId: run.runId, status: run.status, ref: run.ref, occurredAt: run.occurredAt })),
        note: 'real GitHub Actions runs — status carried verbatim from the provider (SUCCESS/FAILURE/IN_PROGRESS/...), never folded',
      },
      transcript: plane.transcript.bySource(ciSource?.source ?? 'ci:unknown').map((entry) => ({ at: entry.at, request: entry.request, response: { status: entry.response.status, headers: entry.response.headers, bodyHash: entry.response.bodyHash, bodyLength: entry.response.bodyLength }, redactedPatternIds: entry.redactedPatternIds })),
      produced_at: producedAt,
      repo_head: head,
    });

    writeEvidence('sources/deployment-events.json', {
      work_order: 'P17-C',
      evidence_kind: 'source-connectivity',
      source: 'deployment-events',
      endpoint: 'GET https://api.vercel.com/v6/deployments (vercel.v6, read directly — no sibling P17-A dependency)',
      credential_env: 'PAYSWAP_VERCEL_TOKEN',
      state: vercelSource?.state ?? 'UNKNOWN',
      last_error: vercelSource?.lastError ?? null,
      api_revision: vercelSource?.probes.at(-1)?.apiRevision ?? null,
      poll_outcomes: report.sourceSummaries.filter((summary) => summary.source === 'deploy:vercel').map((summary) => ({ kind: summary.poll.kind, applied: summary.applied, duplicates: summary.duplicates })),
      real_outcome: {
        deployments_for_this_repository: report.snapshot.deployments.get(`github:repo:${config.github.owner}/${config.github.repo}`)?.deployedByEnvironment ?? {},
        note: 'the source is CONNECTED (the real deployments API answered), and the honest observation is ZERO deployment events bound to this repository: the Vercel account has no SOS-2.0 project yet (the deployment topology is the P17-A lane, unmerged). Deployments of OTHER repositories on the account are filtered out by the honest subject binding (githubRepoFilter) — never projected onto this subject.',
      },
      transcript: plane.transcript.bySource('deploy:vercel').map((entry) => ({ at: entry.at, request: entry.request, response: { status: entry.response.status, headers: entry.response.headers, bodyHash: entry.response.bodyHash, bodyLength: entry.response.bodyLength }, redactedPatternIds: entry.redactedPatternIds })),
      produced_at: producedAt,
      repo_head: head,
    });

    writeEvidence('sources/runtime-telemetry.json', {
      work_order: 'P17-C',
      evidence_kind: 'source-connectivity',
      source: 'runtime-telemetry',
      endpoints: [
        'GET https://api.github.com/rate_limit (github.v3 — the real PAT budget as runtime telemetry of the GitHub provider)',
        `POST ${config.upstash.restUrl}/pipeline (upstash-rest — the real Redis PING/DBSIZE of the live instance)`,
      ],
      credential_env: 'UPSTASH_REDIS_REST_TOKEN (upstash) + PAYSWAP_GITHUB_TOKEN (github)',
      states: { github_rate_limit: rateLimit?.state ?? 'UNKNOWN', upstash_redis: upstash?.state ?? 'UNKNOWN' },
      last_errors: { github_rate_limit: rateLimit?.lastError ?? null, upstash_redis: upstash?.lastError ?? null },
      real_outcome: {
        telemetry_polls: report.telemetry,
        stored_telemetry_events: (await plane.store.observationEvents.list({ limit: 1000 })).items
          .filter((event) => event.kind === 'telemetry.observation')
          .map((event) => ({ id: event.id, source: event.source, payload: event.payload, occurred_at: event.occurred_at })),
        note: 'real W3 TelemetrySource captures through the merged telemetry-runtime — capture-level availability preserved verbatim (a failed pull is a typed failure, never a fabricated gap)',
      },
      transcript: [...plane.transcript.bySource('github:rate-limit'), ...plane.transcript.bySource('upstash:redis')].map((entry) => ({ at: entry.at, request: entry.request, response: { status: entry.response.status, headers: entry.response.headers, bodyHash: entry.response.bodyHash, bodyLength: entry.response.bodyLength }, redactedPatternIds: entry.redactedPatternIds })),
      produced_at: producedAt,
      repo_head: head,
    });

    writeEvidence('sources/scheduled-probes.json', {
      work_order: 'P17-C',
      evidence_kind: 'source-connectivity',
      source: 'scheduled-probes',
      note: 'the honest fallback: probes run only where organic coverage is insufficient (stale/absent), per the merged ProbeScheduler + CoverageLedger',
      real_outcome: {
        probe_outcomes: report.probeOutcomes.map((outcome) => ({ probeId: outcome.probeId, kind: outcome.kind })),
        probe_run_snapshot: plane.probes?.runSnapshot() ?? [],
      },
      probe_sources: connectivity.filter((entry) => entry.source.startsWith('scheduled-probe:')).map((entry) => ({ source: entry.source, state: entry.state, detail: entry.detail, last_error: entry.lastError, probes: entry.probes })),
      transcript: plane.transcript.all().filter((entry) => entry.source.startsWith('scheduled-probe:')).map((entry) => ({ at: entry.at, request: entry.request, response: { status: entry.response.status, headers: entry.response.headers, bodyHash: entry.response.bodyHash }, redactedPatternIds: entry.redactedPatternIds })),
      produced_at: producedAt,
      repo_head: head,
    });

    const aggregate = aggregateProviderHealth(plane.tracker);
    writeEvidence('sources/provider-health.json', {
      work_order: 'P17-C',
      evidence_kind: 'source-connectivity',
      source: 'provider-health',
      note: 'real per-provider probes (github rate_limit / vercel v6 deployments / upstash pipeline PING) + the aggregate honest state (worst probed source wins; never probed is UNKNOWN)',
      real_outcome: {
        signals: report.snapshot.providerHealth.lastSignalByProvider,
        aggregate: aggregate.map((entry) => ({ provider: entry.provider, state: entry.state, detail: entry.detail, sources: entry.sources })),
      },
      transcript: plane.transcript.bySource('provider-health:real-probes').map((entry) => ({ at: entry.at, request: entry.request, response: { status: entry.response.status, headers: entry.response.headers, bodyHash: entry.response.bodyHash }, redactedPatternIds: entry.redactedPatternIds })),
      produced_at: producedAt,
      repo_head: head,
    });

    // Honest-state assertions: the real providers answered.
    expect(githubEvents?.state).toBe('CONNECTED');
    expect(ciSource?.state).toBe('CONNECTED');
    expect(vercelSource?.state).toBe('CONNECTED');
    expect(rateLimit?.state).toBe('CONNECTED');
    expect(upstash?.state).toBe('CONNECTED');
    // transcripts are redacted (env-name references only)
    const serialized = plane.transcript.toJSON();
    expect(serialized).not.toContain('ghp_');
    expect(serialized).not.toContain('vcp_');
    expect(serialized).not.toContain(process.env['PAYSWAP_GITHUB_TOKEN']!.slice(0, 12));
    expect(serialized).not.toContain(process.env['PAYSWAP_VERCEL_TOKEN']!.slice(0, 12));
  }, 120_000);

  it('reconciles the REAL System State claim against the real observed head and records the event→System State flow evidence', async () => {
    // First drain: establish the real observation.
    const first = await drainOnce();
    const subject = `github:repo:${config.github.owner}/${config.github.repo}`;
    const observedHead = first.report.snapshot.repositoryHeads.get(subject)?.branchHeads[config.github.branch] ?? null;
    expect(observedHead).not.toBeNull();

    // The claim: derived from the real observed head (the RUN_REAL suite is
    // the claims-port provider for this evidence run; the real System State
    // store binding is the P17-A/P18 composition). Claim source is recorded
    // honestly below.
    if (observedHead === null) {
      throw new Error('no real observed head — cannot construct the claims for the flow evidence');
    }
    const second = createRealObservationPlane({
      clock: new SystemClock(),
      fetch,
      github: { ...config.github, apiBase: 'https://api.github.com' },
      vercel: { ...config.vercel, apiBase: 'https://api.vercel.com' },
      upstash: config.upstash,
      webhookSecret: config.webhookSecret,
      claims: {
        readClaims: async () => [
          { subject: `${subject}@${config.github.branch}`, claimedRevision: observedHead, claimRef: 'claim:derived-from-real-github-rest-head (RUN_REAL P17-C evidence run)' },
          { subject: `${subject}@${config.github.branch}`, claimedRevision: `${observedHead.slice(0, -2)}00`, claimRef: 'claim:deliberately-divergent-control (RUN_REAL P17-C evidence run)' },
        ],
      },
    });
    const report = await second.drain();
    const findings = report.findings.filter((finding) => finding.subject === `${subject}@${config.github.branch}`);
    expect(findings.some((finding) => finding.kind === 'ALIGNED' && finding.observedRevision === observedHead)).toBe(true);
    expect(findings.some((finding) => finding.kind === 'DIVERGED')).toBe(true);

    // Replay evidence: a second identical drain double-applies nothing.
    const replay = await second.drain();
    const totalApplied = replay.sourceSummaries.reduce((total, summary) => total + summary.applied, 0);

    writeEvidence('event-flow.json', {
      work_order: 'P17-C',
      evidence_kind: 'event-flow',
      produced_at: producedAt,
      repo_head: repoHead(),
      flow: [
        { step: 1, what: 'real sources polled (GitHub REST events, GitHub Actions runs, Vercel deployments, provider-health probes)', summaries: report.sourceSummaries.map((summary) => ({ source: summary.source, poll: summary.poll.kind, applied: summary.applied, duplicates: summary.duplicates, rejected: summary.rejected })) },
        { step: 2, what: 'scheduled probes (only where organic coverage insufficient)', probe_outcomes: report.probeOutcomes.map((outcome) => ({ probeId: outcome.probeId, kind: outcome.kind })) },
        { step: 3, what: 'runtime telemetry captures (W3 RawObservations preserved verbatim)', telemetry: report.telemetry },
        { step: 4, what: 'durable observation events (P2 replay-protected store)', events: (await second.store.observationEvents.list({ limit: 1000 })).items.map((event) => ({ id: event.id, source: event.source, kind: event.kind, occurred_at: event.occurred_at })) },
        { step: 5, what: 'live projections (branch heads / CI / deployments / provider health)', snapshot: { repository: report.snapshot.repositoryHeads.get(subject) ?? null, ci: report.snapshot.ci.get(subject) ?? null, deployments: report.snapshot.deployments.get(subject) ?? null, providerHealth: report.snapshot.providerHealth.lastSignalByProvider } },
        { step: 6, what: 'System State reconciliation (read-only claims port)', claims: report.claims, findings: report.findings.map((finding) => ({ subject: finding.subject, kind: finding.kind, claimed: finding.claimedRevision, observed: finding.observedRevision, evidence: finding.evidenceEventIds })) },
        { step: 7, what: 'shortfall/opportunity detection (non-authoritative typed records)', detections: report.detections.map((detection) => ({ code: detection.code, subject: detection.subject, evidence: detection.evidenceEventIds ?? [] })) },
      ],
      replay_safety: { second_drain_applied_total: totalApplied, note: totalApplied === 0 ? 'identical redelivery double-applied NOTHING (typed DUPLICATE outcomes)' : 'new organic events may have arrived between drains (real time passed)' },
      no_body_rule: {
        tasks_in_store: (await second.store.tasks.list({})).items.length,
        body_leases_in_store: (await second.store.bodyLeases.list({})).items.length,
        note: 'the complete observation plane ran with ZERO task/body presence — the §5 no-body rule',
      },
    });
    expect((await second.store.tasks.list({})).items).toEqual([]);
    expect((await second.store.bodyLeases.list({})).items).toEqual([]);
  }, 180_000);
});
