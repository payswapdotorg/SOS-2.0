/**
 * PROVENANCE-LABELLED LOCAL OBSERVATIONS (Work Order P11).
 *
 * EVERY observation the companion emits carries provenance naming the
 * LOCAL SOURCE + DEVICE IDENTITY (the @sos-2/telemetry provenance
 * discipline: a RawObservation always names its producer; local
 * observations are input, never semantic truth). Concretely every local
 * event record carries:
 *
 *   - source       the local subsystem that observed (e.g.
 *                  'local-companion:filesystem', 'local-companion:queue')
 *   - device_id    the companion's device identity
 *   - provenance   [source, 'device:<device_id>', 'producer:<tool>@<version>']
 *                  — non-empty, deterministic, NEVER a secret value
 *   - producer     a @sos-2/provenance Producer record (tool
 *                  'local-companion', environment 'device:<device_id>')
 *
 * When reconciliation ingests an event into the P2 live-store, the
 * observation event's source is 'local-companion:<device_id>' and its
 * provenance array preserves the local source + device identity naming
 * verbatim.
 *
 * Determinism: instants are stamped by the INJECTED clock; ids are
 * deterministic sequences; no randomness, no network, no environment
 * reads.
 */

import { InvalidCompanionContractError } from './errors.js';
import { formatRfc3339 } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { assertValidProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import type { JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';

/** The companion's tool identity in producer records (provenance metadata only). */
export const LOCAL_COMPANION_TOOL = 'local-companion';
export const LOCAL_COMPANION_TOOL_VERSION = '1.0.0';

/** The device environment label of a producer record (provenance metadata only). */
export function deviceEnvironment(deviceId: string): string {
  return `device:${deviceId}`;
}

/** One local observation as emitted by a companion subsystem. */
export interface LocalObservationInput {
  /** The local source subsystem (e.g. 'local-companion:filesystem'). */
  readonly source: string;
  /** The observation kind (e.g. 'local.workspace.wrote'). */
  readonly kind: string;
  /** The canonical-JSON observation payload. */
  readonly payload: JsonValue;
}

/** The producer of every local observation (the @sos-2/telemetry discipline). */
export function localCompanionProducer(deviceId: string): Producer {
  const producer: Producer = {
    tool: LOCAL_COMPANION_TOOL,
    tool_version: LOCAL_COMPANION_TOOL_VERSION,
    model: null,
    model_version: null,
    command: null,
    environment: deviceEnvironment(deviceId),
  };
  assertValidProducer(producer);
  return producer;
}

/** The deterministic provenance labels of one local observation (source + device identity + producer). */
export function localObservationProvenance(source: string, deviceId: string): string[] {
  return [source, deviceEnvironment(deviceId), `producer:${LOCAL_COMPANION_TOOL}@${LOCAL_COMPANION_TOOL_VERSION}`];
}

/** The observation-event source id of one companion device (the P2 ingestion source). */
export function companionEventSource(deviceId: string): string {
  return `${LOCAL_COMPANION_TOOL}:${deviceId}`;
}

/** The deterministic observation-event id of one local event (the replay-protection key). */
export function companionObservationEventId(deviceId: string, eventId: string): string {
  return `${LOCAL_COMPANION_TOOL}:${deviceId}:${eventId}`;
}

/**
 * THE LOCAL OBSERVATION SINK — what companion subsystems emit through.
 * The companion core supplies the sink; every emission is appended to the
 * durable local event log with provenance labels and a clock-stamped
 * instant.
 */
export type LocalObservationSink = (input: LocalObservationInput) => void;

/** A sink that records nothing (the honest default for audit-free fakes). */
export function nullObservationSink(): LocalObservationSink {
  return () => undefined;
}

// ---------------------------------------------------------------------------
// The durable local event log
// ---------------------------------------------------------------------------

/** One event in the companion's durable local event log. */
export interface LocalEventRecord {
  /** Deterministic event id (unique within the log: 'evt-0001', 'evt-0002', ...). */
  readonly event_id: string;
  /** The 1-based CONTIGUOUS sequence number (gap-free continuity is a hard invariant — pinned by reconciliation). */
  readonly seq: number;
  /** The local source subsystem that observed. */
  readonly source: string;
  /** The observation kind. */
  readonly kind: string;
  /** The canonical-JSON observation payload (stored verbatim — never a secret value). */
  readonly payload: JsonValue;
  /** The companion's device identity (provenance labelling). */
  readonly device_id: string;
  /** The provenance labels (source + device identity + producer — never a secret value). */
  readonly provenance: readonly string[];
  /** When the event was observed (RFC3339 — stamped by the injected clock at append). */
  readonly occurred_at: string;
}

/**
 * THE LOCAL EVENT LOG PORT — the companion's durable local truth. The
 * reference implementation is deterministic and in-memory; a real desktop
 * companion backs this port with on-device durable storage — the
 * reconciliation boundary consumes the same port either way.
 */
export interface LocalEventLog {
  /** Append one local observation (returns the stored record; sequences are contiguous). */
  append(input: LocalObservationInput): LocalEventRecord;
  /** The full log in sequence order (deterministic). */
  events(): readonly LocalEventRecord[];
  /** Events with sequence numbers strictly after the watermark (the pending replay suffix). */
  pendingAfter(seq: number): readonly LocalEventRecord[];
  /** Advance the ingestion acknowledgement watermark (monotonic — the max wins). */
  acknowledge(seq: number): void;
  /** The last acknowledged sequence number (0 = nothing acknowledged). */
  watermark(): number;
}

/** An in-memory local event log (the LOCAL REFERENCE RUNTIME — deterministic, offline). */
export class InMemoryLocalEventLog implements LocalEventLog {
  private readonly records: LocalEventRecord[] = [];
  private acked = 0;

  constructor(private readonly deps: { readonly deviceId: string; readonly clock: Clock }) {
    if (typeof deps !== 'object' || deps === null || typeof deps.clock !== 'object' || typeof deps.clock.nowEpochMs !== 'function') {
      throw new InvalidCompanionContractError('local-event-log', 'the in-memory local event log requires an injected clock and device id');
    }
  }

  append(input: LocalObservationInput): LocalEventRecord {
    if (typeof input !== 'object' || input === null || typeof input.source !== 'string' || input.source.length === 0) {
      throw new InvalidCompanionContractError('local-event-log', 'a local observation must carry a non-empty source');
    }
    if (typeof input.kind !== 'string' || input.kind.length === 0) {
      throw new InvalidCompanionContractError('local-event-log', 'a local observation must carry a non-empty kind');
    }
    try {
      canonicalSerialize(input.payload);
    } catch {
      throw new InvalidCompanionContractError('local-event-log', 'a local observation payload must be a canonical-JSON value');
    }
    const seq = this.records.length + 1;
    const record: LocalEventRecord = {
      event_id: `evt-${String(seq).padStart(4, '0')}`,
      seq,
      source: input.source,
      kind: input.kind,
      payload: structuredClone(input.payload) as JsonValue,
      device_id: this.deps.deviceId,
      provenance: localObservationProvenance(input.source, this.deps.deviceId),
      occurred_at: formatRfc3339(this.deps.clock.nowEpochMs()),
    };
    this.records.push(record);
    return record;
  }

  events(): readonly LocalEventRecord[] {
    return this.records.map((record) => structuredClone(record));
  }

  pendingAfter(seq: number): readonly LocalEventRecord[] {
    if (!Number.isInteger(seq) || seq < 0) {
      throw new InvalidCompanionContractError('local-event-log', `the watermark must be a non-negative integer, received: ${JSON.stringify(seq)}`);
    }
    return this.records.filter((record) => record.seq > seq).map((record) => structuredClone(record));
  }

  acknowledge(seq: number): void {
    if (!Number.isInteger(seq) || seq < 0) {
      throw new InvalidCompanionContractError('local-event-log', `the acknowledged sequence must be a non-negative integer, received: ${JSON.stringify(seq)}`);
    }
    if (seq > this.acked) {
      this.acked = seq;
    }
  }

  watermark(): number {
    return this.acked;
  }
}
