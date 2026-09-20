/**
 * TelemetrySource — the telemetry ingestion CONTRACT (Work Order W3).
 *
 * In the reference stack, "telemetry backends implement evidence-ingestion
 * contracts" (docs/implementation/REFERENCE-STACK.md): a backend (OTel
 * collector, metrics store, log pipeline, test runner) is adapted behind
 * this interface. The contract is deliberately BUFFERED-SYNC:
 *
 *   - pull-based ingest: `fetch(query)` returns validated raw observations
 *     (production backends feed an internal buffer from their async
 *     transports and serve this synchronous pull from it);
 *   - push-based ingest: `subscribe(listener)` streams observations to a
 *     listener as they are pushed into the source.
 *
 * GAPS ARE NEVER SILENCE: a source that has no data for a watched
 * subject/window surfaces an explicit UNAVAILABLE observation
 * (`recordGap`, or automatic gap detection in `fetch`). UNSUPPORTED
 * subjects surface explicit UNSUPPORTED observations. Nothing is
 * interpreted as zero or as absence-of-failure (spec/architecture-lock.md).
 */

import { assertValidProducer } from '@sos-2/provenance';
import { windowsOverlap } from '@sos-2/provenance';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { TelemetryError } from './errors.js';
import { assertValidRawObservation } from './observation.js';
import type { RawObservation } from './observation.js';

export interface TelemetryQuery {
  /** Exact subject_ref match (spine id or source-native label). */
  subject?: string;
  /** Only observations whose window overlaps this window (inclusive). */
  window?: TimeWindow;
}

export interface TelemetrySource {
  /** Stable, non-empty source identifier (e.g. "otel:collector:prod"). */
  readonly id: string;
  /** Human-readable description, or null. */
  readonly description: string | null;
  /** Pull-based ingest: validated observations matching the query (deterministic order). */
  fetch(query?: TelemetryQuery): RawObservation[];
  /** Push-based ingest (optional): stream observations to a listener; returns an unsubscribe function. */
  subscribe?(listener: (observation: RawObservation) => void): () => void;
}

export interface InMemoryTelemetrySourceInit {
  id: string;
  description?: string | null;
  /** Initial observations (validated). */
  observations?: RawObservation[];
  /** Producer recorded on synthesized gap/unsupported observations. Defaults to the in-memory source tool. */
  producer?: Producer;
  /** Subjects this source cannot serve; fetches for them surface explicit UNSUPPORTED observations. */
  unsupported?: string[];
}

const DEFAULT_SYNTH_PRODUCER: Producer = {
  tool: 'in-memory-telemetry-source',
  tool_version: null,
  model: null,
  model_version: null,
  command: null,
  environment: null,
};

/**
 * In-memory TelemetrySource adapter (pull + push).
 *
 * Deterministic behavior: fetch returns stored observations in insertion
 * order, followed by synthesized gap observations (watch order), followed by
 * synthesized unsupported observations. No hidden clocks: gap/unsupported
 * synthesis uses only caller-supplied query windows.
 */
export class InMemoryTelemetrySource implements TelemetrySource {
  readonly id: string;
  readonly description: string | null;
  private readonly producer: Producer;
  private readonly unsupportedSubjects: Set<string>;
  private readonly observations: RawObservation[] = [];
  private readonly watched: string[] = [];
  private readonly listeners = new Set<(observation: RawObservation) => void>();

  constructor(init: InMemoryTelemetrySourceInit) {
    if (typeof init !== 'object' || init === null) {
      throw new TelemetryError('in-memory telemetry source init must be an object');
    }
    if (typeof init.id !== 'string' || init.id.length === 0) {
      throw new TelemetryError(`telemetry source id must be a non-empty string, received: ${JSON.stringify(init.id)}`);
    }
    if (init.description !== undefined && init.description !== null && (typeof init.description !== 'string' || init.description.length === 0)) {
      throw new TelemetryError('telemetry source description must be null or a non-empty string');
    }
    this.id = init.id;
    this.description = init.description ?? null;
    this.producer = init.producer === undefined ? DEFAULT_SYNTH_PRODUCER : init.producer;
    try {
      assertValidProducer(this.producer);
    } catch (cause) {
      throw new TelemetryError(`producer is invalid: ${(cause as Error).message}`);
    }
    this.unsupportedSubjects = new Set(init.unsupported ?? []);
    for (const subject of this.unsupportedSubjects) {
      if (typeof subject !== 'string' || subject.length === 0) {
        throw new TelemetryError('unsupported subjects must be non-empty strings');
      }
    }
    for (const observation of init.observations ?? []) {
      this.push(observation);
    }
  }

  /** Push-based ingest: validate, store, and notify subscribers. Returns a defensive copy. */
  push(observation: RawObservation): RawObservation {
    assertValidRawObservation(observation);
    if (this.unsupportedSubjects.has(observation.subject_ref)) {
      throw new TelemetryError(
        `subject ${JSON.stringify(observation.subject_ref)} is declared unsupported by this source; pushing its observations is rejected`,
      );
    }
    const stored = structuredClone(observation);
    this.observations.push(stored);
    for (const listener of this.listeners) {
      listener(structuredClone(stored));
    }
    return structuredClone(stored);
  }

  /** Push a batch (insertion order preserved). */
  pushAll(observations: RawObservation[]): RawObservation[] {
    return observations.map((observation) => this.push(observation));
  }

  /**
   * Record an explicit GAP: an UNAVAILABLE observation for the subject/window.
   * A gap is data about missing data — never silence, never zero.
   */
  recordGap(gap: { subject: string; window: TimeWindow; reason?: string }): RawObservation {
    if (typeof gap.subject !== 'string' || gap.subject.length === 0) {
      throw new TelemetryError(`gap subject must be a non-empty string, received: ${JSON.stringify(gap.subject)}`);
    }
    const reason = gap.reason ?? 'no data in window';
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new TelemetryError('gap reason must be a non-empty string');
    }
    const observation: RawObservation = {
      subject_ref: gap.subject,
      availability: 'UNAVAILABLE',
      window: { ...gap.window },
      observed: null,
      attributes: { 'gap.reason': reason },
      producer: { ...this.producer },
    };
    assertValidRawObservation(observation);
    this.observations.push(observation);
    for (const listener of this.listeners) {
      listener(structuredClone(observation));
    }
    return structuredClone(observation);
  }

  /** Register a subject for automatic gap detection in window-bounded fetches. */
  watch(subject: string): void {
    if (typeof subject !== 'string' || subject.length === 0) {
      throw new TelemetryError(`watched subject must be a non-empty string, received: ${JSON.stringify(subject)}`);
    }
    if (!this.watched.includes(subject)) {
      this.watched.push(subject);
    }
  }

  /** Pull-based ingest (deterministic order: stored, then synthesized gaps, then unsupported). */
  fetch(query?: TelemetryQuery): RawObservation[] {
    const results: RawObservation[] = [];
    const filterSubject = query?.subject;
    const filterWindow = query?.window;
    if (filterSubject !== undefined && (typeof filterSubject !== 'string' || filterSubject.length === 0)) {
      throw new TelemetryError('query subject must be a non-empty string');
    }
    if (filterWindow !== undefined) {
      // validated via provenance's assertValidTimeWindow semantics inside overlap check
      try {
        const probe: RawObservation = {
          subject_ref: 'probe',
          availability: 'SUCCESS',
          window: filterWindow,
          observed: null,
          attributes: {},
          producer: { ...this.producer },
        };
        assertValidRawObservation(probe);
      } catch (cause) {
        throw new TelemetryError(`query window is invalid: ${(cause as Error).message}`);
      }
    }
    for (const observation of this.observations) {
      if (filterSubject !== undefined && observation.subject_ref !== filterSubject) {
        continue;
      }
      if (filterWindow !== undefined && !windowsOverlap(observation.window, filterWindow)) {
        continue;
      }
      results.push(structuredClone(observation));
    }
    // Explicitly-unsupported subject: surface UNSUPPORTED (distinct, never a gap).
    if (filterSubject !== undefined && filterWindow !== undefined && this.unsupportedSubjects.has(filterSubject)) {
      results.push({
        subject_ref: filterSubject,
        availability: 'UNSUPPORTED',
        window: { ...filterWindow },
        observed: null,
        attributes: { 'unsupported.reason': 'subject not supported by this source' },
        producer: { ...this.producer },
      });
      return results;
    }
    // Automatic gap detection for watched subjects (only for window-bounded queries).
    if (filterWindow !== undefined) {
      const gapCandidates =
        filterSubject !== undefined ? this.watched.filter((subject) => subject === filterSubject) : this.watched;
      for (const subject of gapCandidates) {
        if (this.unsupportedSubjects.has(subject)) {
          continue;
        }
        const hasData = this.observations.some(
          (observation) => observation.subject_ref === subject && windowsOverlap(observation.window, filterWindow),
        );
        if (!hasData) {
          results.push({
            subject_ref: subject,
            availability: 'UNAVAILABLE',
            window: { ...filterWindow },
            observed: null,
            attributes: { 'gap.reason': 'no data in window' },
            producer: { ...this.producer },
          });
        }
      }
    }
    return results;
  }

  /** Push-based ingest: stream pushed observations to a listener; returns unsubscribe. */
  subscribe(listener: (observation: RawObservation) => void): () => void {
    if (typeof listener !== 'function') {
      throw new TelemetryError('subscribe listener must be a function');
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get size(): number {
    return this.observations.length;
  }
}
