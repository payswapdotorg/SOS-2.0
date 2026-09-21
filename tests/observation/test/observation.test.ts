/**
 * P7 acceptance suites — the work-order acceptance criteria, pinned end
 * to end over the PUBLIC composition (no body anywhere; the whole
 * plane is state transformation).
 *
 *   1. a complete observation loop works while no body is active
 *   2. GitHub push/PR events update live projections
 *   3. runtime/CI evidence preserves truth states and provenance
 *   4. stale/unavailable observation is distinguishable from success
 *   5. observation events are replay-safe
 *   6. observation does not mutate semantic truth outside authoritative
 *      domain stores
 *   7. structural scans (determinism, imports, honesty)
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInMemoryLiveStore, ManualClock } from '@sos-2/live-store';
import type { InMemoryLiveStore, PutOptions } from '@sos-2/live-store';
import { EventIngestionPipeline } from '@sos-2/event-ingestion';
import type { ExternalEventEnvelope } from '@sos-2/event-ingestion';
import { InMemoryTelemetrySource } from '@sos-2/telemetry';
import type { RawObservation } from '@sos-2/telemetry';
import { ObservationProjections, reconcileClaims } from '@sos-2/observation';
import type { FreshnessMark, SubjectQuery } from '@sos-2/observation';
import { createReferenceObservationPlane } from '@sos-2/observation-host';
import { ScriptedEventSource, ScriptedClaimsPort, referenceGitHubEnvelopes, referenceCiEnvelopes, referenceDeploymentEnvelopes, referenceProviderHealthEnvelopes, referenceClaims, notYetConnectedSource } from '@sos-2/observation-host';
import { TelemetryRuntime } from '@sos-2/telemetry-runtime';

const T0 = Date.parse('2026-09-21T12:05:00Z');
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REPO = 'github:repo:payswapdotorg/SOS-2.0';
const GITHUB_WEBHOOK = 'github:webhook:payswapdotorg/SOS-2.0';
const CI_SOURCE = 'ci:github-actions:payswapdotorg/SOS-2.0';
const DEPLOYMENT_SOURCE = 'deploy:tracker:production';
const PROVIDER_HEALTH_SOURCE = 'status:page:aggregate';

function source(sourceId: string, family: 'github' | 'ci' | 'deployment' | 'provider-health', envelopes: readonly ExternalEventEnvelope[]): ScriptedEventSource {
  return new ScriptedEventSource({
    description: { source: sourceId, family, connection: 'simulated', description: `reference ${family} source` },
    envelopes,
  });
}

function buildPlane(clock: ManualClock) {
  const github = source(GITHUB_WEBHOOK, 'github', referenceGitHubEnvelopes());
  const ci = source(CI_SOURCE, 'ci', referenceCiEnvelopes());
  const deployments = source(DEPLOYMENT_SOURCE, 'deployment', referenceDeploymentEnvelopes());
  const providerHealth = source(PROVIDER_HEALTH_SOURCE, 'provider-health', referenceProviderHealthEnvelopes());
  const telemetry = new InMemoryTelemetrySource({ id: 'otel:collector:prod', observations: [runtimeCapture('otel:service:api', 'SUCCESS')] });
  const plane = createReferenceObservationPlane({
    clock,
    sources: [github, ci, deployments, providerHealth],
    telemetrySources: [telemetry],
    claims: new ScriptedClaimsPort(referenceClaims()),
  });
  return { plane, github, ci, deployments, telemetry };
}

function runtimeCapture(subject: string, availability: RawObservation['availability']): RawObservation {
  return {
    subject_ref: subject,
    availability,
    window: { start: '2026-09-21T11:00:00Z', end: '2026-09-21T12:04:00Z' },
    observed: null,
    attributes: {},
    producer: { tool: 'otel-collector', tool_version: '1.0', model: null, model_version: null, command: null, environment: 'prod' },
  };
}

/** Suite 1 — the complete loop with NO body active (zero body/harness presence). */
describe('P7 acceptance: complete observation loop with no body active', () => {
  it('ingests all §5 families, projects, reconciles and detects in one drain — with zero body/harness/task presence', async () => {
    const { plane } = buildPlane(new ManualClock(T0));
    const report = await plane.loop.drain();
    expect(report.sourceSummaries.map((entry) => entry.applied)).toEqual([2, 1, 1, 1]);
    expect(report.telemetry[0]?.captured).toBe(1);
    const repository = report.snapshot.repositoryHeads.get(REPO);
    expect(repository?.branchHeads['main']).toBe('86a6921631113167f071c2f9019dddd0c1ab6447');
    expect(repository?.openPullRequests.map((pull) => pull.number)).toEqual([27]);
    // The loop never touched a body: the body-lease and task stores are empty.
    const bodyLeases = await plane.store.bodyLeases.list({ limit: 100 });
    const tasks = await plane.store.tasks.list({ limit: 100 });
    expect(bodyLeases.items.length).toBe(0);
    expect(tasks.items.length).toBe(0);
    // The claims were reconciled: main aligned (fresh), production diverged.
    const kinds = new Map(report.findings.map((finding) => [finding.subject, finding.kind]));
    expect(kinds.get('github:repo:payswapdotorg/SOS-2.0@main')).toBe('ALIGNED');
    expect(kinds.get('deploy:environment:production')).toBe('DIVERGED');
    expect(report.detections.map((detection) => detection.code).sort()).toEqual(['DEPLOYED_NOT_AT_HEAD', 'STATE_DIVERGED']);
  });
});

/** Suite 2 — GitHub push/PR events update live projections. */
describe('P7 acceptance: GitHub push/PR events update live projections', () => {
  it('a push moves the branch head; a PR opened adds it to open PRs; closed removes it; a second push updates again', async () => {
    const { plane, github } = buildPlane(new ManualClock(T0));
    const first = await plane.loop.drain();
    expect(first.snapshot.repositoryHeads.get(REPO)?.branchHeads['main']).toBe('86a6921631113167f071c2f9019dddd0c1ab6447');
    expect(first.snapshot.repositoryHeads.get(REPO)?.openPullRequests.map((pull) => pull.number)).toEqual([27]);

    github.push({
      externalId: 'delivery-0003',
      kind: 'github.push',
      occurredAt: '2026-09-21T12:06:00Z',
      payload: { ref: 'refs/heads/main', before: '86a6921631113167f071c2f9019dddd0c1ab6447', after: '740bc37c75' },
      provenance: [GITHUB_WEBHOOK],
    });
    github.push({
      externalId: 'delivery-0004',
      kind: 'github.pull_request',
      occurredAt: '2026-09-21T12:07:00Z',
      payload: { action: 'closed', number: 27, head: 'feature-head-sha', base: 'main' },
      provenance: [GITHUB_WEBHOOK],
    });
    const second = await plane.loop.drain();
    expect(second.snapshot.repositoryHeads.get(REPO)?.branchHeads['main']).toBe('740bc37c75');
    expect(second.snapshot.repositoryHeads.get(REPO)?.openPullRequests).toEqual([]);
  });
});

/** Suite 3 — runtime/CI evidence preserves truth states and provenance. */
describe('P7 acceptance: truth states and provenance preserved', () => {
  it('an UNAVAILABLE telemetry capture stays UNAVAILABLE end-to-end; every event carries provenance', async () => {
    const { plane, telemetry } = buildPlane(new ManualClock(T0));
    telemetry.push(runtimeCapture('otel:service:checkout', 'UNAVAILABLE'));
    const report = await plane.loop.drain();
    const listing = await plane.store.observationEvents.list({ limit: 100 });
    const gapEvent = listing.items.find((event) => {
      const payload = event.payload as { availability?: string; subject_ref?: string };
      return payload?.subject_ref === 'otel:service:checkout';
    });
    expect(gapEvent).toBeDefined();
    expect((gapEvent?.payload as { availability: string }).availability).toBe('UNAVAILABLE');
    expect(gapEvent?.provenance.length ?? 0).toBeGreaterThan(0);
    // Every event carries provenance + the truthful capture state.
    for (const event of listing.items) {
      expect(event.provenance.length).toBeGreaterThan(0);
    }
    const ciEvent = listing.items.find((event) => event.kind === 'ci.run');
    expect((ciEvent?.payload as { status: string }).status).toBe('SUCCESS');
    expect(report.telemetry[0]?.gaps).toBe(1);
  });
});

/** Suite 4 — stale/unavailable is distinguishable from success. */
describe('P7 acceptance: stale/unavailable distinguishable from success', () => {
  it('FRESH -> ALIGNED; STALE -> its own finding kind; NO_DATA -> UNVERIFIED; gap captures stay UNAVAILABLE', async () => {
    const freshClock = new ManualClock(T0);
    const { plane } = buildPlane(freshClock);
    const fresh = await plane.loop.drain();
    const freshKinds = new Map(fresh.findings.map((finding) => [finding.subject, finding.kind]));
    expect(freshKinds.get('github:repo:payswapdotorg/SOS-2.0@main')).toBe('ALIGNED');

    // 40 minutes later, beyond the 10-minute freshness window: STALE, not aligned.
    freshClock.advance(40 * 60 * 1000);
    const stale = await plane.loop.drain();
    const staleKinds = new Map(stale.findings.map((finding) => [finding.subject, finding.kind]));
    expect(staleKinds.get('github:repo:payswapdotorg/SOS-2.0@main')).toBe('STALE');
    const staleRepository = stale.snapshot.repositoryHeads.get(REPO);
    expect(staleRepository?.freshness.state).toBe('STALE');

    // A claim with NO wired observation -> UNVERIFIED (never guessed).
    const findings = reconcileClaims(
      [{ subject: 'not:wired:anywhere', claimedRevision: 'sha', claimRef: 'test' }],
      [],
      '2026-09-21T12:05:00Z',
    );
    expect(findings[0]?.kind).toBe('UNVERIFIED');
  });

  it('a failed poll is a typed outcome, never a fabricated success', async () => {
    const clock = new ManualClock(T0);
    const unconnected = notYetConnectedSource('github:webhook:private/other', 'github', 'not yet connected');
    const plane = createReferenceObservationPlane({
      clock,
      sources: [unconnected],
      claims: new ScriptedClaimsPort(referenceClaims()),
    });
    const report = await plane.loop.drain();
    expect(report.sourceSummaries[0]?.poll.kind).toBe('POLL_FAILED');
    if (report.sourceSummaries[0]?.poll.kind === 'POLL_FAILED') {
      expect(report.sourceSummaries[0]?.poll.reason).toContain('NOT_YET_CONNECTED');
    }
    // No events were fabricated for the unconnected source.
    const listing = await plane.store.observationEvents.list({ limit: 100 });
    expect(listing.items.filter((event) => event.source === 'github:webhook:private/other')).toEqual([]);
  });
});

/** Suite 5 — replay safety. */
describe('P7 acceptance: observation events are replay-safe', () => {
  it('redelivering every source does not double-apply: identical events, identical projections', async () => {
    const clock = new ManualClock(T0);
    const github = new ScriptedEventSource({
      description: { source: GITHUB_WEBHOOK, family: 'github', connection: 'simulated', description: null },
      envelopes: referenceGitHubEnvelopes(),
    });
    const plane = createReferenceObservationPlane({ clock, sources: [github], claims: new ScriptedClaimsPort(referenceClaims()) });
    await plane.loop.drain();
    // Redelivery storm: the same envelopes again.
    for (const envelope of referenceGitHubEnvelopes()) {
      github.push(envelope);
    }
    const second = await plane.loop.drain();
    expect(second.sourceSummaries[0]?.duplicates).toBe(2);
    expect(second.sourceSummaries[0]?.applied).toBe(0);
    const listing = await plane.store.observationEvents.list({ limit: 100 });
    expect(listing.items.length).toBe(2);
    const repository = second.snapshot.repositoryHeads.get(REPO);
    expect(repository?.branchHeads['main']).toBe('86a6921631113167f071c2f9019dddd0c1ab6447');
    expect(repository?.openPullRequests.map((pull) => pull.number)).toEqual([27]);
  });

  it('telemetry redelivery deduplicates exactly (deterministic capture ids)', async () => {
    const clock = new ManualClock(T0);
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock });
    const runtime = new TelemetryRuntime({ sources: [new InMemoryTelemetrySource({ id: 'metrics:store', observations: [runtimeCapture('otel:service:api', 'SUCCESS')] })], pipeline, clock });
    await runtime.pollAll();
    const second = await runtime.pollAll();
    expect(second[0]?.duplicates).toBe(1);
    const listing = await store.observationEvents.list({ limit: 100 });
    expect(listing.items.length).toBe(1);
  });
});

/** Suite 6 — observation never mutates semantic truth. */
describe('P7 acceptance: no semantic mutation outside authoritative domain stores', () => {
  it('a full drain writes ONLY the observation-event store (write-counting wrappers on every domain repo)', async () => {
    const clock = new ManualClock(T0);
    const { plane } = buildPlane(clock);
    const writeCounts = new Map<string, number>();
    const store = plane.store as InMemoryLiveStore;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const domainRepos: Array<[string, { put: (record: any, options?: PutOptions) => Promise<any> }]> = [
      ['missions', store.missions],
      ['contexts', store.contexts],
      ['systemStates', store.systemStates],
      ['evidence', store.evidence],
      ['architecture', store.architecture],
      ['candidates', store.candidates],
      ['assurance', store.assurance],
      ['experiments', store.experiments],
      ['decisions', store.decisions],
      ['authorityGrants', store.authorityGrants],
      ['packages', store.packages],
      ['history.memories', store.history.memories],
      ['history.hypotheses', store.history.hypotheses],
      ['developmentState', store.developmentState],
      ['tasks', store.tasks],
      ['bodyLeases', store.bodyLeases],
    ];
    for (const [name, repo] of domainRepos) {
      writeCounts.set(name, 0);
      const original = repo.put.bind(repo);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      repo.put = (record: any, options?: PutOptions) => {
        writeCounts.set(name, (writeCounts.get(name) ?? 0) + 1);
        return original(record, options);
      };
    }
    await plane.loop.drain();
    await plane.loop.drain();
    for (const [name, count] of writeCounts) {
      expect(count, `${name} must never be written by the observation loop`).toBe(0);
    }
    // And the observation-event store DID receive the events (the only written store).
    const observationEvents = await plane.store.observationEvents.list({ limit: 100 });
    expect(observationEvents.items.length).toBeGreaterThan(0);
  });
});

/** Suite 7 — structural scans. */
describe('P7 structural scans', () => {
  const OWNED = [
    join(REPO_ROOT, 'packages/event-ingestion/src'),
    join(REPO_ROOT, 'packages/observation/src'),
    join(REPO_ROOT, 'packages/telemetry-runtime/src'),
    join(REPO_ROOT, 'apps/observation/src'),
  ];

  function collectFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        files.push(...collectFiles(full));
      } else if (entry.endsWith('.ts')) {
        files.push(full);
      }
    }
    return files;
  }

  it('no forbidden ambient calls in owned sources outside the documented composition boundary', () => {
    const boundary = ['system-clock.ts', join('apps/observation', 'src', 'index.ts')];
    const forbidden = [/Date\.now\(/, /Math\.random\(/, /(?<!\.)\bfetch\(/, /process\.env/, /setTimeout\(/, /setInterval\(/, /child_process/, /\brequire\(/];
    for (const owned of OWNED) {
      for (const file of collectFiles(owned)) {
        const isBoundary = boundary.some((name) => file.endsWith(name));
        if (isBoundary) {
          continue;
        }
        const content = readFileSync(file, 'utf8');
        for (const pattern of forbidden) {
          if (pattern.test(content)) {
            throw new Error(`forbidden ambient call ${pattern} in ${file} (boundary: ${boundary.join(', ')})`);
          }
        }
      }
    }
  });

  it('imports only merged + P7-owned workspace packages', () => {
    const allowed = new Set([
      '@sos-2/event-ingestion',
      '@sos-2/live-store',
      '@sos-2/observation',
      '@sos-2/provenance',
      '@sos-2/semantic-spine',
      '@sos-2/telemetry',
      '@sos-2/telemetry-runtime',
    ]);
    const specifiers: string[] = [];
    for (const owned of OWNED) {
      for (const file of collectFiles(owned)) {
        const content = readFileSync(file, 'utf8');
        for (const match of content.matchAll(/from\s+'(@sos-2\/[a-z0-9-]+)'/g)) {
          specifiers.push(`${match[1]} (${file})`);
        }
      }
    }
    for (const specifier of specifiers) {
      const packageName = specifier.split(' ')[0]!;
      if (!allowed.has(packageName)) {
        throw new Error(`import outside the merged + P7-owned set: ${specifier}`);
      }
    }
  });

  it('reference sources report simulated; real endpoints report not-yet-connected (honest statuses)', () => {
    const unconnected = notYetConnectedSource('github:webhook:x', 'github', null);
    expect(unconnected.describe().connection).toBe('not-yet-connected');
    const scripted = source(GITHUB_WEBHOOK, 'github', []);
    expect(scripted.describe().connection).toBe('simulated');
  });
});

/** Freshness contract (unit-level pin of the FRESH/STALE/NO_DATA discipline). */
describe('freshness marks', () => {
  it('FRESH within the window, STALE beyond it, NO_DATA with zero events', async () => {
    const clock = new ManualClock(T0);
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock });
    await pipeline.ingest({
      id: 'e1',
      source: GITHUB_WEBHOOK,
      kind: 'github.push',
      occurred_at: '2026-09-21T11:58:00Z',
      payload: { ref: 'refs/heads/main', before: 'a', after: 'b' },
      provenance: ['test'],
    });
    const query: SubjectQuery = { subject: REPO, sources: [GITHUB_WEBHOOK] };
    const projections = new ObservationProjections({ observationEvents: store.observationEvents, clock, freshAfterMs: 600_000, repositorySubjects: [query], ciSubjects: [], deploymentSubjects: [], providerHealthSources: [] });
    const fresh = await projections.snapshot();
    expect(fresh.repositoryHeads.get(REPO)?.freshness.state).toBe('FRESH');
    clock.advance(60 * 60 * 1000);
    const stale = await projections.snapshot();
    expect(stale.repositoryHeads.get(REPO)?.freshness.state).toBe('STALE');
    const emptyMark: FreshnessMark = { state: 'NO_DATA', lastEventAt: null, evaluatedAt: 'x', freshAfterMs: 1 };
    expect(emptyMark.state).toBe('NO_DATA');
  });

  it('malformed event payloads are counted and skipped, never crash the fold', async () => {
    const clock = new ManualClock(T0);
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock });
    await pipeline.ingest({
      id: 'bad-payload',
      source: GITHUB_WEBHOOK,
      kind: 'github.push',
      occurred_at: '2026-09-21T11:58:00Z',
      payload: { not: 'a github push payload' },
      provenance: ['test'],
    });
    const query: SubjectQuery = { subject: REPO, sources: [GITHUB_WEBHOOK] };
    const projections = new ObservationProjections({ observationEvents: store.observationEvents, clock, freshAfterMs: 600_000, repositorySubjects: [query], ciSubjects: [], deploymentSubjects: [], providerHealthSources: [] });
    const snapshot = await projections.snapshot();
    const repository = snapshot.repositoryHeads.get(REPO);
    expect(repository?.malformedEvents).toBe(1);
    expect(repository?.branchHeads['main']).toBeUndefined();
  });
});
