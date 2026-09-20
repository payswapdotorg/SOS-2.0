/**
 * The Causal Knowledge Store (Work Order W5) — hypotheses and correlation
 * records under spine envelope lifecycle discipline, with typed trace links:
 *
 *   - SUPPORTS links, evidence record -> hypothesis/correlation (minted from
 *     the class-typed evidence references when an artifact is stored, so
 *     every causal claim is traceable to its evidence through the spine);
 *   - DERIVED_FROM links for revision lineage (revised -> previous) and for
 *     the explicit correlation -> hypothesis promotion.
 *
 * Guarantees:
 *   - put(): no duplicate ids; supersedes targets must exist, be of the SAME
 *     kind, and be superseded with version exactly +1 (contiguous,
 *     unbranched chains).
 *   - revise(): only ACTIVE hypotheses can be revised; the revision content
 *     is FULLY re-validated INCLUDING the §18 claim gate — a revision that
 *     upgrades the claim to CAUSAL without interventional SUCCESS evidence
 *     is rejected loudly; correlation_origin is PRESERVED across revisions.
 *   - hypothesize(): the explicit, evidence-gated, traced promotion of a
 *     stored correlation record to a causal hypothesis.
 *   - history(): complete root -> head chain, ordered by version, contiguous,
 *     cycle-checked.
 *
 * Determinism: every listing is sorted by id; link queries return insertion
 * order (the spine's TraceLinkStore discipline).
 */

import {
  EnvelopeStore,
  TraceLinkStore,
  createTraceLink,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, TraceLink } from '@sos-2/semantic-spine';
import { CausalError } from './errors.js';
import { assertValidCausalHypothesis, createCausalHypothesis } from './hypothesis.js';
import type { CausalHypothesisArtifact, CausalHypothesisContent } from './hypothesis.js';
import {
  assertValidCorrelationRecord,
  hypothesisFromCorrelation,
} from './correlation.js';
import type {
  CorrelationRecordArtifact,
  CorrelationRecordContent,
  HypothesizeFromCorrelationInput,
} from './correlation.js';

/** The revision input for a stored causal hypothesis. */
export interface ReviseHypothesisInput {
  /** The next hypothesis content (WITHOUT correlation_origin — it is preserved from the current version). */
  content: Omit<CausalHypothesisContent, 'correlation_origin'>;
  /** REQUIRED non-empty provenance entries. */
  provenance: string[];
  /** RFC3339 revision timestamp, caller-supplied. */
  created_at: string;
  /** Authorizing artifact id; defaults to the current version's authority_ref. */
  authority_ref?: string | null;
}

export interface HypothesisRevisionResult {
  /** The hypothesis being revised (as it was). */
  previous: CausalHypothesisArtifact;
  /** The new revision (ACTIVE, version + 1, supersedes previous). */
  revised: CausalHypothesisArtifact;
  /** DERIVED_FROM trace link: revised -> previous. */
  revision_link: TraceLink;
}

/** The store-level promotion input (correlation is looked up in the store). */
export type StoreHypothesizeInput = HypothesizeFromCorrelationInput;

/**
 * In-memory Causal Knowledge Store.
 */
export class CausalKnowledgeStore {
  private readonly envelopes = new EnvelopeStore();
  private readonly hypothesisContents = new Map<string, CausalHypothesisContent>();
  private readonly correlationContents = new Map<string, CorrelationRecordContent>();
  private readonly links = new TraceLinkStore();

  private requireHypothesisContent(id: string): CausalHypothesisContent {
    const content = this.hypothesisContents.get(id);
    if (content === undefined) {
      throw new CausalError(`unknown causal hypothesis id: ${id}`);
    }
    return content;
  }

  private requireCorrelationContent(id: string): CorrelationRecordContent {
    const content = this.correlationContents.get(id);
    if (content === undefined) {
      throw new CausalError(`unknown correlation record id: ${id}`);
    }
    return content;
  }

  private assembleHypothesis(envelope: ArtifactEnvelope): CausalHypothesisArtifact {
    return { envelope, content: structuredClone(this.requireHypothesisContent(envelope.id)) };
  }

  private assembleCorrelation(envelope: ArtifactEnvelope): CorrelationRecordArtifact {
    return { envelope, content: structuredClone(this.requireCorrelationContent(envelope.id)) };
  }

  /** Mint SUPPORTS links from each distinct evidence reference to the artifact. */
  private mintEvidenceLinks(artifactId: string, evidenceIds: readonly string[], provenance: string[]): void {
    for (const evidenceId of new Set(evidenceIds)) {
      this.links.addLink({
        source: evidenceId,
        target: artifactId,
        type: 'SUPPORTS',
        provenance: [...provenance],
      });
    }
  }

  /** Validate and store a causal hypothesis (root or continuation of a chain). */
  putHypothesis(hypothesis: CausalHypothesisArtifact): CausalHypothesisArtifact {
    assertValidCausalHypothesis(hypothesis);
    if (hypothesis.envelope.supersedes !== null) {
      const previous = this.envelopes.get(hypothesis.envelope.supersedes);
      if (previous === undefined) {
        throw new CausalError(
          `hypothesis ${hypothesis.envelope.id} supersedes unknown artifact ${hypothesis.envelope.supersedes} (revision history must be complete)`,
        );
      }
      if (previous.kind !== 'CausalHypothesis') {
        throw new CausalError(`a causal hypothesis cannot supersede a ${previous.kind} artifact: ${previous.id}`);
      }
      if (hypothesis.envelope.version !== previous.version + 1) {
        throw new CausalError(
          `hypothesis revision version must be exactly previous.version + 1 (expected ${previous.version + 1}, received ${hypothesis.envelope.version})`,
        );
      }
    }
    this.envelopes.put(hypothesis.envelope);
    this.hypothesisContents.set(hypothesis.envelope.id, structuredClone(hypothesis.content));
    this.mintEvidenceLinks(
      hypothesis.envelope.id,
      [
        ...hypothesis.content.observational_evidence.map((ref) => ref.evidence_id),
        ...hypothesis.content.interventional_evidence.map((ref) => ref.evidence_id),
      ],
      hypothesis.envelope.provenance,
    );
    return hypothesis;
  }

  /** Validate and store a correlation record (root or continuation of a chain). */
  putCorrelation(correlation: CorrelationRecordArtifact): CorrelationRecordArtifact {
    assertValidCorrelationRecord(correlation);
    if (correlation.envelope.supersedes !== null) {
      const previous = this.envelopes.get(correlation.envelope.supersedes);
      if (previous === undefined) {
        throw new CausalError(
          `correlation record ${correlation.envelope.id} supersedes unknown artifact ${correlation.envelope.supersedes} (revision history must be complete)`,
        );
      }
      if (previous.kind !== 'CorrelationRecord') {
        throw new CausalError(`a correlation record cannot supersede a ${previous.kind} artifact: ${previous.id}`);
      }
      if (correlation.envelope.version !== previous.version + 1) {
        throw new CausalError(
          `correlation record revision version must be exactly previous.version + 1 (expected ${previous.version + 1}, received ${correlation.envelope.version})`,
        );
      }
    }
    this.envelopes.put(correlation.envelope);
    this.correlationContents.set(correlation.envelope.id, structuredClone(correlation.content));
    this.mintEvidenceLinks(
      correlation.envelope.id,
      [
        ...correlation.content.observational_evidence.map((ref) => ref.evidence_id),
        ...correlation.content.interventional_evidence.map((ref) => ref.evidence_id),
      ],
      correlation.envelope.provenance,
    );
    return correlation;
  }

  getHypothesis(id: string): CausalHypothesisArtifact | undefined {
    const envelope = this.envelopes.get(id);
    if (envelope === undefined || envelope.kind !== 'CausalHypothesis') {
      return undefined;
    }
    return this.assembleHypothesis(envelope);
  }

  getCorrelation(id: string): CorrelationRecordArtifact | undefined {
    const envelope = this.envelopes.get(id);
    if (envelope === undefined || envelope.kind !== 'CorrelationRecord') {
      return undefined;
    }
    return this.assembleCorrelation(envelope);
  }

  has(id: string): boolean {
    return this.envelopes.has(id);
  }

  /** All causal hypotheses, sorted by id (deterministic). */
  listHypotheses(): CausalHypothesisArtifact[] {
    return this.envelopes
      .list()
      .filter((envelope) => envelope.kind === 'CausalHypothesis')
      .map((envelope) => this.assembleHypothesis(envelope));
  }

  /** All correlation records, sorted by id (deterministic). */
  listCorrelations(): CorrelationRecordArtifact[] {
    return this.envelopes
      .list()
      .filter((envelope) => envelope.kind === 'CorrelationRecord')
      .map((envelope) => this.assembleCorrelation(envelope));
  }

  get hypothesisCount(): number {
    return this.listHypotheses().length;
  }

  get correlationCount(): number {
    return this.listCorrelations().length;
  }

  /**
   * The explicit revision workflow against a stored hypothesis. The revision
   * content is fully re-validated (INCLUDING the §18 claim gate); the
   * correlation_origin is preserved from the current version.
   */
  reviseHypothesis(id: string, input: ReviseHypothesisInput): HypothesisRevisionResult {
    const currentEnvelope = this.envelopes.get(id);
    if (currentEnvelope === undefined || currentEnvelope.kind !== 'CausalHypothesis') {
      throw new CausalError(`unknown causal hypothesis id: ${id}`);
    }
    const current = this.assembleHypothesis(currentEnvelope);
    if (current.envelope.status !== 'ACTIVE') {
      throw new CausalError(
        `only ACTIVE causal hypotheses can be revised; current status: ${current.envelope.status}`,
      );
    }
    if (typeof input !== 'object' || input === null) {
      throw new CausalError('hypothesis revision input must be an object');
    }

    const content: CausalHypothesisContent = {
      ...(input.content as Omit<CausalHypothesisContent, 'correlation_origin'>),
      correlation_origin: current.content.correlation_origin,
    };

    const revised = createCausalHypothesis({
      content,
      provenance: input.provenance,
      created_at: input.created_at,
      authority_ref: input.authority_ref ?? current.envelope.authority_ref,
      version: current.envelope.version + 1,
      status: 'ACTIVE',
      supersedes: current.envelope.id,
    });

    const revision_link = createTraceLink({
      source: revised.envelope.id,
      target: current.envelope.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance],
    });

    this.envelopes.setStatus(id, 'SUPERSEDED');
    this.envelopes.put(revised.envelope);
    this.hypothesisContents.set(revised.envelope.id, structuredClone(revised.content));
    this.mintEvidenceLinks(
      revised.envelope.id,
      [
        ...revised.content.observational_evidence.map((ref) => ref.evidence_id),
        ...revised.content.interventional_evidence.map((ref) => ref.evidence_id),
      ],
      revised.envelope.provenance,
    );
    this.links.add(revision_link);

    return {
      previous: this.assembleHypothesis(this.envelopes.get(id)!),
      revised: this.assembleHypothesis(this.envelopes.get(revised.envelope.id)!),
      revision_link,
    };
  }

  /**
   * The EXPLICIT, evidence-gated promotion of a stored correlation record to
   * a causal hypothesis (never silent; throws without interventional SUCCESS
   * evidence; the derivation is traced DERIVED_FROM the correlation record).
   */
  hypothesize(correlationId: string, input: StoreHypothesizeInput): {
    correlation: CorrelationRecordArtifact;
    hypothesis: CausalHypothesisArtifact;
    derivation_link: TraceLink;
  } {
    const correlationEnvelope = this.envelopes.get(correlationId);
    if (correlationEnvelope === undefined || correlationEnvelope.kind !== 'CorrelationRecord') {
      throw new CausalError(`unknown correlation record id: ${correlationId}`);
    }
    const correlation = this.assembleCorrelation(correlationEnvelope);
    const result = hypothesisFromCorrelation(correlation, input);
    this.putHypothesis(result.hypothesis);
    this.links.add(result.derivation_link);
    return {
      correlation,
      hypothesis: this.assembleHypothesis(this.envelopes.get(result.hypothesis.envelope.id)!),
      derivation_link: result.derivation_link,
    };
  }

  /**
   * Complete revision history for a hypothesis: [root, ..., this revision],
   * ordered by strictly increasing version. Throws if the chain is
   * incomplete, non-contiguous or cyclic.
   */
  history(id: string): CausalHypothesisArtifact[] {
    const start = this.getHypothesis(id);
    if (start === undefined) {
      throw new CausalError(`unknown causal hypothesis id: ${id}`);
    }
    const chain: CausalHypothesisArtifact[] = [];
    const visited = new Set<string>();
    let cursor: CausalHypothesisArtifact | undefined = start;
    while (cursor !== undefined) {
      if (visited.has(cursor.envelope.id)) {
        throw new CausalError(`revision cycle detected at ${cursor.envelope.id}`);
      }
      visited.add(cursor.envelope.id);
      chain.push(cursor);
      const previousId = cursor.envelope.supersedes;
      if (previousId === null) {
        cursor = undefined;
        continue;
      }
      const previous = this.getHypothesis(previousId);
      if (previous === undefined) {
        throw new CausalError(`incomplete revision history: missing supersedes target ${previousId}`);
      }
      if (cursor.envelope.version !== previous.envelope.version + 1) {
        throw new CausalError(
          `non-contiguous revision history at ${cursor.envelope.id} (version ${cursor.envelope.version} follows ${previous.envelope.version})`,
        );
      }
      cursor = previous;
    }
    chain.reverse();
    return chain;
  }

  /** The current ACTIVE hypotheses (each revision chain has at most one). */
  activeHypotheses(): CausalHypothesisArtifact[] {
    return this.listHypotheses().filter((hypothesis) => hypothesis.envelope.status === 'ACTIVE');
  }

  /** SUPPORTS links from evidence records to the given artifact id (insertion order). */
  evidenceSupporting(artifactId: string): TraceLink[] {
    return this.links.to(artifactId).filter((link) => link.type === 'SUPPORTS');
  }

  /** All recorded trace links (insertion order). */
  allLinks(): TraceLink[] {
    return this.links.all();
  }

  get linkCount(): number {
    return this.links.size;
  }
}
