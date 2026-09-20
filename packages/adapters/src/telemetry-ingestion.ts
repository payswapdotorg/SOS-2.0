/**
 * TelemetryIngestionAdapter — the W12 telemetry backend contract
 * (docs/implementation/REFERENCE-STACK.md: "telemetry backends implement
 * evidence-ingestion contracts"; spec/architecture.md section 17).
 *
 * WHAT THIS IS: the interface a telemetry backend implements to deliver
 * OTel-shaped signal batches into the SOS evidence pipeline, plus an
 * in-memory reference implementation. The OTel-shaped data types
 * (OtelBatch / OtelSpan / OtelMetricDataPoint / OtelLogRecord) and the
 * conversion into RawObservation records ALREADY EXIST in @sos-2/telemetry
 * — this module CONSUMES them verbatim (no second conversion, no second
 * observation shape, no reinterpreted truth states).
 *
 * TRUTHFUL AVAILABILITY: the adapter can also record GAPS — an UNAVAILABLE
 * raw observation asserting that NO DATA EXISTS for a subject/window.
 * Following the frozen discipline (spec/architecture-lock.md: "unavailable
 * telemetry interpreted as zero" is a forbidden shortcut), a gap is data
 * about missing data: it is never zero, never absence-of-failure, and never
 * coerced into any other truth state.
 */

import { convertOtelBatch } from '@sos-2/telemetry';
import type { OtelBatch, RawObservation } from '@sos-2/telemetry';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { TelemetryAdapterError } from './errors.js';
import { assertValidJsonValue } from './json.js';
import { verifyAdapterOutputs } from './semantic-bridge.js';
import type { AdapterContractDescriptor } from './semantic-bridge.js';

/** The telemetry ingestion adapter contract: bridged output is the raw observation. */
export const TELEMETRY_INGESTION_ADAPTER_DESCRIPTOR: AdapterContractDescriptor = {
  contract: 'TelemetryIngestionAdapter',
  outputs: {
    observation: 'RawObservation',
  },
} as const;

/** Input of {@link TelemetryIngestionAdapter.recordGap}. */
export interface RecordGapInput {
  /** Source-native or spine subject reference (non-empty). */
  subject_ref: string;
  /** The window for which NO DATA EXISTS. */
  window: TimeWindow;
  /** WHO/WHAT is asserting the gap (the telemetry backend). */
  producer: Producer;
  /** Optional gap detail (JSON), or null. */
  detail?: unknown;
}

/**
 * The evidence-ingestion contract for telemetry backends. `ingest` is the
 * primary path; queries answer what the backend currently holds.
 */
export interface TelemetryIngestionAdapter {
  /** The declared contract (bridged outputs; part of the semantic guard). */
  readonly descriptor: AdapterContractDescriptor;

  /**
   * Ingest an OTel-shaped batch: conversion is DELEGATED to
   * @sos-2/telemetry's convertOtelBatch (the single converter authority);
   * invalid entries fail loudly. Returns the raw observations in the
   * converter's deterministic order (spans, then metrics, then logs).
   */
  ingest(batch: OtelBatch): RawObservation[];

  /** All observations currently held, ingestion order (deterministic). */
  allObservations(): RawObservation[];

  /** Observations about one subject_ref, ingestion order. */
  observationsForSubject(subjectRef: string): RawObservation[];

  /**
   * Record a GAP: an UNAVAILABLE raw observation for a subject/window for
   * which NO DATA EXISTS. Truthful availability — never zero, never
   * absence-of-failure.
   */
  recordGap(input: RecordGapInput): RawObservation;
}

/**
 * In-memory reference implementation. Conversion, validation and truth-state
 * assignment for real signals come from @sos-2/telemetry; this class only
 * stores and re-serves the domain records and self-verifies every output
 * through the semantic bridge guard.
 */
export class InMemoryTelemetryIngestionAdapter implements TelemetryIngestionAdapter {
  readonly descriptor: AdapterContractDescriptor = TELEMETRY_INGESTION_ADAPTER_DESCRIPTOR;

  private readonly observations: RawObservation[] = [];

  ingest(batch: OtelBatch): RawObservation[] {
    let converted: RawObservation[];
    try {
      converted = convertOtelBatch(batch);
    } catch (cause) {
      throw new TelemetryAdapterError(
        `OTel batch rejected by the @sos-2/telemetry converter: ${(cause as Error).message}`,
      );
    }
    for (const observation of converted) {
      verifyAdapterOutputs(this.descriptor, { observation });
      this.observations.push(observation);
    }
    return converted.map((observation) => ({ ...observation }));
  }

  allObservations(): RawObservation[] {
    return this.observations.map((observation) => {
      verifyAdapterOutputs(this.descriptor, { observation });
      return { ...observation };
    });
  }

  observationsForSubject(subjectRef: string): RawObservation[] {
    if (typeof subjectRef !== 'string' || subjectRef.length === 0) {
      throw new TelemetryAdapterError('subjectRef must be a non-empty string');
    }
    return this.allObservations().filter((observation) => observation.subject_ref === subjectRef);
  }

  recordGap(input: RecordGapInput): RawObservation {
    if (typeof input !== 'object' || input === null) {
      throw new TelemetryAdapterError('gap input must be an object');
    }
    if (typeof input.subject_ref !== 'string' || input.subject_ref.length === 0) {
      throw new TelemetryAdapterError('gap subject_ref must be a non-empty string');
    }
    let detail: unknown = input.detail ?? null;
    if (detail !== null) {
      try {
        assertValidJsonValue(detail);
      } catch {
        throw new TelemetryAdapterError('gap detail must be null or a JSON value');
      }
    }
    const observation: RawObservation = {
      subject_ref: input.subject_ref,
      availability: 'UNAVAILABLE',
      window: { ...input.window },
      observed: detail === null ? null : (structuredClone(detail) as RawObservation['observed']),
      attributes: {},
      producer: { ...input.producer },
    };
    verifyAdapterOutputs(this.descriptor, { observation });
    this.observations.push(observation);
    return { ...observation };
  }

  /** Number of held observations (diagnostics). */
  get observationCount(): number {
    return this.observations.length;
  }
}
