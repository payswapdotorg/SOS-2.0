/**
 * Specialization/generalization — typed lineage operations on packages
 * (Work Order W13; spec/architecture.md §5 Package, §11 diversity, §18
 * invariants; the SPECIALIZES and GENERALIZES trace types are two of the 17
 * frozen Semantic Spine trace types).
 *
 * DESIGN:
 *   - SPECIALIZE creates a NEW package record for a NARROWER context: the
 *     new declaring context must be a STRICT refinement of the base's (every
 *     base key preserved, at least one added). A niche variant joins the
 *     repertoire; the base is NOT superseded (diversity is intentional — a
 *     specialization coexists with its base).
 *   - GENERALIZE creates a NEW package record for a BROADER context: the new
 *     declaring context must be a STRICT broadening (a sub-map of the base's
 *     context with fewer keys). Broadening to the EMPTY context — a
 *     universal score — is REJECTED (spec/architecture.md §12; the W6
 *     context authority rejects empty conditions).
 *   - COPIED FORWARD (machine-checked, superset-enforced): evidence refs,
 *     FAILURE refs (negative evidence is retained — never dropped),
 *     learned limitations, contracts, preconditions, postconditions,
 *     realizations, assurance obligations (reuse never bypasses assurance)
 *     and the base's estimates that remain valid in the new context. The
 *     lineage never silently drops what the base knew.
 *   - LINEAGE PRESERVES PROVENANCE (every update carries who/what/which
 *     evidence): the operation REQUIRES non-empty provenance (who/what) and
 *     its OWN non-empty evidence refs (which evidence justifies the
 *     derivation); the lineage record carries both plus the spine trace
 *     link (derived --SPECIALIZES|GENERALIZES--> base) minted through the
 *     spine with the operation's provenance.
 *   - NO SILENT AUTONOMY: the derived package always starts DISCOVERED —
 *     maturity is earned through the W6 governed, evidence-gated lifecycle
 *     (the registry's promote path), never through a lineage operation.
 *   - The derived artifact is created through the W6 authority
 *     (createPackageArtifact — deterministic content-addressed identity);
 *     nothing here duplicates envelope or identity logic.
 */

import { createTraceLink, fullContentHash, isArtifactId, RFC3339_PATTERN } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import {
  assertValidContextCondition,
  contextSpecificity,
  createPackageArtifact,
  matchesCondition,
} from '@sos-2/packages';
import type {
  ApplicabilityEstimate,
  AssuranceObligation,
  ContextCondition,
  DiversityProfile,
  PackageArtifact,
  PackageRealization,
} from '@sos-2/packages';
import { assertValidPackageArtifact } from '@sos-2/packages';
import { TransferError } from './errors.js';

/** The two typed lineage operations (frozen trace types). */
export const LINEAGE_OPERATIONS = ['SPECIALIZE', 'GENERALIZE'] as const;

export type LineageOperation = (typeof LINEAGE_OPERATIONS)[number];

const LINEAGE_OPERATION_SET: ReadonlySet<string> = new Set(LINEAGE_OPERATIONS);

/** Structural check: one of the two lineage operations? */
export function isLineageOperation(value: unknown): value is LineageOperation {
  return typeof value === 'string' && LINEAGE_OPERATION_SET.has(value);
}

/** A lineage record — the who/what/which-evidence of one derivation. */
export interface LineageRecord {
  /** Deterministic content-addressed id (64 lowercase hex; NOT a spine artifact id). */
  id: string;
  /** SPECIALIZE or GENERALIZE. */
  operation: LineageOperation;
  /** The base package's spine id. */
  base_id: string;
  /** The derived package's spine id. */
  derived_id: string;
  /** The spine trace link: derived --SPECIALIZES|GENERALIZES--> base. */
  link: TraceLink;
  /** The operation's OWN evidence — NON-EMPTY, well-formed sos://Evidence ids (sorted unique). */
  evidence_refs: string[];
  /** Who/what performed the derivation — non-empty entries. */
  provenance: string[];
  /** RFC3339 timestamp (caller-supplied; never a hidden clock). */
  created_at: string;
  /** Optional statement, or null. */
  note: string | null;
}

/** Input to a specialize/generalize operation (shared shape). */
export interface LineageOperationInput {
  /** The base package artifact (validated through the W6 authority). */
  base: PackageArtifact;
  /**
   * The derived package's declaring context: a STRICT refinement
   * (SPECIALIZE) or STRICT broadening (GENERALIZE) of the base's context.
   */
  context: ContextCondition;
  /** NON-EMPTY — the operation's OWN evidence refs (well-formed sos://Evidence ids). */
  evidence_refs: string[];
  /** NON-EMPTY — who/what performed the derivation. */
  provenance: string[];
  /** RFC3339 timestamp. */
  created_at: string;
  /** Non-empty version note for the derived package. */
  changes: string;
  /** Additional learned limitations of the derived realization. */
  added_limitations?: string[];
  /** Additional failure evidence refs (the base's are ALWAYS retained). */
  added_failure_refs?: string[];
  /** Additional supporting evidence refs (the base's are ALWAYS retained). */
  added_evidence_refs?: string[];
  /** Additional assurance obligations (the base's are ALWAYS retained). */
  added_obligations?: AssuranceObligation[];
  /** Additional contracts (the base's are ALWAYS retained). */
  added_contracts?: string[];
  /** Additional realizations (the base's are ALWAYS retained). */
  added_realizations?: PackageRealization[];
  /** Additional preconditions (the base's are ALWAYS retained). */
  added_preconditions?: string[];
  /** Additional postconditions (the base's are ALWAYS retained). */
  added_postconditions?: string[];
  /** Optional applicability override; default: the base's estimates that remain valid in the new context. */
  applicability?: ApplicabilityEstimate[];
  /** Optional diversity-profile override; default: the base's (the variant stays in the family). */
  diversity_profile?: DiversityProfile;
  /** Optional capability statement override; default: the base's. */
  semantic_capability?: string;
  /** Authorizing artifact id, or null. */
  authority_ref?: string | null;
  /** Optional lineage note. */
  note?: string | null;
}

/** The result of a lineage operation. */
export interface LineageResult {
  /** The derived package artifact (always DISCOVERED; W6 identity discipline). */
  artifact: PackageArtifact;
  /** The lineage record (who/what/which evidence + the spine trace link). */
  lineage: LineageRecord;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Append `added` entries to `base` entries, preserving order and dropping duplicates. */
function appendUnique(base: readonly string[], added: readonly string[] | undefined): string[] {
  const result = [...base];
  if (added === undefined) {
    return result;
  }
  for (const entry of added) {
    if (!result.includes(entry)) {
      result.push(entry);
    }
  }
  return result;
}

function appendUniqueObjects<T>(base: readonly T[], added: readonly T[] | undefined, keyOf: (item: T) => string): T[] {
  const result = [...base];
  if (added === undefined) {
    return result;
  }
  const seen = new Set(base.map(keyOf));
  for (const entry of added) {
    const key = keyOf(entry);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

/** Validate the shared invariants of a lineage operation input. */
function assertValidLineageInput(input: LineageOperationInput): void {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TransferError(`lineage operation input must be an object, received: ${JSON.stringify(input)}`);
  }
  try {
    assertValidPackageArtifact(input.base);
  } catch (cause) {
    throw new TransferError(`lineage base package is invalid: ${(cause as Error).message}`);
  }
  try {
    assertValidContextCondition(input.context, 'lineage context');
  } catch (cause) {
    throw new TransferError(`lineage context is invalid: ${(cause as Error).message}`);
  }
  if (!isNonEmptyStringArray(input.evidence_refs)) {
    throw new TransferError(
      'lineage evidence_refs must be a NON-EMPTY array — every lineage update carries WHICH evidence justifies it',
    );
  }
  for (const ref of input.evidence_refs) {
    if (!isArtifactId(ref)) {
      throw new TransferError(`lineage evidence_refs entries must be well-formed spine ids, received: ${JSON.stringify(ref)}`);
    }
  }
  for (const ref of input.added_failure_refs ?? []) {
    if (!isArtifactId(ref)) {
      throw new TransferError(`added_failure_refs entries must be well-formed spine ids, received: ${JSON.stringify(ref)}`);
    }
  }
  for (const ref of input.added_evidence_refs ?? []) {
    if (!isArtifactId(ref)) {
      throw new TransferError(`added_evidence_refs entries must be well-formed spine ids, received: ${JSON.stringify(ref)}`);
    }
  }
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new TransferError('lineage provenance must be a non-empty array — every lineage update carries WHO/WHAT');
  }
  if (typeof input.created_at !== 'string' || !RFC3339_PATTERN.test(input.created_at)) {
    throw new TransferError(`lineage created_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.created_at)}`);
  }
  if (typeof input.changes !== 'string' || input.changes.length === 0) {
    throw new TransferError(`lineage changes must be a non-empty version note, received: ${JSON.stringify(input.changes)}`);
  }
}

/** Are two contexts CONSISTENT (no shared key with a different value)? */
function contextsConsistent(a: ContextCondition, b: ContextCondition): boolean {
  for (const [key, value] of Object.entries(a)) {
    const other = b[key];
    if (other !== undefined && other !== value) {
      return false;
    }
  }
  return true;
}

/**
 * The base's estimates that remain valid alongside `context` — every
 * estimate CONSISTENT with the new declaring context (no conflicting keys;
 * hierarchical conditioning allows both broader and narrower estimates,
 * docs/probabilistic-learning.md: "global -> domain -> niche -> system ->
 * current context").
 */
function consistentEstimates(
  estimates: readonly ApplicabilityEstimate[],
  context: ContextCondition,
): ApplicabilityEstimate[] {
  return estimates.filter((estimate) => contextsConsistent(estimate.context, context));
}

/** Validate that every supplied estimate is consistent with the declaring context (no conflicts). */
function assertEstimatesConsistentWith(estimates: readonly ApplicabilityEstimate[], context: ContextCondition): void {
  for (const estimate of estimates) {
    if (!contextsConsistent(estimate.context, context)) {
      throw new TransferError(
        `derived package estimates must be consistent with its declaring context ${JSON.stringify(context)} — ` +
          `received a conflicting estimate conditioned on ${JSON.stringify(estimate.context)}`,
      );
    }
  }
}

function buildDerivedContent(
  input: LineageOperationInput,
  operation: LineageOperation,
): ReturnType<typeof derivedContentShape> {
  const base = input.base;
  const newContext = input.context;
  // Context discipline (operation-specific, checked by the caller).
  // Applicability: caller override, else the base's estimates consistent with the new context.
  let applicability: ApplicabilityEstimate[];
  if (input.applicability !== undefined) {
    if (input.applicability.length === 0) {
      throw new TransferError('derived package applicability override must be NON-EMPTY (packages without applicability are rejected)');
    }
    applicability = input.applicability.map((estimate) => structuredClone(estimate));
  } else {
    applicability = consistentEstimates(base.content.applicability, newContext).map((estimate) => structuredClone(estimate));
    if (applicability.length === 0) {
      throw new TransferError(
        `no base applicability estimate remains valid alongside the ${operation === 'SPECIALIZE' ? 'narrowed' : 'broadened'} context — ` +
          'supply the derived package\'s applicability explicitly',
      );
    }
  }
  assertEstimatesConsistentWith(applicability, newContext);
  return derivedContentShape(input, newContext, applicability);
}

function derivedContentShape(
  input: LineageOperationInput,
  newContext: ContextCondition,
  applicability: ApplicabilityEstimate[],
) {
  const base = input.base;
  return {
    semantic_capability: input.semantic_capability ?? base.content.semantic_capability,
    contracts: appendUnique(base.content.contracts, input.added_contracts),
    preconditions: appendUnique(base.content.preconditions, input.added_preconditions),
    postconditions: appendUnique(base.content.postconditions, input.added_postconditions),
    realizations: appendUniqueObjects(base.content.realizations, input.added_realizations, (r) => r.ref),
    applicability,
    // Copied forward + the operation's own evidence (superset of the base's, enforced).
    evidence_refs: appendUnique(appendUnique(base.content.evidence_refs, input.evidence_refs), input.added_evidence_refs),
    failure_refs: appendUnique(base.content.failure_refs, input.added_failure_refs),
    compatibility_refs: [...base.content.compatibility_refs],
    composition_refs: [...base.content.composition_refs],
    assurance_obligations: appendUniqueObjects(
      base.content.assurance_obligations,
      input.added_obligations,
      (o) => `${o.kind}:${o.obligation}`,
    ),
    context: { ...newContext },
    learned_limitations: appendUnique(base.content.learned_limitations, input.added_limitations),
    diversity_profile: input.diversity_profile
      ? structuredClone(input.diversity_profile)
      : structuredClone(base.content.diversity_profile),
    // No silent autonomy: a lineage operation never promotes.
    maturity: 'DISCOVERED' as const,
    changes: input.changes,
    superseded_by: null,
  };
}

/**
 * SPECIALIZE: create a new package record for a STRICTLY NARROWER context.
 * The new context must preserve every base context key (same values) and
 * add at least one — a "specialization" that does not narrow is REJECTED.
 */
export function specializePackage(input: LineageOperationInput): LineageResult {
  assertValidLineageInput(input);
  const baseContext = input.base.content.context;
  const newContext = input.context;
  const narrows = matchesCondition(baseContext, newContext);
  if (!narrows || contextSpecificity(newContext) <= contextSpecificity(baseContext)) {
    throw new TransferError(
      `SPECIALIZE requires a STRICTLY narrower context: every base key preserved plus at least one added — base ` +
        `${JSON.stringify(baseContext)}, received ${JSON.stringify(newContext)}`,
    );
  }
  const content = buildDerivedContent(input, 'SPECIALIZE');
  const artifact = createPackageArtifact({
    content,
    provenance: [...input.provenance],
    created_at: input.created_at,
    authority_ref: input.authority_ref ?? null,
  });
  const link = createTraceLink({
    source: artifact.envelope.id,
    target: input.base.envelope.id,
    type: 'SPECIALIZES',
    provenance: [...input.provenance],
  });
  const lineage = lineageRecord('SPECIALIZE', input, artifact.envelope.id, link);
  return { artifact, lineage };
}

/**
 * GENERALIZE: create a new package record for a STRICTLY BROADER context.
 * The new context must be a strict sub-map of the base's (fewer keys, all
 * preserved values) — and never empty (a universal score is REJECTED by the
 * W6 context authority).
 */
export function generalizePackage(input: LineageOperationInput): LineageResult {
  assertValidLineageInput(input);
  const baseContext = input.base.content.context;
  const newContext = input.context;
  const broadens = matchesCondition(newContext, baseContext);
  if (!broadens || contextSpecificity(newContext) >= contextSpecificity(baseContext)) {
    throw new TransferError(
      `GENERALIZE requires a STRICTLY broader context: a proper sub-map of the base context with fewer keys — base ` +
        `${JSON.stringify(baseContext)}, received ${JSON.stringify(newContext)}`,
    );
  }
  const content = buildDerivedContent(input, 'GENERALIZE');
  const artifact = createPackageArtifact({
    content,
    provenance: [...input.provenance],
    created_at: input.created_at,
    authority_ref: input.authority_ref ?? null,
  });
  const link = createTraceLink({
    source: artifact.envelope.id,
    target: input.base.envelope.id,
    type: 'GENERALIZES',
    provenance: [...input.provenance],
  });
  const lineage = lineageRecord('GENERALIZE', input, artifact.envelope.id, link);
  return { artifact, lineage };
}

function lineageRecord(
  operation: LineageOperation,
  input: LineageOperationInput,
  derivedId: string,
  link: TraceLink,
): LineageRecord {
  const content = {
    operation,
    base_id: input.base.envelope.id,
    derived_id: derivedId,
    link,
    evidence_refs: [...new Set(input.evidence_refs)].sort(compareStrings),
    provenance: [...input.provenance],
    created_at: input.created_at,
    note: input.note ?? null,
  };
  return { id: fullContentHash(content), ...content };
}

/** Full semantic validation of a stored lineage record (throws TransferError). */
export function assertValidLineageRecord(value: unknown): asserts value is LineageRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TransferError(`lineage record must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const hasNote = 'note' in record;
  if (Object.keys(record).length !== (hasNote ? 9 : 8) || !('id' in record)) {
    throw new TransferError(
      'lineage record must have the exact field set { id, operation, base_id, derived_id, link, evidence_refs, provenance, created_at, note }',
    );
  }
  if (typeof record['id'] !== 'string' || !/^[0-9a-f]{64}$/.test(record['id'])) {
    throw new TransferError(`lineage record id must be 64 lowercase hex chars, received: ${JSON.stringify(record['id'])}`);
  }
  if (!isLineageOperation(record['operation'])) {
    throw new TransferError(`lineage record operation must be one of ${LINEAGE_OPERATIONS.join(', ')}, received: ${JSON.stringify(record['operation'])}`);
  }
  if (!isArtifactId(record['base_id']) || !isArtifactId(record['derived_id'])) {
    throw new TransferError('lineage record base_id and derived_id must be well-formed spine artifact ids');
  }
  const link = record['link'];
  if (
    typeof link !== 'object' ||
    link === null ||
    (link as Record<string, unknown>)['source'] !== record['derived_id'] ||
    (link as Record<string, unknown>)['target'] !== record['base_id']
  ) {
    throw new TransferError('lineage record link must be the spine trace link derived -> base');
  }
  const linkType = (link as Record<string, unknown>)['type'];
  const expectedType = record['operation'] === 'SPECIALIZE' ? 'SPECIALIZES' : 'GENERALIZES';
  if (linkType !== expectedType) {
    throw new TransferError(
      `lineage record link type must be ${expectedType} for a ${record['operation']} operation, received: ${JSON.stringify(linkType)}`,
    );
  }
  if (!isNonEmptyStringArray(record['evidence_refs'])) {
    throw new TransferError('lineage record evidence_refs must be a NON-EMPTY array (which evidence)');
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new TransferError('lineage record provenance must be a NON-EMPTY array (who/what)');
  }
  if (typeof record['created_at'] !== 'string' || !RFC3339_PATTERN.test(record['created_at'])) {
    throw new TransferError(`lineage record created_at must be RFC3339, received: ${JSON.stringify(record['created_at'])}`);
  }
  const content = {
    operation: record['operation'],
    base_id: record['base_id'],
    derived_id: record['derived_id'],
    link: record['link'],
    evidence_refs: record['evidence_refs'],
    provenance: record['provenance'],
    created_at: record['created_at'],
    note: (hasNote ? record['note'] : null) as string | null,
  };
  if (fullContentHash(content) !== record['id']) {
    throw new TransferError(
      `lineage record id does not match its content (content-address discipline): ${JSON.stringify(record['id'])}`,
    );
  }
}

/** A serializable lineage store snapshot (round-trips through restore). */
export interface LineageStoreSnapshot {
  /** All lineage records, canonically sorted by id. */
  records: LineageRecord[];
}

/**
 * The lineage store: accumulates lineage records and answers lineage
 * queries. Deterministic: every query output is canonically ordered; the
 * snapshot is a pure function of the record SET.
 */
export class LineageStore {
  private readonly records = new Map<string, LineageRecord>();

  /** Add a lineage record (idempotent by id; conflicting content is rejected). */
  add(record: LineageRecord): LineageRecord {
    assertValidLineageRecord(record);
    const existing = this.records.get(record.id);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(record)) {
        throw new TransferError(`lineage store contains conflicting records with id ${record.id}`);
      }
      return structuredClone(existing);
    }
    const stored = structuredClone(record);
    this.records.set(stored.id, stored);
    return structuredClone(stored);
  }

  /** Records deriving `packageId` directly (sorted by (created_at, id)). */
  derivationsOf(packageId: string): LineageRecord[] {
    return [...this.records.values()]
      .filter((record) => record.derived_id === packageId)
      .sort((a, b) => compareStrings(`${a.created_at}\u0000${a.id}`, `${b.created_at}\u0000${b.id}`))
      .map((record) => structuredClone(record));
  }

  /** The transitive ancestry of `packageId` (all lineage records on the path to roots; canonical order). */
  ancestryOf(packageId: string): LineageRecord[] {
    const collected = new Map<string, LineageRecord>();
    const frontier = [packageId];
    const visited = new Set<string>();
    while (frontier.length > 0) {
      const current = frontier.shift()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const record of this.records.values()) {
        if (record.derived_id === current && !collected.has(record.id)) {
          collected.set(record.id, record);
          frontier.push(record.base_id);
        }
      }
    }
    return [...collected.values()]
      .sort((a, b) => compareStrings(`${a.created_at}\u0000${a.id}`, `${b.created_at}\u0000${b.id}`))
      .map((record) => structuredClone(record));
  }

  /** All lineage records (canonically sorted by id). */
  all(): LineageRecord[] {
    return [...this.records.values()]
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((record) => structuredClone(record));
  }

  get size(): number {
    return this.records.size;
  }

  /** A serializable snapshot (records canonically sorted by id). */
  snapshot(): LineageStoreSnapshot {
    return { records: this.all() };
  }

  /** Rebuild a store from a snapshot (validated; canonical round trip). */
  static restore(snapshot: LineageStoreSnapshot): LineageStore {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      throw new TransferError(`lineage snapshot must be an object { records }, received: ${JSON.stringify(snapshot)}`);
    }
    const record = snapshot as unknown as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || !('records' in record)) {
      throw new TransferError('lineage snapshot must have the exact field set { records }');
    }
    if (!Array.isArray(record['records'])) {
      throw new TransferError('lineage snapshot records must be an array');
    }
    const store = new LineageStore();
    for (const value of record['records']) {
      assertValidLineageRecord(value);
      store.add(value as LineageRecord);
    }
    return store;
  }
}
