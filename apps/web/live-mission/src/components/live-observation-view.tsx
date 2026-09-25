/**
 * The live observation view (Work Order P17-C): the honest real-source
 * states, the repository branch heads with freshness, the latest CI runs
 * (status verbatim), the deployed revisions, the reconciliation findings
 * (ALIGNED / DIVERGED / UNVERIFIED / STALE — retained uncertainty stays
 * VISIBLE), the detections and the provider health signals — all LIVE
 * provenance, all carrying their evidence event ids.
 */

import type { LiveObservationData } from '../view-state/live-mission-dto';
import { dataSourceOf, heroView, sortedBranches, sortedCiRuns, sortedDeployments, sortedFindings, sortedSources, sourceRowView } from '../view-state/live-mission-view';
import { shortSha } from '../view-state/live-mission-view';
import { Card, Row } from '../../../shell/components/card';
import { ValueChip } from '../../../shell/components/chips';
import { LiveCard, LiveReviewBlock, SourceStateChip, WatchingNote } from './shared';

const FRESHNESS_LABEL: Record<string, string> = {
  FRESH: 'fresh',
  STALE: 'stale — older than the freshness window',
  NO_DATA: 'no data yet',
};

export function LiveObservationView({ data }: { data: LiveObservationData }) {
  const hero = heroView(data);
  const source = dataSourceOf(data);
  return (
    <div className="space-y-4">
      <LiveCard id="live-observation-status" title="Live observation" storeRef={source.store_ref} asOf={source.as_of}>
        <p className="text-sm text-ink">{hero.review.what}</p>
        <p className="mt-2 flex flex-wrap gap-1.5">
          <ValueChip label="events in window" value={String(data.eventsInWindow)} />
          <ValueChip label="drained at" value={data.drainedAt ?? 'never'} />
          <ValueChip label="store" value={data.storeRef} />
        </p>
        <WatchingNote watchingWithoutBody={data.watchingWithoutBody} />
        <LiveReviewBlock review={hero.review} />
      </LiveCard>

      <LiveCard id="live-observation-sources" title="Real sources — honest states" storeRef={source.store_ref} asOf={source.as_of}>
        {data.sources.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No source has been probed yet — every source would read UNKNOWN here (absence of information is never health; live wiring mounts with the architect&apos;s
            integration pass).
          </p>
        ) : (
          <ul className="space-y-3">
            {sortedSources(data.sources).map((entry) => {
              const row = sourceRowView(entry);
              return (
                <li key={row.source.source} className="rounded-lg border border-line bg-surface p-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">{row.source.source}</span>
                    <SourceStateChip state={row.source.state} />
                    <ValueChip label="family" value={row.source.family} />
                    {row.source.apiRevision !== null ? <ValueChip label="api" value={row.source.apiRevision} /> : null}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">{row.source.detail}</p>
                  {row.source.lastError !== null ? (
                    <p className="mt-1 rounded-md border border-stop/30 bg-stop-soft p-2 text-xs text-stop" role="note">
                      <span className="sr-only">The real recorded error: </span>
                      {row.source.lastError}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </LiveCard>

      <LiveCard id="live-observation-repository" title="Repository — branch heads" storeRef={source.store_ref} asOf={source.as_of}>
        <p className="text-sm text-ink-soft">
          Subject <code className="rounded bg-surface-warm px-1 py-0.5">{data.repository.subject}</code> — {FRESHNESS_LABEL[data.repository.freshness] ?? data.repository.freshness}.
        </p>
        {data.repository.branchHeads.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">No branch head observed yet (NO_DATA — never fabricated).</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sortedBranches(data.repository.branchHeads).map((head) => (
              <li key={head.branch} className="rounded-lg border border-line bg-surface p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{head.branch}</span>
                  <ValueChip label="head" value={head.head} />
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  last event {head.lastEventAt ?? 'none'} · evidence {head.evidenceEventIds.length > 0 ? head.evidenceEventIds.slice(0, 3).join(', ') : '—'}
                </p>
              </li>
            ))}
          </ul>
        )}
        {data.repository.openPullRequests.length > 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            {data.repository.openPullRequests.length} open pull request(s):{' '}
            {data.repository.openPullRequests.map((pull) => `#${String(pull.number)} (${shortSha(pull.head)} → ${pull.base})`).join(', ')}
          </p>
        ) : null}
      </LiveCard>

      <LiveCard id="live-observation-ci" title="CI — latest runs" storeRef={source.store_ref} asOf={source.as_of}>
        <p className="text-sm text-ink-soft">{FRESHNESS_LABEL[data.ci.freshness] ?? data.ci.freshness} — status carried verbatim from the provider.</p>
        {data.ci.latestByPipeline.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">No CI run observed yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sortedCiRuns(data.ci.latestByPipeline).map((run) => (
              <li key={run.pipeline} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
                <span className="font-medium text-ink">{run.pipeline}</span>
                <ValueChip label="run" value={run.runId} />
                <ValueChip label="commit" value={shortSha(run.ref)} />
                <ValueChip label="status" value={run.status} />
                <span className="text-xs text-ink-soft">{run.occurredAt}</span>
              </li>
            ))}
          </ul>
        )}
      </LiveCard>

      <LiveCard id="live-observation-deployments" title="Deployments" storeRef={source.store_ref} asOf={source.as_of}>
        <p className="text-sm text-ink-soft">{FRESHNESS_LABEL[data.deployments.freshness] ?? data.deployments.freshness}.</p>
        {data.deployments.byEnvironment.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">No deployment observed yet — an honestly empty projection, never a fabricated one.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sortedDeployments(data.deployments.byEnvironment).map((deployment) => (
              <li key={deployment.environment} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
                <span className="font-medium text-ink">{deployment.environment}</span>
                <ValueChip label="revision" value={shortSha(deployment.revision)} />
                <span className="text-xs text-ink-soft">since {deployment.since}</span>
              </li>
            ))}
          </ul>
        )}
      </LiveCard>

      <LiveCard id="live-observation-findings" title="Reconciliation — findings" storeRef={source.store_ref} asOf={source.as_of}>
        {data.findings.length === 0 ? (
          <p className="text-sm text-ink-soft">No System State claim is wired for reconciliation yet (nothing claimed — nothing verified — honest emptiness).</p>
        ) : (
          <ul className="space-y-2">
            {sortedFindings(data.findings).map((finding) => (
              <li key={finding.subject} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
                <span className="font-medium text-ink">{finding.kind}</span>
                <span className="text-ink-soft">{finding.subject}</span>
                <ValueChip label="claimed" value={shortSha(finding.claimedRevision)} />
                <ValueChip label="observed" value={finding.observedRevision === null ? '—' : shortSha(finding.observedRevision)} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-soft">
          ALIGNED / DIVERGED / UNVERIFIED / STALE are the plane&apos;s honest reconciliation states — stale and unverified stay visible, never folded into success.
        </p>
      </LiveCard>

      {data.detections.length > 0 ? (
        <LiveCard id="live-observation-detections" title="Detected shortfalls and opportunities" storeRef={source.store_ref} asOf={source.as_of}>
          <ul className="space-y-2">
            {data.detections.map((detection) => (
              <li key={`${detection.code}-${detection.subject}`} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <span className="font-medium text-ink">{detection.code}</span> <span className="text-ink-soft">— {detection.subject}</span>
                <p className="mt-1 text-xs text-ink-soft">{detection.message}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">Detections are non-authoritative typed records for the orchestrator to consume.</p>
        </LiveCard>
      ) : null}

      {data.providerHealth.length > 0 ? (
        <LiveCard id="live-observation-provider-health" title="Provider health" storeRef={source.store_ref} asOf={source.as_of}>
          <dl>
            {data.providerHealth.map((signal) => (
              <Row key={signal.provider} label={signal.provider}>
                {signal.status} <span className="text-xs text-ink-soft">(signal at {signal.at})</span>
              </Row>
            ))}
          </dl>
        </LiveCard>
      ) : null}
    </div>
  );
}
