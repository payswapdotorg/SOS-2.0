/**
 * The Evidence Graph (Work Order W3 goal) — evidence records linked to their
 * subjects (System State revisions, implementation models, causal
 * hypotheses, ...) through the Semantic Spine's TYPED trace links.
 *
 * No second semantic registry: the graph is a COMPOSITION of spine
 * primitives — records keyed by their spine ids plus the spine's own
 * TraceLinkStore for the 17 frozen link types. Evidence-to-System-State
 * traceability is a first-class query: `evidenceObserving(systemStateId)`
 * answers "which evidence observes this system state?" through OBSERVES
 * links, and `evidenceFor(subject)` answers "which evidence is about this
 * subject?" through the records' subject_ref.
 *
 * Deterministic behavior: every listing is sorted by id; put() is idempotent
 * for identical content and throws loudly on a different-content record
 * under the same deterministic id (content-addressed collision).
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import { TraceLinkStore } from '@sos-2/semantic-spine';
import type { TraceLink, TraceLinkType } from '@sos-2/semantic-spine';
import { assertValidEvidenceRecord } from './record.js';
import type { EvidenceRecordW3 } from './record.js';
import { EvidenceError } from './errors.js';

export interface CreateEvidenceLinkInput {
  /** Source: the id of an evidence record ALREADY in this graph. */
  source: string;
  /** Target: any well-formed spine artifact id (e.g. a SystemState revision). */
  target: string;
  /** One of the 17 frozen trace link types (typically OBSERVES, VERIFIES, SUPPORTS, CONTRADICTS). */
  type: TraceLinkType;
  /** Required non-empty provenance entries (spine discipline: no provenance-less links). */
  provenance: string[];
}

/**
 * In-memory Evidence Graph.
 */
export class EvidenceGraph {
  private readonly records = new Map<string, EvidenceRecordW3>();
  private readonly links = new TraceLinkStore();

  /**
   * Validate and store an evidence record.
   * Idempotent for identical content; a different-content record under the
   * same deterministic id is a collision and throws loudly.
   */
  put(record: EvidenceRecordW3): EvidenceRecordW3 {
    assertValidEvidenceRecord(record);
    const existing = this.records.get(record.id);
    if (existing !== undefined) {
      if (canonicalSerialize(existing) === canonicalSerialize(record)) {
        return structuredClone(existing); // idempotent re-put of identical content
      }
      throw new EvidenceError(
        `evidence record collision for id ${record.id}: different content under the same deterministic id`,
      );
    }
    const stored: EvidenceRecordW3 = structuredClone(record);
    this.records.set(stored.id, stored);
    return structuredClone(stored);
  }

  /**
   * Add a typed trace link from an evidence record in this graph to a target
   * artifact. The link is created and validated by the spine
   * (createTraceLink: well-formed ids, frozen type vocabulary, required
   * provenance) and stored in the spine's TraceLinkStore (duplicate
   * (source, target, type) triples are rejected).
   */
  link(input: CreateEvidenceLinkInput): TraceLink {
    if (!this.records.has(input.source)) {
      throw new EvidenceError(
        `link source ${JSON.stringify(input.source)} is not an evidence record in this graph — put the record first`,
      );
    }
    return this.links.addLink(input);
  }

  /**
   * Put a record AND link it OBSERVES its subject in one step — the W3
   * convention for evidence traceable to System State: the record's
   * provenance trail authorizes the observation link.
   */
  observe(record: EvidenceRecordW3): TraceLink {
    const stored = this.put(record);
    return this.link({
      source: stored.id,
      target: stored.subject_ref,
      type: 'OBSERVES',
      provenance: [...stored.provenance],
    });
  }

  get(id: string): EvidenceRecordW3 | undefined {
    const record = this.records.get(id);
    return record === undefined ? undefined : structuredClone(record);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  /** All evidence records, sorted by id (deterministic). */
  list(): EvidenceRecordW3[] {
    return [...this.records.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((record) => structuredClone(record));
  }

  /** Evidence records whose subject_ref is exactly `subject`, sorted by id. */
  evidenceFor(subject: string): EvidenceRecordW3[] {
    if (typeof subject !== 'string' || subject.length === 0) {
      throw new EvidenceError(`subject must be a non-empty string, received: ${JSON.stringify(subject)}`);
    }
    return this.list().filter((record) => record.subject_ref === subject);
  }

  /**
   * Evidence records linked to `subject` (typically a System State artifact
   * id) through OBSERVES links — the traceability query. Sorted by record id.
   */
  evidenceObserving(subject: string): EvidenceRecordW3[] {
    if (typeof subject !== 'string' || subject.length === 0) {
      throw new EvidenceError(`subject must be a non-empty string, received: ${JSON.stringify(subject)}`);
    }
    const linked = this.links.to(subject).filter((link) => link.type === 'OBSERVES');
    const records: EvidenceRecordW3[] = [];
    for (const link of linked) {
      const record = this.records.get(link.source);
      if (record !== undefined) {
        records.push(record);
      }
    }
    return records
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((record) => structuredClone(record));
  }

  /** Links whose source is the given evidence record id (insertion order). */
  linksFrom(source: string): TraceLink[] {
    return this.links.from(source);
  }

  /** Links whose target is the given artifact id (insertion order). */
  linksTo(target: string): TraceLink[] {
    return this.links.to(target);
  }

  /** All links (insertion order). */
  allLinks(): TraceLink[] {
    return this.links.all();
  }

  get size(): number {
    return this.records.size;
  }

  get linkCount(): number {
    return this.links.size;
  }
}
