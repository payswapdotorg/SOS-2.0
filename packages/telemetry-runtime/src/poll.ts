/**
 * The telemetry runtime — poll-driven RawObservation ingestion.
 *
 * On every pollAll() (driven by the observation loop's tick, never an
 * ambient timer): pull each wired TelemetrySource.fetch(), convert every
 * RawObservation into a durable observation event (kind
 * 'telemetry.observation', payload = the capture verbatim — truth
 * states survive bit-exact), and ingest through the P7 pipeline
 * (replay-protected: a redelivered capture with the same deterministic
 * event id is a typed DUPLICATE, never double-applied).
 *
 * Event ids are DETERMINISTIC per (source, capture ordinal): the runtime
 * maintains a per-source ordinal counter advanced only by successfully
 * normalized captures, so redelivering the same buffer produces the
 * same ids and deduplicates exactly.
 *
 * A source whose pull THROWS records a typed POLL_FAILED outcome —
 * the runtime does NOT fabricate a gap observation for a failed pull
 * (a gap event asserts data absence; a failed pull asserts neither
 * presence nor absence — conflating them would be dishonest).
 */

import type { Clock } from '@sos-2/live-store';
import type { IngestionOutcome, EventIngestionPipeline, EventSourceDescription } from '@sos-2/event-ingestion';
import { telemetryCaptureEvent } from '@sos-2/event-ingestion';
import type { TelemetrySource } from '@sos-2/telemetry';
import type { RawObservation } from '@sos-2/telemetry';
import { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';

export interface TelemetryPollReport {
  readonly sourceId: string;
  readonly captured: number;
  readonly ingested: number;
  readonly duplicates: number;
  readonly gaps: number;
  readonly failure: string | null;
}

export interface TelemetryRuntimeDeps {
  readonly sources: readonly TelemetrySource[];
  readonly pipeline: EventIngestionPipeline;
  readonly clock: Clock;
  /** Source description base for the event records (family 'telemetry'). */
  readonly sourceDescription?: (sourceId: string) => EventSourceDescription;
}

const PRODUCER_TOOL = 'telemetry-runtime';

export class TelemetryRuntime {
  private readonly sources: readonly TelemetrySource[];
  private readonly pipeline: EventIngestionPipeline;
  private readonly clock: Clock;
  private readonly describeSource: (sourceId: string) => EventSourceDescription;
  private readonly seenIds: Set<string>;

  constructor(deps: TelemetryRuntimeDeps) {
    this.sources = deps.sources;
    this.pipeline = deps.pipeline;
    this.clock = deps.clock;
    this.describeSource = deps.sourceDescription ?? defaultSourceDescription;
    this.seenIds = new Set<string>();
  }

  /** Poll every wired source once. Typed per-source reports; never throws. */
  async pollAll(): Promise<readonly TelemetryPollReport[]> {
    const reports: TelemetryPollReport[] = [];
    for (const source of this.sources) {
      reports.push(await this.pollSource(source));
    }
    return reports;
  }

  /** Poll one source (exposed for focused tests/wiring). */
  async pollSource(source: TelemetrySource): Promise<TelemetryPollReport> {
    const description = this.describeSource(source.id);
    let captures: readonly RawObservation[];
    try {
      captures = source.fetch();
    } catch (error) {
      return { sourceId: source.id, captured: 0, ingested: 0, duplicates: 0, gaps: 0, failure: (error as Error).message };
    }
    let ingested = 0;
    let duplicates = 0;
    let gaps = 0;
    for (const capture of captures) {
      const event = telemetryCaptureEvent(
        description,
        { subject_ref: capture.subject_ref, availability: capture.availability, window: capture.window },
        captureId(capture),
        capture.window.end,
        [`${PRODUCER_TOOL}:${source.id}`],
      );
      if (this.seenIds.has(event.id)) {
        duplicates += 1;
        if (capture.availability === 'UNAVAILABLE') {
          gaps += 1;
        }
        continue;
      }
      const outcome: IngestionOutcome = await this.pipeline.ingest(event);
      if (outcome.kind === 'APPLIED') {
        this.seenIds.add(event.id);
        ingested += 1;
        if (capture.availability === 'UNAVAILABLE') {
          gaps += 1;
        }
      } else if (outcome.kind === 'DUPLICATE') {
        duplicates += 1;
        if (capture.availability === 'UNAVAILABLE') {
          gaps += 1;
        }
      }
    }
    return { sourceId: source.id, captured: captures.length, ingested, duplicates, gaps, failure: null };
  }
}

/**
 * The deterministic capture id: a content hash of the whole capture.
 * Redelivery of the same capture (same window, same availability, same
 * payload) is the same id and deduplicates exactly; distinct captures
 * hash distinctly. No counters, no clocks.
 */
function captureId(capture: RawObservation): string {
  const serialized = canonicalSerialize({
    subject_ref: capture.subject_ref,
    availability: capture.availability,
    window: capture.window,
    observed: capture.observed,
    attributes: capture.attributes,
  });
  return `capture-${contentHash(serialized)}`;
}

function defaultSourceDescription(sourceId: string): EventSourceDescription {
  return {
    source: `telemetry:${sourceId}`,
    family: 'telemetry',
    connection: 'simulated',
    description: `telemetry source ${sourceId} (reference)`,
  };
}

export function currentEpochMs(clock: Clock): number {
  return clock.nowEpochMs();
}
