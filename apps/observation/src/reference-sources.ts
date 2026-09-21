/**
 * Reference event sources — deterministic scripted adapters (the P8
 * reference-body precedent: honest simulated markers, typed ports,
 * zero real endpoints).
 *
 * Real providers (a GitHub webhook receiver, a CI event bus, a
 * deployment tracker, a provider-health feed) attach later behind the
 * SAME EventSourcePort; until then `notYetConnectedSource` reports the
 * honest NOT_YET_CONNECTED status and its poll fails with a typed
 * reason naming it — connection evidence is never fabricated.
 */

import type { EventSourceDescription, EventSourcePort, ExternalEventEnvelope, ObservationEventFamily } from '@sos-2/event-ingestion';
import type { StateRevisionClaim, SystemStateClaimsPort } from '@sos-2/observation';

export interface ScriptedSourceInit {
  readonly description: EventSourceDescription;
  /** Envelopes available to the first poll (more can be pushed). */
  readonly envelopes?: readonly ExternalEventEnvelope[];
}

/**
 * A scripted reference source: poll() drains the queued envelopes
 * (deterministic order); a redelivery can be simulated by pushing the
 * same envelope again.
 */
export class ScriptedEventSource implements EventSourcePort {
  private readonly description: EventSourceDescription;
  private readonly queue: ExternalEventEnvelope[];

  constructor(init: ScriptedSourceInit) {
    this.description = init.description;
    this.queue = [...(init.envelopes ?? [])];
  }

  describe(): EventSourceDescription {
    return this.description;
  }

  push(envelope: ExternalEventEnvelope): void {
    this.queue.push(envelope);
  }

  async poll(): Promise<readonly ExternalEventEnvelope[]> {
    return this.queue.splice(0, this.queue.length);
  }
}

/**
 * A real-provider placeholder: honest NOT_YET_CONNECTED — poll fails
 * with a typed reason naming the status (never fabricated events).
 */
export function notYetConnectedSource(source: string, family: ObservationEventFamily, description: string | null): EventSourcePort {
  const described: EventSourceDescription = { source, family, connection: 'not-yet-connected', description };
  return {
    describe: () => described,
    poll: async () => {
      throw new Error(`NOT_YET_CONNECTED: real endpoint for ${source} is not connected (reference plane only)`);
    },
  };
}

/** Reference github webhook-shaped envelopes for the demo composition. */
export function referenceGitHubEnvelopes(): readonly ExternalEventEnvelope[] {
  return [
    {
      externalId: 'delivery-0001',
      kind: 'github.push',
      occurredAt: '2026-09-21T11:58:00Z',
      payload: { ref: 'refs/heads/main', before: '46365ed6eb9e7706ceccabcd7942bf7fba610056', after: '86a6921631113167f071c2f9019dddd0c1ab6447' },
      provenance: ['github:webhook:payswapdotorg/SOS-2.0'],
    },
    {
      externalId: 'delivery-0002',
      kind: 'github.pull_request',
      occurredAt: '2026-09-21T11:59:00Z',
      payload: { action: 'opened', number: 27, head: 'feature-head-sha', base: 'main' },
      provenance: ['github:webhook:payswapdotorg/SOS-2.0'],
    },
  ];
}

export function referenceCiEnvelopes(): readonly ExternalEventEnvelope[] {
  return [
    {
      externalId: 'run-9101',
      kind: 'ci.run',
      occurredAt: '2026-09-21T11:59:30Z',
      payload: { pipeline: 'repository-contract', ref: '86a6921631113167f071c2f9019dddd0c1ab6447', status: 'SUCCESS', runId: 'run-9101' },
      provenance: ['ci:github-actions:payswapdotorg/SOS-2.0'],
    },
  ];
}

export function referenceDeploymentEnvelopes(): readonly ExternalEventEnvelope[] {
  return [
    {
      externalId: 'deploy-0042',
      kind: 'deployment.change',
      occurredAt: '2026-09-21T11:55:00Z',
      payload: { environment: 'production', revision: '740bc37c75', action: 'deployed' },
      provenance: ['deploy:tracker:production'],
    },
  ];
}

export function referenceProviderHealthEnvelopes(): readonly ExternalEventEnvelope[] {
  return [
    {
      externalId: 'health-0007',
      kind: 'provider-health.signal',
      occurredAt: '2026-09-21T11:50:00Z',
      payload: { provider: 'github', status: 'HEALTHY' },
      provenance: ['status:page:aggregate'],
    },
  ];
}

/** The reference System State claims (read-only; the real reader wires to the System State store later). */
export class ScriptedClaimsPort implements SystemStateClaimsPort {
  private readonly scripted: readonly StateRevisionClaim[];

  constructor(claims: readonly StateRevisionClaim[]) {
    this.scripted = [...claims];
  }

  async readClaims(): Promise<readonly StateRevisionClaim[]> {
    return [...this.scripted];
  }
}

export function referenceClaims(): readonly StateRevisionClaim[] {
  return [
    { subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: '86a6921631113167f071c2f9019dddd0c1ab6447', claimRef: 'system-state:implementation:main' },
    { subject: 'deploy:environment:production', claimedRevision: '86a6921631113167f071c2f9019dddd0c1ab6447', claimRef: 'system-state:deployment:production' },
  ];
}
