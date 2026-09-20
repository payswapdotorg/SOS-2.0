/**
 * Package content — the W6 realization of the Package model from
 * spec/architecture.md §5:
 *
 *   "Package: validated reusable capability/subgraph plus contracts,
 *    applicability, evidence, failures, assurance obligations and learned
 *    limitations."
 *
 * The normative PackageRecord contract (spec/contracts/package.schema.json,
 * additionalProperties: FALSE) is the SCHEMA-CONFORMANT PROJECTION of this
 * content — see artifact.ts `toPackageRecord`, which emits exactly the
 * closed 8-key record and is ajv-validated against sos://schema/package in
 * tests. The content carries the full §5 field set:
 *
 *   semantic_capability, contracts, preconditions, postconditions,
 *   realizations, applicability, evidence_refs, failure_refs,
 *   compatibility_refs, composition_refs, assurance_obligations, context,
 *   learned_limitations, diversity_profile, maturity, changes,
 *   superseded_by
 *
 * Documented strengthenings over the JSON Schema (same policy as the
 * contracts layer: never accept what a legitimate SOS artifact cannot
 * carry, and never accept what the architecture forbids):
 *   - evidence_refs is NON-EMPTY (spec/architecture.md §18: "Packages
 *     require evidence"; the schema's empty-array-permitted shape is a
 *     schema minimum, not an SOS discipline);
 *   - applicability is NON-EMPTY and context-conditioned
 *     (ARCHITECT_START_HERE rejects "packages without applicability";
 *     §12 forbids universal scores);
 *   - assurance_obligations is NON-EMPTY (reuse never bypasses assurance);
 *   - diversity_profile is REQUIRED (§11; the registry preserves declared
 *     families);
 *   - every ref field entry must be a WELL-FORMED spine artifact id of the
 *     right kind (Evidence refs -> sos://Evidence/..., realization refs ->
 *     any well-formed spine id);
 *   - maturity SUPERSEDED requires superseded_by.
 */

import { isArtifactId, isPackageMaturity, parseArtifactId, PACKAGE_MATURITIES } from '@sos-2/semantic-spine';
import type { PackageMaturity } from '@sos-2/semantic-spine';
import { assertValidApplicabilitySet } from './applicability.js';
import type { ApplicabilityEstimate } from './applicability.js';
import { assertValidAssuranceObligations } from './assurance.js';
import type { AssuranceObligation } from './assurance.js';
import { assertValidContextCondition } from './context.js';
import type { ContextCondition } from './context.js';
import { assertValidDiversityProfile } from './diversity.js';
import type { DiversityProfile } from './diversity.js';
import { PackageError } from './errors.js';

/** The (core, frozen) artifact kind segment used for package ids. */
export const PACKAGE_ARTIFACT_KIND = 'Package';

/** A concrete realization of the package's capability/subgraph. */
export interface PackageRealization {
  /**
   * Well-formed spine artifact id of the realizing artifact (typically an
   * ImplementationModel or ArchitectureGraph node set).
   */
  ref: string;
  /** Exact revision of the realization, or null when genuinely unversioned. */
  revision: string | null;
  /** What the realization is (non-empty note). */
  note: string;
}

/** The full W6 package content (see module doc). */
export interface PackageContent {
  /** Human-readable statement of the reusable semantic capability. */
  semantic_capability: string;
  /** Contract ids the package realizes (>= 1). */
  contracts: string[];
  /** Preconditions of reuse (statements). */
  preconditions: string[];
  /** Postconditions of successful reuse (statements). */
  postconditions: string[];
  /** Realizations (>= 1 required for maturity VALIDATED and beyond). */
  realizations: PackageRealization[];
  /** Context-conditioned applicability estimates (>= 1; never universal). */
  applicability: ApplicabilityEstimate[];
  /** Evidence refs (>= 1 — packages require evidence). */
  evidence_refs: string[];
  /** Failure evidence refs (retained forever; monotonic across revisions). */
  failure_refs: string[];
  /** Compatibility evidence refs. */
  compatibility_refs: string[];
  /** Compositions this package participates in (declared). */
  composition_refs: string[];
  /** Assurance obligations (>= 1 — reuse never bypasses assurance). */
  assurance_obligations: AssuranceObligation[];
  /** The package's declaring context (non-empty condition). */
  context: ContextCondition;
  /** Learned limitations of THIS realization (may be empty; may reset per revision). */
  learned_limitations: string[];
  /** Declared diversity profile (family + dimension stances). */
  diversity_profile: DiversityProfile;
  /** Package maturity (frozen vocabulary, imported from @sos-2/contracts). */
  maturity: PackageMaturity;
  /** Version note: what changed in THIS revision (non-empty). */
  changes: string;
  /** Replacement package id, REQUIRED when maturity is SUPERSEDED, else null. */
  superseded_by: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function requireNonEmptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new PackageError(`${field} must be an array of non-empty strings`);
  }
  return [...value];
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new PackageError(`${field} must be an array of non-empty strings`);
  }
  return [...value];
}

function assertRefKind(value: unknown, field: string, kind: string): asserts value is string {
  if (!isArtifactId(value)) {
    throw new PackageError(`${field} entries must be well-formed spine artifact ids, received: ${JSON.stringify(value)}`);
  }
  const parsed = parseArtifactId(value);
  if (parsed.kind !== kind) {
    throw new PackageError(
      `${field} entries must be ${kind} artifact ids (sos://${kind}/...), received: ${JSON.stringify(value)}`,
    );
  }
}

function assertRealizations(value: unknown): asserts value is PackageRealization[] {
  if (!Array.isArray(value)) {
    throw new PackageError('realizations must be an array of { ref, revision, note }');
  }
  for (const realization of value) {
    if (typeof realization !== 'object' || realization === null || Array.isArray(realization)) {
      throw new PackageError(`realization must be an object { ref, revision, note }, received: ${JSON.stringify(realization)}`);
    }
    const record = realization as Record<string, unknown>;
    if (Object.keys(record).length !== 3 || !('ref' in record) || !('revision' in record) || !('note' in record)) {
      throw new PackageError('realization must have the exact field set { ref, revision, note }');
    }
    if (!isArtifactId(record['ref'])) {
      throw new PackageError(
        `realization ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['ref'])}`,
      );
    }
    const revision = record['revision'];
    if (revision !== null && !isNonEmptyString(revision)) {
      throw new PackageError(`realization revision must be null or a non-empty string, received: ${JSON.stringify(revision)}`);
    }
    if (!isNonEmptyString(record['note'])) {
      throw new PackageError(`realization note must be a non-empty string, received: ${JSON.stringify(record['note'])}`);
    }
  }
}

/** Validate a package content (throws PackageError with a specific message). */
export function assertValidPackageContent(value: unknown): asserts value is PackageContent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PackageError('package content must be an object');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys: ReadonlySet<string> = new Set([
    'semantic_capability',
    'contracts',
    'preconditions',
    'postconditions',
    'realizations',
    'applicability',
    'evidence_refs',
    'failure_refs',
    'compatibility_refs',
    'composition_refs',
    'assurance_obligations',
    'context',
    'learned_limitations',
    'diversity_profile',
    'maturity',
    'changes',
    'superseded_by',
  ]);
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== expectedKeys.size || !actualKeys.every((key) => expectedKeys.has(key))) {
    throw new PackageError(
      `package content must have the exact 17-field §5 field set (semantic_capability, contracts, preconditions, ` +
        `postconditions, realizations, applicability, evidence_refs, failure_refs, compatibility_refs, ` +
        `composition_refs, assurance_obligations, context, learned_limitations, diversity_profile, maturity, ` +
        `changes, superseded_by); received keys: ${actualKeys.join(', ')}`,
    );
  }
  if (!isNonEmptyString(record['semantic_capability'])) {
    throw new PackageError(`semantic_capability must be a non-empty string, received: ${JSON.stringify(record['semantic_capability'])}`);
  }
  const contracts = record['contracts'];
  if (!Array.isArray(contracts) || contracts.length === 0 || !contracts.every(isNonEmptyString)) {
    throw new PackageError('contracts must be a non-empty array of non-empty strings (a package realizes contracts)');
  }
  requireNonEmptyStringArray(record['preconditions'], 'preconditions');
  requireNonEmptyStringArray(record['postconditions'], 'postconditions');
  assertRealizations(record['realizations']);
  if (!Array.isArray(record['applicability'])) {
    throw new PackageError('applicability must be an array of context-conditioned estimates');
  }
  assertValidApplicabilitySet(record['applicability']);

  const evidenceRefs = record['evidence_refs'];
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new PackageError(
      'evidence_refs must be a NON-EMPTY array — packages require evidence (spec/architecture.md §18)',
    );
  }
  for (const ref of evidenceRefs) {
    assertRefKind(ref, 'evidence_refs', 'Evidence');
  }
  for (const ref of requireNonEmptyStringArray(record['failure_refs'], 'failure_refs')) {
    assertRefKind(ref, 'failure_refs', 'Evidence');
  }
  for (const ref of optionalStringArray(record['compatibility_refs'], 'compatibility_refs')) {
    assertRefKind(ref, 'compatibility_refs', 'Evidence');
  }
  for (const ref of optionalStringArray(record['composition_refs'], 'composition_refs')) {
    assertRefKind(ref, 'composition_refs', 'PackageComposition');
  }
  assertValidAssuranceObligations(record['assurance_obligations']);
  assertValidContextCondition(record['context'], 'package context');
  requireNonEmptyStringArray(record['learned_limitations'], 'learned_limitations');
  assertValidDiversityProfile(record['diversity_profile']);

  const maturity = record['maturity'];
  if (!isPackageMaturity(maturity)) {
    throw new PackageError(
      `maturity must be one of the frozen 7 (imported from @sos-2/contracts): ${PACKAGE_MATURITIES.join(', ')}, received: ${JSON.stringify(maturity)}`,
    );
  }
  if (!isNonEmptyString(record['changes'])) {
    throw new PackageError(`changes must be a non-empty version note, received: ${JSON.stringify(record['changes'])}`);
  }
  const supersededBy = record['superseded_by'];
  if (supersededBy !== null && !isArtifactId(supersededBy)) {
    throw new PackageError(
      `superseded_by must be null or a well-formed spine artifact id, received: ${JSON.stringify(supersededBy)}`,
    );
  }
  if (maturity === 'SUPERSEDED' && supersededBy === null) {
    throw new PackageError('a SUPERSEDED package must declare its replacement (superseded_by)');
  }
  if (maturity !== 'SUPERSEDED' && supersededBy !== null) {
    throw new PackageError('superseded_by must be null unless maturity is SUPERSEDED');
  }

  // Validated-or-beyond packages are realized capabilities.
  if (
    (maturity === 'VALIDATED' || maturity === 'MATURE' || maturity === 'CONTEXTUALIZED') &&
    (record['realizations'] as PackageRealization[]).length === 0
  ) {
    throw new PackageError(
      `a ${maturity} package must declare at least one realization — validated capabilities are realized`,
    );
  }
}

/** Predicate form of assertValidPackageContent. */
export function isValidPackageContent(value: unknown): value is PackageContent {
  try {
    assertValidPackageContent(value);
    return true;
  } catch {
    return false;
  }
}
