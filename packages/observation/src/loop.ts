/**
 * The Observation Loop — one bounded, no-body drain pass.
 *
 * Observation -> Evidence -> System State reconciliation -> shortfall /
 * opportunity detection (the work-order behavior), as a SINGLE bounded
 * pass the host drives on its own injected tick source. No ambient
 * timers, no body, no harness: the loop is pure state transformation
 * over the durable observation-event store.
 *
 * Steps of one drain:
 *   1. poll + ingest every wired event source (typed summaries)
 *   2. run due probes (only where organic coverage is insufficient) and
 *      ingest their envelopes
 *   3. poll the telemetry runtime (optional) — captures become events
 *   4. project the configured subjects
 *   5. read System State claims (read-only port) and reconcile
 *   6. detect shortfalls/opportunities
 * The drain report is typed end-to-end; nothing in the pass writes any
 * store EXCEPT the observation-event store.
 */

import type { PollIngestSummary } from '@sos-2/event-ingestion';
import { normalizeExternalEvent } from '@sos-2/event-ingestion';
import type { EventSourcePort, ProbeRunOutcome, ProbeScheduler } from '@sos-2/event-ingestion';
import type { Clock } from '@sos-2/live-store';
import type { ProjectionSnapshot } from './projection.js';
import type { ObservationProjections } from './projection.js';
import type { EventIngestionPipeline } from '@sos-2/event-ingestion';
import type { ObservedRevision, ReconciliationFinding, StateRevisionClaim, SystemStateClaimsPort } from './reconcile.js';
import { reconcileClaims } from './reconcile.js';
import type { Detection, DetectionEngine } from './detection.js';

/** Telemetry runtime integration (optional step 3). */
export interface TelemetryRuntimePort {
  pollAll(): Promise<readonly { sourceId: string; captured: number; gaps: number; failure: string | null }[]>;
}

export interface ObservationDrainReport {
  readonly drainedAt: string;
  readonly sourceSummaries: readonly PollIngestSummary[];
  readonly probeOutcomes: readonly ProbeRunOutcome[];
  readonly telemetry: readonly { sourceId: string; captured: number; gaps: number; failure: string | null }[];
  readonly snapshot: ProjectionSnapshot;
  readonly claims: readonly StateRevisionClaim[];
  readonly findings: readonly ReconciliationFinding[];
  readonly detections: readonly Detection[];
}

export interface ObservationLoopDeps {
  readonly pipeline: EventIngestionPipeline;
  readonly sources: readonly EventSourcePort[];
  readonly probes?: ProbeScheduler;
  readonly telemetry?: TelemetryRuntimePort;
  readonly projections: ObservationProjections;
  readonly claims: SystemStateClaimsPort;
  readonly detection: DetectionEngine;
  /**
   * Maps a System State claim subject to what observation currently sees
   * (the composition's wiring of claim keys to projections). Returns
   * undefined when nothing is wired for the subject (-> UNVERIFIED).
   */
  readonly observeFor: (claim: StateRevisionClaim, snapshot: ProjectionSnapshot) => ObservedRevision | undefined;
  readonly clock: Clock;
}

export class ObservationLoop {
  private readonly pipeline: EventIngestionPipeline;
  private readonly sources: readonly EventSourcePort[];
  private readonly probes: ProbeScheduler | undefined;
  private readonly telemetry: TelemetryRuntimePort | undefined;
  private readonly projections: ObservationProjections;
  private readonly claims: SystemStateClaimsPort;
  private readonly detection: DetectionEngine;
  private readonly observeFor: ObservationLoopDeps['observeFor'];
  private readonly clock: Clock;

  constructor(deps: ObservationLoopDeps) {
    this.pipeline = deps.pipeline;
    this.sources = deps.sources;
    this.probes = deps.probes;
    this.telemetry = deps.telemetry;
    this.projections = deps.projections;
    this.claims = deps.claims;
    this.detection = deps.detection;
    this.observeFor = deps.observeFor;
    this.clock = deps.clock;
  }

  /** One bounded pass. Never throws for data problems — reports typed. */
  async drain(): Promise<ObservationDrainReport> {
    const sourceSummaries: PollIngestSummary[] = [];
    for (const source of this.sources) {
      sourceSummaries.push(await this.pipeline.pollSource(source));
    }
    const probeOutcomes: ProbeRunOutcome[] = [];
    if (this.probes !== undefined) {
      for (const outcome of await this.probes.runDue()) {
        probeOutcomes.push(outcome);
        if (outcome.envelope !== null) {
          const description = probeSourceDescription(outcome.probeId);
          await this.pipeline.ingest(normalizeExternalEvent(description, outcome.envelope));
        }
      }
    }
    const telemetry = this.telemetry !== undefined ? await this.telemetry.pollAll() : [];
    const snapshot = await this.projections.snapshot();
    const claims = await this.claims.readClaims();
    const observed = claims.map((claim) => this.observeFor(claim, snapshot)).filter((entry): entry is ObservedRevision => entry !== undefined);
    const detectedAt = new Date(this.clock.nowEpochMs()).toISOString();
    const findings = reconcileClaims(claims, observed, detectedAt);
    const detections = this.detection.detect(snapshot, findings, detectedAt);
    return {
      drainedAt: detectedAt,
      sourceSummaries,
      probeOutcomes,
      telemetry,
      snapshot,
      claims,
      findings,
      detections,
    };
  }
}
function probeSourceDescription(probeId: string): import('@sos-2/event-ingestion').EventSourceDescription {
  return {
    source: `scheduled-probe:${probeId}`,
    family: 'scheduled-probe',
    connection: 'simulated',
    description: `probe ${probeId}`,
  };
}
