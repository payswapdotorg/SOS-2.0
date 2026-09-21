/**
 * @sos-2/observation-host smoke test: the reference composition runs a
 * complete no-body drain deterministically (journey-level acceptance
 * lives in tests/observation).
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@sos-2/live-store';
import { createReferenceObservationPlane } from '../src/index.js';
import { ScriptedEventSource, ScriptedClaimsPort, referenceGitHubEnvelopes, referenceCiEnvelopes, referenceDeploymentEnvelopes, referenceProviderHealthEnvelopes, referenceClaims } from '../src/reference-sources.js';

const T0 = Date.parse('2026-09-21T12:05:00Z');

function buildPlane(clock: ManualClock) {
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
  return createReferenceObservationPlane({
    clock,
    sources: [github, ci, deployments, providerHealth],
    claims: new ScriptedClaimsPort(referenceClaims()),
  });
}

describe('reference observation plane', () => {
  it('drains the complete no-body loop deterministically (twice = identical results)', async () => {
    const first = await buildPlane(new ManualClock(T0)).loop.drain();
    const second = await buildPlane(new ManualClock(T0)).loop.drain();
    const repository = first.snapshot.repositoryHeads.get('github:repo:payswapdotorg/SOS-2.0');
    expect(repository?.branchHeads['main']).toBe('86a6921631113167f071c2f9019dddd0c1ab6447');
    expect(repository?.openPullRequests.map((pull) => pull.number)).toEqual([27]);
    const ci = first.snapshot.ci.get('github:repo:payswapdotorg/SOS-2.0');
    expect(Object.values(ci?.latestByPipeline ?? {}).map((run) => run.status)).toEqual(['SUCCESS']);
    const deployed = first.snapshot.deployments.get('github:repo:payswapdotorg/SOS-2.0')?.deployedByEnvironment['production'];
    expect(deployed?.revision).toBe('740bc37c75');
    expect(first.snapshot.providerHealth.lastSignalByProvider['github']?.status).toBe('HEALTHY');
    expect(second.findings.map((finding) => finding.kind)).toEqual(first.findings.map((finding) => finding.kind));
    expect(second.detections.map((detection) => detection.detectionId)).toEqual(first.detections.map((detection) => detection.detectionId));
  });
});
