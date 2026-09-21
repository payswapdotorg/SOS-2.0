/**
 * @sos-2/observation-host — the P7 composition root (Work Order P7).
 *
 * Assembles the complete no-body Observation Plane (durable P2 store +
 * P7 ingestion + telemetry runtime + projections + claims + loop) with
 * everything injected. The composition root is the single impure
 * boundary (SystemClock via Date.now — the apps/api precedent); every
 * P7 package below it is deterministic and offline-testable. Real
 * provider endpoints attach later behind the same ports with honest
 * NOT_YET_CONNECTED statuses.
 */

export * from './composition.js';
export * from './reference-sources.js';
export * from './system-clock.js';

import { fileURLToPath } from 'node:url';
import { SystemClock } from './system-clock.js';
import { createReferenceObservationPlane } from './composition.js';
import { ScriptedEventSource, ScriptedClaimsPort, referenceGitHubEnvelopes, referenceCiEnvelopes, referenceDeploymentEnvelopes, referenceProviderHealthEnvelopes, referenceClaims } from './reference-sources.js';

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // The reference demo: ONE bounded drain of the no-body observation
  // loop over the scripted reference events (deterministic, offline).
  // The external topology (a webhook receiver, a cron scheduler) drives
  // the same drain() on its own ticks in production.
  const github = new ScriptedEventSource({
    description: { source: 'github:webhook:payswapdotorg/SOS-2.0', family: 'github', connection: 'simulated', description: 'reference github webhook source' },
    envelopes: referenceGitHubEnvelopes(),
  });
  const ci = new ScriptedEventSource({
    description: { source: 'ci:github-actions:payswapdotorg/SOS-2.0', family: 'ci', connection: 'simulated', description: 'reference CI event source' },
    envelopes: referenceCiEnvelopes(),
  });
  const deployments = new ScriptedEventSource({
    description: { source: 'deploy:tracker:production', family: 'deployment', connection: 'simulated', description: 'reference deployment tracker' },
    envelopes: referenceDeploymentEnvelopes(),
  });
  const providerHealth = new ScriptedEventSource({
    description: { source: 'status:page:aggregate', family: 'provider-health', connection: 'simulated', description: 'reference provider health feed' },
    envelopes: referenceProviderHealthEnvelopes(),
  });

  const plane = createReferenceObservationPlane({
    clock: new SystemClock(),
    sources: [github, ci, deployments, providerHealth],
    claims: new ScriptedClaimsPort(referenceClaims()),
  });

  const report = await plane.loop.drain();
  const summary = {
    drainedAt: report.drainedAt,
    eventsIngested: report.sourceSummaries.reduce((total, entry) => total + entry.applied, 0),
    repositoryHead: report.snapshot.repositoryHeads.get('github:repo:payswapdotorg/SOS-2.0')?.branchHeads['main'] ?? null,
    openPullRequests: report.snapshot.repositoryHeads.get('github:repo:payswapdotorg/SOS-2.0')?.openPullRequests.map((pull) => pull.number) ?? [],
    latestCi: Object.values(report.snapshot.ci.get('github:repo:payswapdotorg/SOS-2.0')?.latestByPipeline ?? {}).map((run) => ({ pipeline: run.runId, status: run.status })),
    deployed: report.snapshot.deployments.get('github:repo:payswapdotorg/SOS-2.0')?.deployedByEnvironment['production']?.revision ?? null,
    providerHealth: report.snapshot.providerHealth.lastSignalByProvider['github']?.status ?? null,
    findings: report.findings.map((finding) => ({ subject: finding.subject, kind: finding.kind, observed: finding.observedRevision })),
    detections: report.detections.map((detection) => ({ code: detection.code, subject: detection.subject })),
  };
  console.log(JSON.stringify(summary, null, 2));
}
