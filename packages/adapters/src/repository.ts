/**
 * RepositoryAdapter — the W12 storage contract (docs/implementation/
 * REFERENCE-STACK.md: "storage is adapter based"; spec/architecture.md
 * section 17: platforms and vendors are adapters — they do not redefine
 * SOS semantics).
 *
 * WHAT THIS IS: the interface a durable store implements to persist the
 * spine's semantic types — ArtifactEnvelopes and TraceLinks — plus an
 * in-memory reference implementation. The SEMANTIC TYPES STAY
 * FRAMEWORK-INDEPENDENT: this module defines NO envelope shape, NO trace
 * link shape and NO identity scheme of its own; every value stored and
 * returned is a domain object from @sos-2/semantic-spine, validated by the
 * spine's own guards, and the in-memory reference delegates storage
 * mechanics to the spine's EnvelopeStore and TraceLinkStore (consumed —
 * never duplicated). A PostgreSQL adapter, a file adapter or any other
 * durable backend implements the SAME interface and preserves the same
 * spine semantics; swapping storage never changes meaning.
 */

import {
  EnvelopeStore,
  TraceLinkStore,
  assertValidEnvelope,
  assertValidTraceLink,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus, TraceLink } from '@sos-2/semantic-spine';
import { RepositoryAdapterError } from './errors.js';
import { verifyAdapterOutputs } from './semantic-bridge.js';
import type { AdapterContractDescriptor } from './semantic-bridge.js';

/** The repository adapter contract: bridged outputs are domain types only. */
export const REPOSITORY_ADAPTER_DESCRIPTOR: AdapterContractDescriptor = {
  contract: 'RepositoryAdapter',
  outputs: {
    envelope: 'ArtifactEnvelope',
    traceLink: 'TraceLink',
  },
} as const;

/** The envelope output site: every envelope returned is a spine envelope. */
export const REPOSITORY_ENVELOPE_OUTPUT: AdapterContractDescriptor = {
  contract: 'RepositoryAdapter',
  outputs: { envelope: 'ArtifactEnvelope' },
} as const;

/** The trace link output site: every link returned is a spine trace link. */
export const REPOSITORY_TRACE_LINK_OUTPUT: AdapterContractDescriptor = {
  contract: 'RepositoryAdapter',
  outputs: { traceLink: 'TraceLink' },
} as const;

/**
 * The storage adapter contract. All methods are synchronous in the reference
 * realization (mirroring the repo's store conventions — EnvelopeStore,
 * TraceLinkStore, GrantStore); a durable adapter implements the same
 * semantic contract.
 */
export interface RepositoryAdapter {
  /** The declared contract (bridged outputs; part of the semantic guard). */
  readonly descriptor: AdapterContractDescriptor;

  /** Store a spine envelope (validated by the spine; duplicate ids rejected). */
  putEnvelope(envelope: ArtifactEnvelope): ArtifactEnvelope;

  /** Fetch an envelope by artifact id, or undefined. */
  getEnvelope(id: string): ArtifactEnvelope | undefined;

  /** Does the repository hold this artifact id? */
  hasEnvelope(id: string): boolean;

  /** All envelopes, sorted by id (deterministic). */
  listEnvelopes(): ArtifactEnvelope[];

  /** All envelopes of one kind, sorted by id (deterministic). */
  envelopesOfKind(kind: string): ArtifactEnvelope[];

  /**
   * Validated envelope lifecycle transition (spine `withStatus` semantics:
   * identity preserved, invalid transitions throw).
   */
  setEnvelopeStatus(id: string, next: ArtifactStatus): ArtifactEnvelope;

  /** Store a typed trace link (validated by the spine; duplicate triples rejected). */
  putTraceLink(link: TraceLink): TraceLink;

  /** All trace links, insertion order (deterministic). */
  listTraceLinks(): TraceLink[];

  /** Forward query: all links whose source is `source`. */
  traceLinksFrom(source: string): TraceLink[];

  /** Backward query: all links whose target is `target`. */
  traceLinksTo(target: string): TraceLink[];
}

/**
 * In-memory reference implementation. Delegates envelope and link storage
 * to the spine's own stores (single semantics) and self-verifies every
 * output through the semantic bridge guard.
 */
export class InMemoryRepositoryAdapter implements RepositoryAdapter {
  readonly descriptor: AdapterContractDescriptor = REPOSITORY_ADAPTER_DESCRIPTOR;

  private readonly envelopes = new EnvelopeStore();
  private readonly links = new TraceLinkStore();

  putEnvelope(envelope: ArtifactEnvelope): ArtifactEnvelope {
    try {
      assertValidEnvelope(envelope);
    } catch (cause) {
      throw new RepositoryAdapterError(`envelope is not spine-valid: ${(cause as Error).message}`);
    }
    const stored = this.envelopes.put(envelope);
    verifyAdapterOutputs(REPOSITORY_ENVELOPE_OUTPUT, { envelope: stored });
    return stored;
  }

  getEnvelope(id: string): ArtifactEnvelope | undefined {
    const envelope = this.envelopes.get(id);
    if (envelope !== undefined) {
      verifyAdapterOutputs(REPOSITORY_ENVELOPE_OUTPUT, { envelope });
    }
    return envelope === undefined ? undefined : { ...envelope };
  }

  hasEnvelope(id: string): boolean {
    return this.envelopes.has(id);
  }

  listEnvelopes(): ArtifactEnvelope[] {
    return this.envelopes.list().map((envelope) => {
      verifyAdapterOutputs(REPOSITORY_ENVELOPE_OUTPUT, { envelope });
      return { ...envelope };
    });
  }

  envelopesOfKind(kind: string): ArtifactEnvelope[] {
    return this.listEnvelopes().filter((envelope) => envelope.kind === kind);
  }

  setEnvelopeStatus(id: string, next: ArtifactStatus): ArtifactEnvelope {
    const updated = this.envelopes.setStatus(id, next);
    verifyAdapterOutputs(REPOSITORY_ENVELOPE_OUTPUT, { envelope: updated });
    return { ...updated };
  }

  putTraceLink(link: TraceLink): TraceLink {
    try {
      assertValidTraceLink(link);
    } catch (cause) {
      throw new RepositoryAdapterError(`trace link is not spine-valid: ${(cause as Error).message}`);
    }
    const stored = this.links.add(link);
    verifyAdapterOutputs(REPOSITORY_TRACE_LINK_OUTPUT, { traceLink: stored });
    return { ...stored };
  }

  listTraceLinks(): TraceLink[] {
    return this.links.all();
  }

  traceLinksFrom(source: string): TraceLink[] {
    return this.links.from(source);
  }

  traceLinksTo(target: string): TraceLink[] {
    return this.links.to(target);
  }

  /** Number of stored envelopes (diagnostics). */
  get envelopeCount(): number {
    return this.envelopes.size;
  }

  /** Number of stored trace links (diagnostics). */
  get traceLinkCount(): number {
    return this.links.size;
  }
}
