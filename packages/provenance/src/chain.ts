/**
 * Provenance chains — hops, builder and verifier.
 *
 * A provenance chain documents WHAT a record was derived from. Each hop
 * references either a well-formed Semantic Spine artifact id
 * (sos://<Kind>/<32hex>) or an external revision token (a git SHA, an OCI
 * digest, an observation content hash such as
 * "observation:sha256:<hex>", ...). The ref_kind must be consistent with the
 * ref's form (validated loudly — catches typos).
 *
 * VERIFIER SEMANTICS (locked):
 *   verifyProvenanceChain(record, resolver?) reports broken chains as
 *   UNKNOWN — never as a silently truncated "verified up to hop N". ALL
 *   unresolved hops are reported, and the reason names the first one.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import { ProvenanceError } from './errors.js';

export type ProvenanceRefKind = 'ARTIFACT' | 'EXTERNAL_REVISION';

export interface ProvenanceHop {
  /** Well-formed artifact id (ARTIFACT) or non-empty external revision token (EXTERNAL_REVISION). */
  ref: string;
  /** Which kind of reference this is; must be consistent with the ref's form. */
  ref_kind: ProvenanceRefKind;
  /** Optional human-readable note, or null. */
  note: string | null;
}

function isProvenanceRefKind(value: unknown): value is ProvenanceRefKind {
  return value === 'ARTIFACT' || value === 'EXTERNAL_REVISION';
}

/** Structural check for a single hop. */
export function isProvenanceHop(value: unknown): value is ProvenanceHop {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !('ref' in record) || !('ref_kind' in record) || !('note' in record)) {
    return false;
  }
  if (typeof record['ref'] !== 'string' || record['ref'].length === 0) {
    return false;
  }
  if (!isProvenanceRefKind(record['ref_kind'])) {
    return false;
  }
  if (record['note'] !== null && (typeof record['note'] !== 'string' || record['note'].length === 0)) {
    return false;
  }
  return isArtifactId(record['ref']) === (record['ref_kind'] === 'ARTIFACT');
}

/** Full validation of a single hop with a specific error message (throws ProvenanceError). */
export function assertValidProvenanceHop(value: unknown): asserts value is ProvenanceHop {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProvenanceError('provenance hop must be an object with exact fields { ref, ref_kind, note }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !('ref' in record) || !('ref_kind' in record) || !('note' in record)) {
    throw new ProvenanceError('provenance hop must be an object with exact fields { ref, ref_kind, note }');
  }
  if (typeof record['ref'] !== 'string' || record['ref'].length === 0) {
    throw new ProvenanceError(`provenance hop ref must be a non-empty string, received: ${JSON.stringify(record['ref'])}`);
  }
  if (!isProvenanceRefKind(record['ref_kind'])) {
    throw new ProvenanceError(
      `provenance hop ref_kind must be ARTIFACT or EXTERNAL_REVISION, received: ${JSON.stringify(record['ref_kind'])}`,
    );
  }
  if (record['note'] !== null && (typeof record['note'] !== 'string' || record['note'].length === 0)) {
    throw new ProvenanceError(`provenance hop note must be null or a non-empty string, received: ${JSON.stringify(record['note'])}`);
  }
  if (isArtifactId(record['ref']) !== (record['ref_kind'] === 'ARTIFACT')) {
    throw new ProvenanceError(
      `provenance hop ref_kind ${record['ref_kind']} is inconsistent with ref form: ${JSON.stringify(record['ref'])} ` +
        `(sos:// ids must use ref_kind ARTIFACT; everything else is EXTERNAL_REVISION)`,
    );
  }
}

/** Predicate form of assertValidProvenanceHop. */
export function validateProvenanceHop(value: unknown): value is ProvenanceHop {
  try {
    assertValidProvenanceHop(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Provenance chain builder.
 *
 * Usage:
 *   const chain = new ProvenanceChainBuilder()
 *     .artifact('sos://ImplementationModel/541b...')
 *     .externalRevision('git:219cb9c8e329b0435f2deea37ec2d5003b264931', 'exact base')
 *     .build();
 *
 * build() validates every hop and returns a defensive copy array. An empty
 * chain is permitted (root provenance: the producer itself is the origin).
 */
export class ProvenanceChainBuilder {
  private readonly hops: ProvenanceHop[] = [];

  /** Append a hop referencing a well-formed spine artifact id. */
  artifact(id: string, note: string | null = null): this {
    if (typeof id !== 'string' || !isArtifactId(id)) {
      throw new ProvenanceError(`artifact hop requires a well-formed artifact id, received: ${JSON.stringify(id)}`);
    }
    if (note !== null && (typeof note !== 'string' || note.length === 0)) {
      throw new ProvenanceError('hop note must be null or a non-empty string');
    }
    this.hops.push({ ref: id, ref_kind: 'ARTIFACT', note });
    return this;
  }

  /** Append a hop referencing an external revision token (non-empty, non-sos:// form). */
  externalRevision(token: string, note: string | null = null): this {
    if (typeof token !== 'string' || token.length === 0) {
      throw new ProvenanceError(`external revision hop requires a non-empty token, received: ${JSON.stringify(token)}`);
    }
    if (isArtifactId(token)) {
      throw new ProvenanceError(
        `external revision hop received a well-formed artifact id: ${JSON.stringify(token)} (use .artifact() for sos:// ids)`,
      );
    }
    if (note !== null && (typeof note !== 'string' || note.length === 0)) {
      throw new ProvenanceError('hop note must be null or a non-empty string');
    }
    this.hops.push({ ref: token, ref_kind: 'EXTERNAL_REVISION', note });
    return this;
  }

  /** Build the validated chain (defensive copy). */
  build(): ProvenanceHop[] {
    const copy = this.hops.map((hop) => ({ ...hop }));
    for (const hop of copy) {
      assertValidProvenanceHop(hop);
    }
    return copy;
  }

  get length(): number {
    return this.hops.length;
  }
}

export interface ProvenanceUnresolvedHop {
  /** Zero-based index of the unresolved hop within the chain. */
  index: number;
  ref: string;
  ref_kind: ProvenanceRefKind;
}

export interface ChainVerification {
  /**
   * VERIFIED when every hop is structurally valid AND (when a resolver is
   * supplied) resolvable. Any broken hop yields UNKNOWN — broken chains are
   * never silently truncated into a partial VERIFIED.
   */
  status: 'VERIFIED' | 'UNKNOWN';
  /** Total hop count of the chain that was verified (truncation-free). */
  hops: number;
  /** Every unresolved hop (all of them — never just the first). */
  unresolved: ProvenanceUnresolvedHop[];
  reason: string;
}

/** Anything with a chain of hops (structural so ProvenanceRecord satisfies it). */
export interface HasProvenanceChain {
  chain: ProvenanceHop[];
}

/**
 * Verify a provenance chain.
 *
 * - Without a resolver: structural verification only (each hop well-formed
 *   and internally consistent).
 * - With a resolver: full verification — every hop must additionally be
 *   resolvable according to the resolver (resolver returns true).
 *
 * Deterministic and total: identical inputs produce identical outputs.
 */
export function verifyProvenanceChain(
  value: HasProvenanceChain,
  resolver?: (ref: string) => boolean,
): ChainVerification {
  if (typeof value !== 'object' || value === null || !Array.isArray(value.chain)) {
    throw new ProvenanceError('verifyProvenanceChain requires an object with a chain array');
  }
  const unresolved: ProvenanceUnresolvedHop[] = [];
  for (let index = 0; index < value.chain.length; index += 1) {
    const hop = value.chain[index]!;
    if (!isProvenanceHop(hop)) {
      const raw = (hop as { ref?: unknown } | null | undefined)?.ref;
      unresolved.push({
        index,
        ref: typeof raw === 'string' && raw.length > 0 ? raw : '<malformed-hop>',
        ref_kind: 'EXTERNAL_REVISION',
      });
      continue;
    }
    if (resolver !== undefined && !resolver(hop.ref)) {
      unresolved.push({ index, ref: hop.ref, ref_kind: hop.ref_kind });
    }
  }
  if (unresolved.length === 0) {
    return {
      status: 'VERIFIED',
      hops: value.chain.length,
      unresolved: [],
      reason:
        resolver === undefined
          ? `structural verification passed for all ${value.chain.length} hop(s)`
          : `all ${value.chain.length} hop(s) resolved`,
    };
  }
  const first = unresolved[0]!;
  return {
    status: 'UNKNOWN',
    hops: value.chain.length,
    unresolved,
    reason:
      `broken provenance chain: hop ${first.index} (${first.ref}) is ${resolver === undefined ? 'malformed' : 'unresolvable'}; ` +
      `${unresolved.length} of ${value.chain.length} hop(s) unresolved — reported, not truncated`,
  };
}
