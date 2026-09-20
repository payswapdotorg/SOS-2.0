/**
 * The package/composition registry (Work Order W6 goal: "versioned entries,
 * supersession chains", "retrieval by capability + context", "SUPERSEDED
 * packages never returned as current", diversity preservation, R24-R29).
 *
 * THE registry — there is no second one (spec/architecture-lock.md forbids
 * a second package authority; AGENTS.md §4). Entries are keyed by their
 * SPINE identities (content-addressed sos://Package/... and
 * sos://PackageComposition/... ids minted by @sos-2/semantic-spine);
 * evidence records are NEVER stored here (the W3 EvidenceGraph owns them —
 * retrieval resolves refs through a caller-supplied resolver, and
 * unresolvable refs are reported honestly as unresolved, never as zero).
 *
 * CHAIN DISCIPLINE (mirrors the W2 SystemStateStore): chains are LINEAR and
 * CONTIGUOUS by construction — every superseding artifact references a
 * registered head of the same kind, version = head.version + 1, no
 * branching, and the semantic_capability is invariant within a chain. The
 * FAILURE-MEMORY invariant is enforced across revisions: a superseding
 * revision's failure_refs must be a SUPERSET of the head's (negative
 * evidence and liabilities are retained — spec/architecture.md §5;
 * AGENTS.md §8).
 *
 * MATURITY DISCIPLINE (no silent autonomy): maturity changes happen ONLY
 * through `promote()` — the evidence-gated path (frozen gates; one-lucky-
 * success rejected). `put*` accepts roots (any maturity; validated-or-beyond
 * live roots must present resolvable evidence records that pass the
 * entering-transition gates) and SAME-MATURITY content revisions; a
 * maturity-changing put is rejected.
 *
 * COMPOSITIONS: registering a composition requires its members to be
 * REGISTERED packages with compatible bound contracts (reuse never bypasses
 * compatibility), mints the spine COMPOSES trace links, and — for
 * validated-or-beyond live compositions — enforces the OWN-EVIDENCE
 * discipline (evidence about the composition's chain, never member
 * evidence; independence is a locked invariant).
 *
 * RETRIEVAL: see retrieval.ts — altitude-ordered (§10), diversity-
 * preserving (§11), carrying uncertainty + evidence context + learned
 * limitations + failure contexts; superseded and retired entries are never
 * returned as current.
 */

import {
  canonicalSerialize,
  createTraceLink,
  isArtifactId,
  TraceLinkStore,
  withStatus,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, PackageMaturity, TraceLink, TraceLinkType } from '@sos-2/semantic-spine';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import {
  assertMaturityPromotion,
  evaluateMaturityPromotion,
  isTerminalMaturity,
  isValidatedMaturity,
} from '@sos-2/packages';
import type { ApplicabilityEstimate, PackageArtifact, PackageContent, PackageRealization } from '@sos-2/packages';
import {
  assertOwnEvidence,
  assertValidCompositionArtifact,
  createPackageComposition,
} from '@sos-2/composition';
import type { PackageCompositionArtifact, PackageCompositionContent } from '@sos-2/composition';
import { assertValidPackageArtifact, createPackageArtifact } from '@sos-2/packages';
import { altitudeOfEntry } from './altitude.js';
import type { RegistryEntryKind, RetrievalAltitude } from './altitude.js';
import { RegistryError } from './errors.js';
import {
  assertValidRetrievalQuery,
  buildCandidateUncertainty,
  buildEvidenceContext,
  buildFailureContexts,
  capabilityMatches,
  candidateAltitude,
  shapeDiverseCandidateSet,
} from './retrieval.js';
import type {
  EvidenceContext,
  EvidenceResolver,
  RetrievalCandidate,
  RetrievalQuery,
  RetrievalResult,
} from './retrieval.js';

/** A registered entry: a package or a composition artifact. */
export type RegistryEntry =
  | { kind: 'PACKAGE'; artifact: PackageArtifact }
  | { kind: 'COMPOSITION'; artifact: PackageCompositionArtifact };

/** The result of a promote operation. */
export interface PromoteResult {
  /** The previous head, now envelope-SUPERSEDED. */
  previous: RegistryEntry;
  /** The new ACTIVE head (version = previous.version + 1, supersedes = previous id). */
  promoted: RegistryEntry;
}

/** Input to the evidence-gated promote operation. */
export interface PromoteInput {
  /** The id of the chain HEAD to promote (must be the current head, envelope ACTIVE). */
  id: string;
  /** Target maturity (strict transition from the head's maturity). */
  target: PackageMaturity;
  /**
   * Resolved evidence records backing the promotion (gates evaluate the NEW
   * evidence set; every cited ref must resolve). For compositions targeting
   * validated-or-beyond live maturity this is REQUIRED and the records must
   * be the composition's OWN evidence.
   */
  evidence?: EvidenceRecordW3[];
  /** The COMPLETE new evidence set (default: carry the head's forward). */
  evidence_refs?: string[];
  /** Failure refs to ADD (failure memory is monotonic — never dropped). */
  additional_failure_refs?: string[];
  /** Complete replacement learned limitations (limitations may reset per realization). */
  learned_limitations?: string[];
  /** Applicability estimates to ADD to the head's. */
  additional_applicability?: ApplicabilityEstimate[];
  /** Realizations to ADD to the head's (packages only). */
  additional_realizations?: PackageRealization[];
  /** REQUIRED when target is SUPERSEDED: the replacement artifact id. */
  superseded_by?: string;
  /** Version note for the new revision (non-empty). */
  changes: string;
  /** Provenance for the new revision. */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied. */
  created_at: string;
  /** Authorizing artifact id; defaults to the head's. */
  authority_ref?: string | null;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

/** The entering transition whose gates a validated-or-beyond live root must pass. */
function enteringTransitionFor(maturity: PackageMaturity): { from: PackageMaturity; to: PackageMaturity } | null {
  switch (maturity) {
    case 'VALIDATED':
      return { from: 'FORMING', to: 'VALIDATED' };
    case 'MATURE':
      return { from: 'VALIDATED', to: 'MATURE' };
    case 'CONTEXTUALIZED':
      return { from: 'MATURE', to: 'CONTEXTUALIZED' };
    default:
      return null;
  }
}

/**
 * The package/composition registry. In-memory, deterministic (every listing
 * is ordered), spine-identity-keyed.
 */
export class PackageRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  /** superseded id -> superseding id (linear chains: at most one superseder). */
  private readonly supersededBy = new Map<string, string>();
  /** The spine's typed trace link store (COMPOSES links for compositions). */
  private readonly links = new TraceLinkStore();

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a package artifact.
   *
   * - ROOT (supersedes = null): any maturity; validated-or-beyond live
   *   maturity REQUIRES `evidence` records that pass the entering-transition
   *   gates (a root never bypasses the evidence gates).
   * - REVISION (supersedes = head id): same maturity only (maturity changes
   *   go through promote); the head must be envelope-ACTIVE, the chain stays
   *   linear/contiguous, the capability is invariant and failure refs grow
   *   monotonically. The head's envelope is transitioned to SUPERSEDED
   *   (identity preserved).
   * - Idempotent for identical content; a different-content artifact under
   *   the same id is a collision and throws.
   */
  putPackage(artifact: PackageArtifact, evidence?: EvidenceRecordW3[]): RegistryEntry {
    assertValidPackageArtifact(artifact);
    const entry: RegistryEntry = { kind: 'PACKAGE', artifact };
    this.putEntry(entry, evidence);
    return this.cloneEntry(entry);
  }

  /**
   * Register a composition artifact.
   *
   * In addition to the package rules: members must be REGISTERED packages
   * whose declared contracts cover each member's bound contracts, COMPOSES
   * trace links are minted for every member, and validated-or-beyond live
   * maturity REQUIRES `evidence` records satisfying the OWN-EVIDENCE
   * discipline (evidence about this composition — member evidence never
   * substitutes).
   */
  putComposition(artifact: PackageCompositionArtifact, evidence?: EvidenceRecordW3[]): RegistryEntry {
    assertValidCompositionArtifact(artifact);
    // Members must be registered packages with compatible contracts.
    for (const member of artifact.content.members) {
      const memberEntry = this.entries.get(member.package_id);
      if (memberEntry === undefined) {
        throw new RegistryError(
          `composition member is not registered: ${member.package_id} (members must be registered packages — ` +
            'reuse never bypasses compatibility)',
        );
      }
      if (memberEntry.kind !== 'PACKAGE') {
        throw new RegistryError(
          `composition member must be a Package artifact, received kind ${memberEntry.kind} for ${member.package_id}`,
        );
      }
      const declared = new Set(memberEntry.artifact.content.contracts);
      for (const bound of member.bound_contracts) {
        if (!declared.has(bound)) {
          throw new RegistryError(
            `composition binds contract ${JSON.stringify(bound)} on member ${member.package_id}, which the member ` +
              'does not declare (reuse never bypasses compatibility)',
          );
        }
      }
    }
    const entry: RegistryEntry = { kind: 'COMPOSITION', artifact };
    this.putEntry(entry, evidence);
    // Mint the spine COMPOSES links (composition -> member).
    for (const member of artifact.content.members) {
      if (!this.links.has(artifact.envelope.id, member.package_id, 'COMPOSES')) {
        this.links.add(
          createTraceLink({
            source: artifact.envelope.id,
            target: member.package_id,
            type: 'COMPOSES',
            provenance: [...artifact.envelope.provenance],
          }),
        );
      }
    }
    return this.cloneEntry(entry);
  }

  /** Shared put discipline (see putPackage/putComposition docs). */
  private putEntry(entry: RegistryEntry, evidence?: EvidenceRecordW3[], options?: { viaPromote?: boolean }): void {
    const artifact = entry.artifact;
    const id = artifact.envelope.id;
    const existing = this.entries.get(id);
    if (existing !== undefined) {
      if (canonicalSerialize(existing.artifact) === canonicalSerialize(artifact)) {
        return; // idempotent re-put of identical content
      }
      throw new RegistryError(
        `registry collision for id ${id}: different content under the same spine id`,
      );
    }
    const supersedes = artifact.envelope.supersedes;
    if (supersedes !== null) {
      const target = this.requireRegistered(supersedes);
      if (target.kind !== entry.kind) {
        throw new RegistryError(
          `cannot supersede a ${target.kind} entry with a ${entry.kind} artifact (chains are kind-homogeneous)`,
        );
      }
      if (this.supersededBy.has(supersedes)) {
        throw new RegistryError(
          `branching chain rejected: ${supersedes} is already superseded by ${this.supersededBy.get(supersedes)}`,
        );
      }
      if (target.artifact.envelope.status !== 'ACTIVE') {
        throw new RegistryError(
          `only an ACTIVE head can be superseded (activate ${supersedes} first); received status ${target.artifact.envelope.status}`,
        );
      }
      if (artifact.envelope.version !== target.artifact.envelope.version + 1) {
        throw new RegistryError(
          `non-contiguous revision: version ${artifact.envelope.version} must be exactly ` +
            `${target.artifact.envelope.version + 1} (full history must stay walkable without gaps)`,
        );
      }
      if (options?.viaPromote !== true && artifact.content.maturity !== target.artifact.content.maturity) {
        throw new RegistryError(
          `maturity-changing revision rejected: ${target.artifact.content.maturity} -> ${artifact.content.maturity} ` +
            'on direct put — maturity changes go through promote() (the evidence-gated path; no silent autonomy)',
        );
      }
      if (artifact.content.semantic_capability !== target.artifact.content.semantic_capability) {
        throw new RegistryError(
          'semantic_capability is invariant within a chain (a different capability is a different package): ' +
            `${JSON.stringify(target.artifact.content.semantic_capability)} -> ${JSON.stringify(artifact.content.semantic_capability)}`,
        );
      }
      const oldFailures = new Set(target.artifact.content.failure_refs);
      for (const ref of artifact.content.failure_refs) {
        oldFailures.delete(ref);
      }
      if (oldFailures.size > 0) {
        throw new RegistryError(
          `failure-memory violation: the superseding revision drops failure refs ${[...oldFailures]
            .map((ref) => JSON.stringify(ref))
            .join(', ')} (negative evidence and liabilities are retained, never dropped)`,
        );
      }
      this.supersededBy.set(supersedes, id);
      // Atomic envelope transition of the superseded head (identity preserved).
      const transitioned = withStatus(target.artifact.envelope, 'SUPERSEDED');
      if (target.kind === 'PACKAGE') {
        this.entries.set(supersedes, {
          kind: 'PACKAGE',
          artifact: { envelope: transitioned, content: target.artifact.content },
        });
      } else {
        this.entries.set(supersedes, {
          kind: 'COMPOSITION',
          artifact: { envelope: transitioned, content: target.artifact.content },
        });
      }
    }
    this.validateRootGates(entry, evidence);
    this.entries.set(id, entry);
  }

  /**
   * Validated-or-beyond live roots must present resolvable evidence records
   * that pass the entering-transition gates (and, for compositions, the
   * own-evidence discipline). Roots below validation are accepted without
   * records (the W0.5 golden-package path).
   */
  private validateRootGates(entry: RegistryEntry, evidence: EvidenceRecordW3[] | undefined): void {
    const maturity = entry.artifact.content.maturity;
    if (entry.artifact.envelope.supersedes !== null || !isValidatedMaturity(maturity)) {
      return;
    }
    const entering = enteringTransitionFor(maturity);
    if (entering === null) {
      return;
    }
    if (evidence === undefined) {
      throw new RegistryError(
        `a ${maturity} root entry must present its evidence records for gate validation ` +
          '(promotion without evidence is rejected)',
      );
    }
    if (entry.kind === 'COMPOSITION') {
      assertOwnEvidence(
        entry.artifact.content.evidence_refs,
        evidence,
        entry.artifact.envelope.id,
        [],
      );
    }
    const verdict = evaluateMaturityPromotion({
      from: entering.from,
      to: entering.to,
      evidence_refs: entry.artifact.content.evidence_refs,
      evidence,
      hasRealizations:
        entry.kind === 'PACKAGE' ? entry.artifact.content.realizations.length > 0 : true,
      hasCalibratedApplicability: entry.artifact.content.applicability.some(
        (estimate) => estimate.kind === 'CALIBRATED',
      ),
      superseded_by: entry.artifact.content.superseded_by,
    });
    if (!verdict.allowed) {
      throw new RegistryError(
        `a ${maturity} root entry failed the entering-transition gates: ${verdict.reasons.join('; ')}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Maturity promotion (the ONLY maturity-changing path)
  // -------------------------------------------------------------------------

  /**
   * Promote a chain head to a target maturity through the frozen
   * evidence-gated path. Creates the next revision (version + 1, ACTIVE,
   * supersedes = head id) and transitions the old head's envelope to
   * SUPERSEDED. For compositions targeting a validated-or-beyond live
   * maturity, `evidence` is REQUIRED and must be the composition's OWN
   * evidence (member evidence never substitutes).
   */
  promote(input: PromoteInput): PromoteResult {
    if (typeof input !== 'object' || input === null) {
      throw new RegistryError('promote input must be an object');
    }
    const entry = this.requireRegistered(input.id);
    if (this.supersededBy.has(input.id)) {
      throw new RegistryError(
        `cannot promote a superseded entry: ${input.id} (promote the current head ${this.supersededBy.get(input.id)})`,
      );
    }
    if (entry.artifact.envelope.status !== 'ACTIVE') {
      throw new RegistryError(
        `only an ACTIVE head can be promoted (activate ${input.id} first); received status ${entry.artifact.envelope.status}`,
      );
    }
    if (!isNonEmptyStringArray(input.provenance)) {
      throw new RegistryError('promote provenance must be a non-empty array of non-empty strings');
    }
    if (typeof input.changes !== 'string' || input.changes.length === 0) {
      throw new RegistryError('promote changes must be a non-empty version note');
    }
    const from = entry.artifact.content.maturity;
    const to = input.target;

    // Build the new content (kind-specific).
    const newEvidenceRefs = input.evidence_refs ?? entry.artifact.content.evidence_refs;
    const newFailureRefs = [
      ...new Set([...entry.artifact.content.failure_refs, ...(input.additional_failure_refs ?? [])]),
    ];
    const newLimitations = input.learned_limitations ?? entry.artifact.content.learned_limitations;
    const newApplicability = [
      ...entry.artifact.content.applicability,
      ...(input.additional_applicability ?? []),
    ];
    const supersededBy = input.superseded_by ?? null;

    let newEntry: RegistryEntry;
    if (entry.kind === 'PACKAGE') {
      const content: PackageContent = {
        ...entry.artifact.content,
        realizations: [...entry.artifact.content.realizations, ...(input.additional_realizations ?? [])],
        applicability: newApplicability,
        evidence_refs: newEvidenceRefs,
        failure_refs: newFailureRefs,
        learned_limitations: newLimitations,
        maturity: to,
        superseded_by: supersededBy,
        changes: input.changes,
      };
      const artifact = createPackageArtifact({
        content,
        provenance: input.provenance,
        created_at: input.created_at,
        authority_ref: input.authority_ref ?? entry.artifact.envelope.authority_ref,
        version: entry.artifact.envelope.version + 1,
        status: 'ACTIVE',
        supersedes: input.id,
      });
      newEntry = { kind: 'PACKAGE', artifact };
    } else {
      const content: PackageCompositionContent = {
        ...entry.artifact.content,
        applicability: newApplicability,
        evidence_refs: newEvidenceRefs,
        failure_refs: newFailureRefs,
        learned_limitations: newLimitations,
        maturity: to,
        superseded_by: supersededBy,
        changes: input.changes,
      };
      const artifact = createPackageComposition({
        content,
        provenance: input.provenance,
        created_at: input.created_at,
        authority_ref: input.authority_ref ?? entry.artifact.envelope.authority_ref,
        version: entry.artifact.envelope.version + 1,
        status: 'ACTIVE',
        supersedes: input.id,
      });
      newEntry = { kind: 'COMPOSITION', artifact };
    }

    const records = input.evidence ?? [];
    // Compositions promoted to a validated-or-beyond live maturity present OWN evidence.
    if (entry.kind === 'COMPOSITION' && isValidatedMaturity(to)) {
      if (input.evidence === undefined) {
        throw new RegistryError(
          'promoting a composition to a validated-or-beyond maturity requires its OWN evidence records ' +
            '(member evidence never substitutes — independence is a locked invariant)',
        );
      }
      const chainIds = this.chainAncestors(input.id);
      assertOwnEvidence(newEvidenceRefs, records, newEntry.artifact.envelope.id, chainIds);
    }

    // The frozen promotion gates (one lucky success rejected, etc.).
    assertMaturityPromotion({
      from,
      to,
      evidence_refs: newEvidenceRefs,
      evidence: records,
      hasRealizations:
        entry.kind === 'PACKAGE' ? (newEntry.artifact as PackageArtifact).content.realizations.length > 0 : true,
      hasCalibratedApplicability: newApplicability.some((estimate) => estimate.kind === 'CALIBRATED'),
      superseded_by: supersededBy,
    });

    // Register the new revision (chain discipline enforced in putEntry; the
    // maturity change itself was just validated by the gates above).
    this.putEntry(newEntry, records.length > 0 ? records : undefined, { viaPromote: true });
    return {
      previous: this.cloneEntry(this.requireRegistered(input.id)),
      promoted: this.cloneEntry(this.requireRegistered(newEntry.artifact.envelope.id)),
    };
  }

  /** Activate a DRAFT head (spine-validated DRAFT -> ACTIVE envelope transition). */
  activate(id: string): RegistryEntry {
    const entry = this.requireRegistered(id);
    if (this.supersededBy.has(id)) {
      throw new RegistryError(`cannot activate a superseded entry: ${id}`);
    }
    const transitioned = withStatus(entry.artifact.envelope, 'ACTIVE');
    const updated: RegistryEntry =
      entry.kind === 'PACKAGE'
        ? { kind: 'PACKAGE', artifact: { envelope: transitioned, content: entry.artifact.content } }
        : { kind: 'COMPOSITION', artifact: { envelope: transitioned, content: entry.artifact.content } };
    this.entries.set(id, updated);
    return this.cloneEntry(updated);
  }

  /** Retire a head (administrative promote to RETIRED). */
  retire(input: Omit<PromoteInput, 'target'>): PromoteResult {
    return this.promote({ ...input, target: 'RETIRED' });
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  get(id: string): RegistryEntry | undefined {
    const entry = this.entries.get(id);
    return entry === undefined ? undefined : this.cloneEntry(entry);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** The current head of the chain containing `id` (never a superseded revision). */
  current(id: string): RegistryEntry | undefined {
    let cursor = id;
    for (;;) {
      const next = this.supersededBy.get(cursor);
      if (next === undefined) {
        return this.get(cursor);
      }
      cursor = next;
    }
  }

  /** The replacement id declared by a SUPERSEDED-maturity head, if any. */
  replacementOf(id: string): string | null {
    const head = this.current(id);
    return head === undefined ? null : head.artifact.content.superseded_by;
  }

  /** Full chain containing `id`, ordered root -> newest (deterministic). */
  history(id: string): RegistryEntry[] {
    const registered = this.requireRegistered(id);
    // Walk up to the root via envelope.supersedes.
    const root = this.chainRoot(registered.artifact.envelope);
    // Walk down via supersededBy.
    const chain: RegistryEntry[] = [];
    let cursor: string | null = root;
    while (cursor !== null) {
      const entry = this.requireRegistered(cursor);
      chain.push(this.cloneEntry(entry));
      cursor = this.supersededBy.get(cursor) ?? null;
    }
    return chain;
  }

  private chainRoot(envelope: ArtifactEnvelope): string {
    let current = envelope;
    while (current.supersedes !== null) {
      const parent = this.requireRegistered(current.supersedes);
      current = parent.artifact.envelope;
    }
    return current.id;
  }

  private chainAncestors(id: string): string[] {
    const registered = this.requireRegistered(id);
    const ancestors: string[] = [];
    let current = registered.artifact.envelope;
    while (current.supersedes !== null) {
      ancestors.push(current.supersedes);
      const parent = this.requireRegistered(current.supersedes);
      current = parent.artifact.envelope;
    }
    return ancestors;
  }

  private requireRegistered(id: string): RegistryEntry {
    if (typeof id !== 'string' || !isArtifactId(id)) {
      throw new RegistryError(`id must be a well-formed spine artifact id, received: ${JSON.stringify(id)}`);
    }
    const entry = this.entries.get(id);
    if (entry === undefined) {
      throw new RegistryError(`unknown registry entry: ${id}`);
    }
    return entry;
  }

  /** All entries sorted by id (deterministic). */
  list(): RegistryEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => (a.artifact.envelope.id < b.artifact.envelope.id ? -1 : 1))
      .map((entry) => this.cloneEntry(entry));
  }

  /** Current heads (envelope ACTIVE, non-terminal maturity), sorted by id. */
  listCurrent(): RegistryEntry[] {
    return this.list().filter((entry) => {
      const isHead = !this.supersededBy.has(entry.artifact.envelope.id);
      return isHead && entry.artifact.envelope.status === 'ACTIVE' && !isTerminalMaturity(entry.artifact.content.maturity);
    });
  }

  /**
   * Retrieval by capability (+ optional contracts and context). See
   * retrieval.ts: altitude-ordered, diversity-preserving, honest uncertainty.
   */
  retrieve(query: RetrievalQuery): RetrievalResult {
    assertValidRetrievalQuery(query);
    const heads = this.listCurrent();
    const matching = heads.filter((entry) => {
      if (!capabilityMatches(entry.artifact.content.semantic_capability, query.capability)) {
        return false;
      }
      if (query.contracts !== undefined && query.contracts.length > 0) {
        const declared = new Set(entry.artifact.content.contracts);
        return query.contracts.every((contract) => declared.has(contract));
      }
      return true;
    });
    const candidates = matching.map((entry) => this.buildCandidate(entry, query));
    const { candidates: shaped, families, family_counts } = shapeDiverseCandidateSet(
      candidates,
      query.maxPerFamily ?? 3,
      query.maxResults,
    );
    const altitudesPresent = [...new Set(shaped.map((candidate) => candidate.altitude))].sort(
      (a, b) => altitudeRank(a) - altitudeRank(b),
    );
    return {
      query,
      candidates: shaped,
      families,
      family_counts: family_counts,
      altitudes_present: altitudesPresent,
      matched_count: matching.length,
      total_current_entries: heads.length,
    };
  }

  private buildCandidate(entry: RegistryEntry, query: RetrievalQuery): RetrievalCandidate {
    const artifact = entry.artifact;
    const kind: RegistryEntryKind = entry.kind;
    const maturity = artifact.content.maturity;
    const altitude: RetrievalAltitude = candidateAltitude(kind, maturity);
    const { uncertainty, best, match } = buildCandidateUncertainty(artifact.content.applicability, query.context);
    const resolver = query.evidenceResolver;
    const resolvedRecords: EvidenceRecordW3[] = [];
    if (resolver !== undefined) {
      for (const ref of artifact.content.evidence_refs) {
        const record = resolver(ref);
        if (record !== undefined) {
          resolvedRecords.push(record);
        }
      }
    }
    const evidence_context: EvidenceContext = buildEvidenceContext(artifact.content.evidence_refs, resolver, resolvedRecords);
    return {
      kind,
      id: artifact.envelope.id,
      version: artifact.envelope.version,
      semantic_capability: artifact.content.semantic_capability,
      contracts: [...artifact.content.contracts],
      maturity,
      altitude,
      family: artifact.content.diversity_profile.family,
      dimensions: artifact.content.diversity_profile.dimensions.map((stance) => ({ ...stance })),
      applicability: artifact.content.applicability.map((estimate) => structuredClone(estimate)),
      best_estimate: best === null ? null : structuredClone(best),
      uncertainty,
      evidence_context,
      learned_limitations: [...artifact.content.learned_limitations],
      failure_contexts: buildFailureContexts(artifact.content.failure_refs, resolver),
      assurance_obligations: artifact.content.assurance_obligations.map((obligation) => ({ ...obligation })),
      realizations: kind === 'PACKAGE' ? (artifact as PackageArtifact).content.realizations.map((r) => ({ ...r })) : [],
      members: kind === 'COMPOSITION' ? (artifact as PackageCompositionArtifact).content.members.map((m) => ({ ...m })) : null,
      bindings: kind === 'COMPOSITION' ? (artifact as PackageCompositionArtifact).content.bindings.map((b) => structuredClone(b)) : null,
      independence:
        kind === 'COMPOSITION'
          ? (artifact as PackageCompositionArtifact).content.independence.map((a) => structuredClone(a))
          : null,
      context_match: match,
    };
  }

  // -------------------------------------------------------------------------
  // Trace links (COMPOSES)
  // -------------------------------------------------------------------------

  /** Compositions that include the given package (through COMPOSES links), sorted by id. */
  compositionsFor(packageId: string): RegistryEntry[] {
    return this.links
      .to(packageId)
      .filter((link) => link.type === 'COMPOSES')
      .map((link) => this.requireRegistered(link.source))
      .filter((entry) => entry.kind === 'COMPOSITION')
      .sort((a, b) => (a.artifact.envelope.id < b.artifact.envelope.id ? -1 : 1))
      .map((entry) => this.cloneEntry(entry));
  }

  linksFrom(source: string): TraceLink[] {
    return this.links.from(source);
  }

  linksTo(target: string): TraceLink[] {
    return this.links.to(target);
  }

  allLinks(): TraceLink[] {
    return this.links.all();
  }

  get size(): number {
    return this.entries.size;
  }

  get linkCount(): number {
    return this.links.size;
  }

  private cloneEntry(entry: RegistryEntry): RegistryEntry {
    if (entry.kind === 'PACKAGE') {
      return { kind: 'PACKAGE', artifact: structuredClone(entry.artifact) };
    }
    return { kind: 'COMPOSITION', artifact: structuredClone(entry.artifact) };
  }
}

function altitudeRank(altitude: RetrievalAltitude): number {
  const ranks: Record<RetrievalAltitude, number> = {
    VALIDATED_COMPOSITION: 0,
    VALIDATED_PACKAGE: 1,
    PACKAGE_ADAPTATION: 2,
    ARCHITECTURE_PATTERN: 3,
    NOVEL_ARCHITECTURE: 4,
    LOW_LEVEL_SYNTHESIS: 5,
  };
  return ranks[altitude];
}

/** Re-exported for downstream convenience (the typed §10 ladder helpers). */
export { altitudeOfEntry };
