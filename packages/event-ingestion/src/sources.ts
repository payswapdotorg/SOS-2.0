/**
 * Event source adapters — the §5 input families as typed ports.
 *
 * spec/productization-execution-architecture.md §5: "The Observation
 * Plane consumes: GitHub webhooks and repository events, CI/build/test/
 * security events, deployment events, runtime logs/metrics/traces,
 * incidents and provider health signals, scheduled repository/runtime
 * probes and explicit user observations."
 *
 * Each family is a typed source description; concrete providers (a real
 * GitHub webhook receiver, a real CI event bus) attach later as adapters
 * implementing EventSourcePort. The package itself never touches a real
 * endpoint (zero ambient network/process/time in src).
 */

/** The eight §5 input families, as stable literals. */
export const OBSERVATION_EVENT_FAMILIES = [
  'github',
  'ci',
  'deployment',
  'telemetry',
  'incident',
  'provider-health',
  'scheduled-probe',
  'user-observation',
] as const;

export type ObservationEventFamily = (typeof OBSERVATION_EVENT_FAMILIES)[number];

/**
 * Canonical event KINDS per family. The kind is free-form in the durable
 * record (P2 stores it verbatim); these are the kinds THIS wave's
 * projections and normalizers understand. Unknown kinds are preserved
 * verbatim and simply project nothing (honest, never an error).
 */
export const OBSERVATION_EVENT_KINDS = {
  githubPush: 'github.push',
  githubPullRequest: 'github.pull_request',
  ciRun: 'ci.run',
  deploymentChange: 'deployment.change',
  telemetryObservation: 'telemetry.observation',
  incidentReport: 'incident.report',
  providerHealthSignal: 'provider-health.signal',
  scheduledProbeResult: 'scheduled-probe.result',
  userObservation: 'user.observation',
} as const;

/** A source's identity and family (stable across polls). */
export interface EventSourceDescription {
  /**
   * Stable source identifier, e.g. "github:webhook:payswapdotorg/SOS-2.0".
   * Becomes the `source` field of every normalized event.
   */
  readonly source: string;
  /** Which §5 input family this source serves. */
  readonly family: ObservationEventFamily;
  /**
   * Honest connection status. Reference/simulated adapters report
   * 'simulated'; real provider endpoints report 'not-yet-connected'
   * until real connection evidence exists — never fabricated.
   */
  readonly connection: 'simulated' | 'not-yet-connected';
  /** Human-readable description, or null. */
  readonly description: string | null;
}

/**
 * A raw external event BEFORE normalization. `externalId` is the
 * source-native event id (GitHub delivery id, CI run id, ...); the
 * normalizer composes the durable replay-protection id from
 * (source, externalId) deterministically.
 */
export interface ExternalEventEnvelope {
  readonly externalId: string;
  readonly kind: string;
  /** RFC3339 — when the event occurred at the source. */
  readonly occurredAt: string;
  /** Opaque canonical-JSON payload, normalized verbatim. */
  readonly payload: unknown;
  /** At least one provenance entry (who/what produced this event). */
  readonly provenance: readonly string[];
}

/** A pull-based event source (push-based callers call normalize directly). */
export interface EventSourcePort {
  describe(): EventSourceDescription;
  /**
   * Pull all currently available envelopes. Deterministic order.
   * A FAILED poll is the caller's typed outcome (PollOutcome), never an
   * exception contract — see ingest.ts.
   */
  poll(): Promise<readonly ExternalEventEnvelope[]>;
}

/** The result of polling one source (honest, typed — never throws). */
export type PollOutcome =
  | { readonly kind: 'POLLED'; readonly source: string; readonly count: number }
  | { readonly kind: 'EMPTY'; readonly source: string }
  | { readonly kind: 'POLL_FAILED'; readonly source: string; readonly reason: string };

export function assertValidEventSourceDescription(value: EventSourceDescription): void {
  if (typeof value.source !== 'string' || value.source.length === 0) {
    throw new TypeError('EventSourceDescription.source must be a non-empty string');
  }
  if (!OBSERVATION_EVENT_FAMILIES.includes(value.family)) {
    throw new TypeError(`EventSourceDescription.family must be one of the 8 §5 families, received: ${JSON.stringify(value.family)}`);
  }
  if (value.connection !== 'simulated' && value.connection !== 'not-yet-connected') {
    throw new TypeError(`EventSourceDescription.connection must be 'simulated' or 'not-yet-connected', received: ${JSON.stringify(value.connection)}`);
  }
}

export function assertValidExternalEventEnvelope(value: ExternalEventEnvelope): void {
  if (typeof value.externalId !== 'string' || value.externalId.length === 0) {
    throw new TypeError('ExternalEventEnvelope.externalId must be a non-empty string');
  }
  if (typeof value.kind !== 'string' || value.kind.length === 0) {
    throw new TypeError('ExternalEventEnvelope.kind must be a non-empty string');
  }
  if (typeof value.occurredAt !== 'string' || value.occurredAt.length === 0) {
    throw new TypeError('ExternalEventEnvelope.occurredAt must be a non-empty RFC3339 string');
  }
  if (!Array.isArray(value.provenance) || value.provenance.length === 0 || value.provenance.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new TypeError('ExternalEventEnvelope.provenance must be a non-empty array of non-empty strings');
  }
}
