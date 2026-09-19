/**
 * In-memory provenance record store.
 *
 * - put(): validates; idempotent for identical content (same id + same
 *   canonical content); a different-content record under the same id is a
 *   collision and throws loudly.
 * - Deterministic queries: every listing is sorted by id.
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import { ProvenanceError } from './errors.js';
import { assertValidProvenanceRecord } from './record.js';
import type { ProvenanceRecord } from './record.js';

export class ProvenanceStore {
  private readonly records = new Map<string, ProvenanceRecord>();

  put(record: ProvenanceRecord): ProvenanceRecord {
    assertValidProvenanceRecord(record);
    const existing = this.records.get(record.id);
    if (existing !== undefined) {
      if (canonicalSerialize(existing) === canonicalSerialize(record)) {
        return existing; // idempotent re-put of identical content
      }
      throw new ProvenanceError(
        `provenance record collision for id ${record.id}: different content under the same deterministic id`,
      );
    }
    const stored: ProvenanceRecord = structuredClone(record);
    this.records.set(stored.id, stored);
    return stored;
  }

  get(id: string): ProvenanceRecord | undefined {
    const record = this.records.get(id);
    return record === undefined ? undefined : structuredClone(record);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  /** All records, sorted by id (deterministic). */
  list(): ProvenanceRecord[] {
    return [...this.records.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((record) => structuredClone(record));
  }

  /** Records bound to an exact source revision, sorted by id. */
  bySourceRevision(revision: string): ProvenanceRecord[] {
    return this.list().filter((record) => record.source_revision === revision);
  }

  /** Records bound to an exact deployment revision, sorted by id. */
  byDeploymentRevision(revision: string): ProvenanceRecord[] {
    return this.list().filter((record) => record.deployment_revision === revision);
  }

  /** Records produced by the given tool, sorted by id. */
  byTool(tool: string): ProvenanceRecord[] {
    return this.list().filter((record) => record.producer.tool === tool);
  }

  /** Records produced by model output (LLM), sorted by id. */
  llmProduced(): ProvenanceRecord[] {
    return this.list().filter((record) => record.llm_output);
  }

  /** Records whose provenance chain contains a hop referencing `ref`, sorted by id. */
  byChainRef(ref: string): ProvenanceRecord[] {
    return this.list().filter((record) => record.chain.some((hop) => hop.ref === ref));
  }

  get size(): number {
    return this.records.size;
  }
}
