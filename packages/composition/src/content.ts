/**
 * PackageComposition content — the W6 realization of the Package Composition
 * model (spec/architecture.md §5: "Package Composition: first-class
 * reusable composition with independent evidence"; R25).
 *
 * First-class means: a spine envelope (frozen core kind
 * "PackageComposition"), versioned, with its OWN contracts, applicability,
 * evidence, failures, assurance obligations, learned limitations, diversity
 * profile and maturity — everything a package carries, PLUS the member and
 * binding wiring model and the independence assessments.
 *
 * OWN-EVIDENCE RULE (the locked invariant, machine-checked in
 * own-evidence.ts): a composition's evidence_refs point at evidence about
 * THE COMPOSITION ITSELF (its chain of spine ids) — never at evidence about
 * its members. Member success does not imply composition success; member
 * evidence NEVER substitutes for composition evidence.
 */

import { isArtifactId, isPackageMaturity, PACKAGE_MATURITIES, parseArtifactId } from '@sos-2/semantic-spine';
import type { PackageMaturity } from '@sos-2/semantic-spine';
import {
  assertValidApplicabilitySet,
  assertValidAssuranceObligations,
  assertValidContextCondition,
  assertValidDiversityProfile,
} from '@sos-2/packages';
import type { ApplicabilityEstimate, AssuranceObligation, ContextCondition, DiversityProfile } from '@sos-2/packages';
import { assertValidCompositionBindings, assertValidCompositionMembers } from './binding.js';
import type { CompositionBinding, CompositionMember } from './binding.js';
import { CompositionError } from './errors.js';
import { assertValidIndependenceAssessment } from './independence.js';
import type { JustifiedCombinedProbability } from './independence.js';

/** The (core, frozen) artifact kind segment used for composition ids. */
export const PACKAGE_COMPOSITION_ARTIFACT_KIND = 'PackageComposition';

/** The full W6 composition content (see module doc). */
export interface PackageCompositionContent {
  /** Human-readable statement of the composed semantic capability. */
  semantic_capability: string;
  /** Contracts the composition realizes (>= 1). */
  contracts: string[];
  /** Member packages bound into roles (>= 2). */
  members: CompositionMember[];
  /** Typed wiring between member roles (>= 1). */
  bindings: CompositionBinding[];
  /** Preconditions of reuse (statements). */
  preconditions: string[];
  /** Postconditions of successful reuse (statements). */
  postconditions: string[];
  /** Context-conditioned applicability estimates (>= 1; never universal). */
  applicability: ApplicabilityEstimate[];
  /**
   * OWN evidence refs (>= 1 when maturity is VALIDATED or beyond — see
   * own-evidence.ts): evidence about THIS composition, never member
   * evidence.
   */
  evidence_refs: string[];
  /** Failure evidence refs (retained forever; monotonic across revisions). */
  failure_refs: string[];
  /** Compatibility evidence refs. */
  compatibility_refs: string[];
  /** Assurance obligations (>= 1 — reuse never bypasses assurance). */
  assurance_obligations: AssuranceObligation[];
  /** The composition's declaring context (non-empty condition). */
  context: ContextCondition;
  /** Learned limitations of THIS realization. */
  learned_limitations: string[];
  /** Declared diversity profile (family + dimension stances). */
  diversity_profile: DiversityProfile;
  /** Composition maturity (frozen package vocabulary — compositions are ecology citizens). */
  maturity: PackageMaturity;
  /** Justified combined probabilities (independence assessments; never unjustified). */
  independence: JustifiedCombinedProbability[];
  /** Version note: what changed in THIS revision (non-empty). */
  changes: string;
  /** Replacement id, REQUIRED when maturity is SUPERSEDED, else null. */
  superseded_by: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function requireNonEmptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new CompositionError(`${field} must be an array of non-empty strings`);
  }
  return [...value];
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new CompositionError(`${field} must be an array of non-empty strings`);
  }
  return [...value];
}

function assertRefKind(value: unknown, field: string, kind: string): asserts value is string {
  if (!isArtifactId(value)) {
    throw new CompositionError(`${field} entries must be well-formed spine artifact ids, received: ${JSON.stringify(value)}`);
  }
  const parsed = parseArtifactId(value);
  if (parsed.kind !== kind) {
    throw new CompositionError(
      `${field} entries must be ${kind} artifact ids (sos://${kind}/...), received: ${JSON.stringify(value)}`,
    );
  }
}

function isValidatedMaturityLive(maturity: PackageMaturity): boolean {
  return maturity === 'VALIDATED' || maturity === 'MATURE' || maturity === 'CONTEXTUALIZED';
}

/** Validate a composition content (throws CompositionError with a specific message). */
export function assertValidCompositionContent(value: unknown): asserts value is PackageCompositionContent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CompositionError('composition content must be an object');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys: ReadonlySet<string> = new Set([
    'semantic_capability',
    'contracts',
    'members',
    'bindings',
    'preconditions',
    'postconditions',
    'applicability',
    'evidence_refs',
    'failure_refs',
    'compatibility_refs',
    'assurance_obligations',
    'context',
    'learned_limitations',
    'diversity_profile',
    'maturity',
    'independence',
    'changes',
    'superseded_by',
  ]);
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== expectedKeys.size || !actualKeys.every((key) => expectedKeys.has(key))) {
    throw new CompositionError(
      `composition content must have the exact 18-field set (semantic_capability, contracts, members, bindings, ` +
        `preconditions, postconditions, applicability, evidence_refs, failure_refs, compatibility_refs, ` +
        `assurance_obligations, context, learned_limitations, diversity_profile, maturity, independence, ` +
        `changes, superseded_by); received keys: ${actualKeys.join(', ')}`,
    );
  }
  if (!isNonEmptyString(record['semantic_capability'])) {
    throw new CompositionError(`semantic_capability must be a non-empty string, received: ${JSON.stringify(record['semantic_capability'])}`);
  }
  const contracts = record['contracts'];
  if (!Array.isArray(contracts) || contracts.length === 0 || !contracts.every(isNonEmptyString)) {
    throw new CompositionError('contracts must be a non-empty array of non-empty strings (a composition realizes contracts)');
  }
  assertValidCompositionMembers(record['members']);
  assertValidCompositionBindings(record['bindings'], record['members'] as CompositionMember[]);
  requireNonEmptyStringArray(record['preconditions'], 'preconditions');
  requireNonEmptyStringArray(record['postconditions'], 'postconditions');
  if (!Array.isArray(record['applicability'])) {
    throw new CompositionError('applicability must be an array of context-conditioned estimates');
  }
  assertValidApplicabilitySet(record['applicability']);

  const maturity = record['maturity'];
  if (!isPackageMaturity(maturity)) {
    throw new CompositionError(
      `maturity must be one of the frozen 7 (imported from @sos-2/contracts): ${PACKAGE_MATURITIES.join(', ')}, received: ${JSON.stringify(maturity)}`,
    );
  }

  const evidenceRefs = record['evidence_refs'];
  if (!Array.isArray(evidenceRefs) || !evidenceRefs.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    throw new CompositionError('evidence_refs must be an array of evidence ids');
  }
  // Compositions require their OWN evidence — but own evidence references
  // the composition's chain ids, which cannot exist before the composition
  // itself (content-addressed identity). The sanctioned creation flows are
  // therefore: (a) create at DISCOVERED/FORMING (refs may be empty or
  // provisional), then promote with own evidence through the registry;
  // (b) mint an explicit id first and create validated with own evidence.
  // Validated-or-beyond and SUPERSEDED (ex-validated) compositions must
  // carry a non-empty evidence set.
  if (
    (isValidatedMaturityLive(maturity) || maturity === 'SUPERSEDED') &&
    evidenceRefs.length === 0
  ) {
    throw new CompositionError(
      `a ${maturity} composition must carry its own evidence — compositions require their own evidence ` +
        '(spec/architecture.md §18; member evidence never substitutes)',
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
  assertValidAssuranceObligations(record['assurance_obligations']);
  assertValidContextCondition(record['context'], 'composition context');
  requireNonEmptyStringArray(record['learned_limitations'], 'learned_limitations');
  assertValidDiversityProfile(record['diversity_profile']);

  if (!isNonEmptyString(record['changes'])) {
    throw new CompositionError(`changes must be a non-empty version note, received: ${JSON.stringify(record['changes'])}`);
  }
  const supersededBy = record['superseded_by'];
  if (supersededBy !== null && !isArtifactId(supersededBy)) {
    throw new CompositionError(
      `superseded_by must be null or a well-formed spine artifact id, received: ${JSON.stringify(supersededBy)}`,
    );
  }
  if (maturity === 'SUPERSEDED' && supersededBy === null) {
    throw new CompositionError('a SUPERSEDED composition must declare its replacement (superseded_by)');
  }
  if (maturity !== 'SUPERSEDED' && supersededBy !== null) {
    throw new CompositionError('superseded_by must be null unless maturity is SUPERSEDED');
  }

  const independence = record['independence'];
  if (!Array.isArray(independence)) {
    throw new CompositionError('independence must be an array of justified combined probabilities');
  }
  const memberIds = (record['members'] as CompositionMember[]).map((member) => member.package_id);
  for (const assessment of independence) {
    assertValidIndependenceAssessment(assessment, memberIds);
  }
}

/** Predicate form of assertValidCompositionContent. */
export function isValidCompositionContent(value: unknown): value is PackageCompositionContent {
  try {
    assertValidCompositionContent(value);
    return true;
  } catch {
    return false;
  }
}
