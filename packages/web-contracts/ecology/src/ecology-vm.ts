/**
 * The package-ecology workspace view models (Work Order P10) — package
 * discovery as a COMPOSITION SURFACE.
 *
 * spec/productization-work-orders/P10-package-history-evolution.md
 * acceptance: "package discovery becomes a composition workspace";
 * "contextual applicability, uncertainty, failures and assurance
 * obligations remain visible"; "package compositions have independent
 * evidence".
 *
 * The projections NEVER collapse anything into a single score: every
 * context-conditioned applicability estimate is preserved verbatim with its
 * own uncertainty view, retained failure refs stay visible, assurance
 * obligations stay attached to reuse, and every composition carries its OWN
 * independent evidence — evaluated by the OWNING authority
 * (@sos-2/composition's evaluateOwnEvidence, consumed verbatim; member
 * evidence never substitutes for composition evidence).
 *
 * DISCIPLINE (mirrors the P1 core): ZERO domain logic, ZERO DOM
 * dependencies. Every vocabulary (applicability estimates, diversity
 * profiles, assurance obligations, binding kinds, independence
 * justifications, maturities) is IMPORTED from the owning @sos-2/* package
 * — never redefined. Every consequential view model carries the P1 product
 * core (what, why, evidence refs, uncertainty, authority, next allowed
 * action) plus the explicit DEMO-vs-LIVE data-source marker.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import type { PackageMaturity } from '@sos-2/semantic-spine';
import { evaluateOwnEvidence } from '@sos-2/composition';
import type {
  CompositionBinding,
  CompositionMember,
  JustifiedCombinedProbability,
  PackageCompositionArtifact,
} from '@sos-2/composition';
import type {
  ApplicabilityEstimate,
  AssuranceObligation,
  ContextCondition,
  DiversityProfile,
  PackageArtifact,
  PackageRealization,
} from '@sos-2/packages';
import type { EvidenceSetSummary } from '@sos-2/packages';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type {
  AuthorityView,
  DataSource,
  NextActionView,
  ProductVmCore,
  StateBlock,
  UncertaintyView,
} from '@sos-2/web-contracts';
import { assertValidProductVmCore } from '@sos-2/web-contracts';

/** The shared P10 projection input core (the caller assembles the product core). */
export interface EcologyVmCoreInput {
  rationale: ProductVmCore['rationale'];
  data_source: DataSource;
  evidence_refs: string[];
  uncertainty: UncertaintyView;
  authority: AuthorityView;
  next_allowed_action: NextActionView;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * One package on the discovery surface — applicability, uncertainty,
 * failures and assurance obligations all VISIBLE (never collapsed).
 */
export interface PackageEcologyVM {
  /** The P1 product core (what/why/evidence/uncertainty/authority/next). */
  core: ProductVmCore;
  package_id: string;
  version: number;
  status: string;
  created_at: string;
  /** The package artifact this revision supersedes, or null (chain root). */
  supersedes: string | null;
  semantic_capability: string;
  contracts: string[];
  maturity: PackageMaturity;
  /** Declared diversity family (preserved — never collapsed into one winner). */
  family: string;
  /** Declared behavioral dimension stances (verbatim). */
  dimensions: DiversityProfile['dimensions'];
  /** ALL context-conditioned applicability estimates (verbatim, >= 1). */
  applicability: ApplicabilityEstimate[];
  /** Why there is no single number here (the honest anti-collapse statement). */
  applicability_note: string;
  preconditions: string[];
  postconditions: string[];
  realizations: PackageRealization[];
  /** Supporting evidence refs (verbatim from the package content). */
  evidence_refs: string[];
  /** Retained failure evidence refs (negative evidence is retained, visible). */
  failure_refs: string[];
  compatibility_refs: string[];
  /** Assurance obligations (reuse never bypasses assurance). */
  assurance_obligations: AssuranceObligation[];
  learned_limitations: string[];
  context: ContextCondition;
  /** Compositions this package revision participates in (declared). */
  composition_refs: string[];
  /** What changed in THIS revision (the version note, verbatim). */
  changes: string;
  superseded_by: string | null;
}

/** The applicability anti-collapse statement (part of the P10 contract, pinned by tests). */
export const PACKAGE_APPLICABILITY_NOTE =
  'Applicability is context-conditioned: every estimate carries its own context and uncertainty class. ' +
  'There is deliberately no single applicability score — a universal score would hide the context ' +
  '(spec/architecture.md section 12; "No score hides uncertainty, evidence quality or context").';

/**
 * Project one package artifact revision onto the discovery surface. The
 * applicability estimates, diversity profile, evidence/failure refs,
 * assurance obligations and learned limitations are copied VERBATIM from
 * the package content — nothing is summarized, aggregated or dropped.
 */
export function projectPackageEcology(input: {
  artifact: PackageArtifact;
  rationale: ProductVmCore['rationale'];
  data_source: DataSource;
  uncertainty: UncertaintyView;
  authority: AuthorityView;
  next_allowed_action: NextActionView;
  evidence_refs?: string[];
}): PackageEcologyVM {
  const artifact = input.artifact;
  const core: ProductVmCore = {
    subject_id: artifact.envelope.id,
    data_source: input.data_source,
    rationale: input.rationale,
    evidence_refs: sortedUnique(input.evidence_refs ?? artifact.content.evidence_refs),
    uncertainty: input.uncertainty,
    authority: input.authority,
    next_allowed_action: input.next_allowed_action,
  };
  assertValidProductVmCore(core);
  const vm: PackageEcologyVM = {
    core,
    package_id: artifact.envelope.id,
    version: artifact.envelope.version,
    status: artifact.envelope.status,
    created_at: artifact.envelope.created_at,
    supersedes: artifact.envelope.supersedes,
    semantic_capability: artifact.content.semantic_capability,
    contracts: [...artifact.content.contracts],
    maturity: artifact.content.maturity,
    family: artifact.content.diversity_profile.family,
    dimensions: structuredClone(artifact.content.diversity_profile.dimensions),
    applicability: structuredClone(artifact.content.applicability),
    applicability_note: PACKAGE_APPLICABILITY_NOTE,
    preconditions: [...artifact.content.preconditions],
    postconditions: [...artifact.content.postconditions],
    realizations: structuredClone(artifact.content.realizations),
    evidence_refs: [...artifact.content.evidence_refs],
    failure_refs: [...artifact.content.failure_refs],
    compatibility_refs: [...artifact.content.compatibility_refs],
    assurance_obligations: structuredClone(artifact.content.assurance_obligations),
    learned_limitations: [...artifact.content.learned_limitations],
    context: structuredClone(artifact.content.context),
    composition_refs: [...artifact.content.composition_refs],
    changes: artifact.content.changes,
    superseded_by: artifact.content.superseded_by,
  };
  assertValidPackageEcologyVM(vm);
  return vm;
}

/** Validate a PackageEcologyVM (throws — a projection that hides context is rejected). */
export function assertValidPackageEcologyVM(value: unknown): asserts value is PackageEcologyVM {
  if (!isPlainObject(value)) {
    throw new Error('package ecology view model must be an object');
  }
  const record = value as Record<string, unknown>;
  const expected = new Set([
    'core',
    'package_id',
    'version',
    'status',
    'created_at',
    'supersedes',
    'semantic_capability',
    'contracts',
    'maturity',
    'family',
    'dimensions',
    'applicability',
    'applicability_note',
    'preconditions',
    'postconditions',
    'realizations',
    'evidence_refs',
    'failure_refs',
    'compatibility_refs',
    'assurance_obligations',
    'learned_limitations',
    'context',
    'composition_refs',
    'changes',
    'superseded_by',
  ]);
  const keys = Object.keys(record);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new Error('package ecology view model must have the exact P10 field set');
  }
  if (!isNonEmptyString(record['package_id']) || !isArtifactId(record['package_id'])) {
    throw new Error('package ecology view model package_id must be a well-formed spine artifact id');
  }
  if (!Array.isArray(record['applicability']) || (record['applicability'] as unknown[]).length === 0) {
    throw new Error(
      'package ecology view model must carry at least one context-conditioned applicability estimate (universal scores are forbidden)',
    );
  }
  if (!Array.isArray(record['assurance_obligations']) || (record['assurance_obligations'] as unknown[]).length === 0) {
    throw new Error('package ecology view model must carry its assurance obligations (reuse never bypasses assurance)');
  }
  if (!Array.isArray(record['failure_refs'])) {
    throw new Error('package ecology view model must carry its failure refs list (retained negative evidence stays visible)');
  }
  if (!isNonEmptyString(record['applicability_note'])) {
    throw new Error('package ecology view model must carry the applicability anti-collapse note');
  }
  if (!isNonEmptyString(record['family'])) {
    throw new Error('package ecology view model must declare its diversity family (never collapsed)');
  }
  try {
    assertValidProductVmCore(record['core']);
  } catch (cause) {
    throw new Error(`package ecology view model core is invalid: ${(cause as Error).message}`);
  }
}

/** The own-evidence verdict of one composition (evaluated by @sos-2/composition). */
export interface CompositionOwnEvidenceVM {
  /** True iff every cited ref resolves to evidence ABOUT this composition's own chain. */
  valid: boolean;
  /** The rejection reasons (empty iff valid) — surfaced, never hidden. */
  reasons: string[];
  /** Cited refs that did not resolve in the available evidence pool. */
  unresolved_refs: string[];
  /** Refs rejected as member evidence (independence is a locked invariant). */
  foreign_refs: string[];
  /** The OWNING summary of the composition's own evidence set. */
  summary: EvidenceSetSummary;
  /** The independence statement (part of the P10 contract). */
  note: string;
}

/** The composition independence statement (pinned by tests). */
export const COMPOSITION_OWN_EVIDENCE_NOTE =
  'A composition carries its OWN evidence: only evidence about the composition itself (its chain of spine ids) ' +
  'counts. Member success never implies composition success — evidence about a member package is foreign and is ' +
  'surfaced as such, never silently folded in (spec/architecture.md section 18, the locked own-evidence invariant).';

/** One package composition on the workspace surface. */
export interface CompositionVM {
  core: ProductVmCore;
  composition_id: string;
  version: number;
  status: string;
  created_at: string;
  supersedes: string | null;
  semantic_capability: string;
  contracts: string[];
  maturity: PackageMaturity;
  family: string;
  dimensions: DiversityProfile['dimensions'];
  /** The member packages bound into roles (verbatim). */
  members: CompositionMember[];
  /** The typed wiring between member roles (verbatim). */
  bindings: CompositionBinding[];
  /** The composition's OWN independent evidence verdict. */
  own_evidence: CompositionOwnEvidenceVM;
  /** Justified combined probabilities (never unjustified products). */
  independence: JustifiedCombinedProbability[];
  applicability: ApplicabilityEstimate[];
  applicability_note: string;
  preconditions: string[];
  postconditions: string[];
  assurance_obligations: AssuranceObligation[];
  learned_limitations: string[];
  context: ContextCondition;
  changes: string;
  superseded_by: string | null;
}

/**
 * Project one composition artifact onto the workspace surface. The
 * own-evidence verdict is computed by the OWNING authority
 * (@sos-2/composition evaluateOwnEvidence) over the available evidence
 * pool — the projection only carries the verdict, verbatim.
 */
export function projectComposition(input: {
  artifact: PackageCompositionArtifact;
  /** The composition's earlier chain ids (for own-evidence evaluation). */
  chain_ids?: readonly string[];
  /** The evidence pool the refs resolve against. */
  evidence: readonly EvidenceRecordW3[];
  rationale: ProductVmCore['rationale'];
  data_source: DataSource;
  uncertainty: UncertaintyView;
  authority: AuthorityView;
  next_allowed_action: NextActionView;
}): CompositionVM {
  const artifact = input.artifact;
  const verdict = evaluateOwnEvidence(
    artifact.content.evidence_refs,
    input.evidence,
    artifact.envelope.id,
    input.chain_ids ?? [],
  );
  const core: ProductVmCore = {
    subject_id: artifact.envelope.id,
    data_source: input.data_source,
    rationale: input.rationale,
    evidence_refs: sortedUnique(artifact.content.evidence_refs),
    uncertainty: input.uncertainty,
    authority: input.authority,
    next_allowed_action: input.next_allowed_action,
  };
  assertValidProductVmCore(core);
  const vm: CompositionVM = {
    core,
    composition_id: artifact.envelope.id,
    version: artifact.envelope.version,
    status: artifact.envelope.status,
    created_at: artifact.envelope.created_at,
    supersedes: artifact.envelope.supersedes,
    semantic_capability: artifact.content.semantic_capability,
    contracts: [...artifact.content.contracts],
    maturity: artifact.content.maturity,
    family: artifact.content.diversity_profile.family,
    dimensions: structuredClone(artifact.content.diversity_profile.dimensions),
    members: structuredClone(artifact.content.members),
    bindings: structuredClone(artifact.content.bindings),
    own_evidence: {
      valid: verdict.valid,
      reasons: [...verdict.reasons],
      unresolved_refs: [...verdict.unresolved_refs],
      foreign_refs: [...verdict.foreign_refs],
      summary: verdict.summary,
      note: COMPOSITION_OWN_EVIDENCE_NOTE,
    },
    independence: structuredClone(artifact.content.independence),
    applicability: structuredClone(artifact.content.applicability),
    applicability_note: PACKAGE_APPLICABILITY_NOTE,
    preconditions: [...artifact.content.preconditions],
    postconditions: [...artifact.content.postconditions],
    assurance_obligations: structuredClone(artifact.content.assurance_obligations),
    learned_limitations: [...artifact.content.learned_limitations],
    context: structuredClone(artifact.content.context),
    changes: artifact.content.changes,
    superseded_by: artifact.content.superseded_by,
  };
  assertValidCompositionVM(vm);
  return vm;
}

/** Validate a CompositionVM (throws — a composition without its own-evidence verdict is rejected). */
export function assertValidCompositionVM(value: unknown): asserts value is CompositionVM {
  if (!isPlainObject(value)) {
    throw new Error('composition view model must be an object');
  }
  const record = value as Record<string, unknown>;
  const expected = new Set([
    'core',
    'composition_id',
    'version',
    'status',
    'created_at',
    'supersedes',
    'semantic_capability',
    'contracts',
    'maturity',
    'family',
    'dimensions',
    'members',
    'bindings',
    'own_evidence',
    'independence',
    'applicability',
    'applicability_note',
    'preconditions',
    'postconditions',
    'assurance_obligations',
    'learned_limitations',
    'context',
    'changes',
    'superseded_by',
  ]);
  const keys = Object.keys(record);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new Error('composition view model must have the exact P10 field set');
  }
  if (!isNonEmptyString(record['composition_id']) || !isArtifactId(record['composition_id'])) {
    throw new Error('composition view model composition_id must be a well-formed spine artifact id');
  }
  const own = record['own_evidence'];
  if (!isPlainObject(own)) {
    throw new Error('composition view model must carry its own-evidence verdict (independent evidence is structural)');
  }
  const ownRecord = own as Record<string, unknown>;
  for (const key of ['valid', 'reasons', 'unresolved_refs', 'foreign_refs', 'summary', 'note']) {
    if (!(key in ownRecord)) {
      throw new Error(`composition own-evidence verdict is missing ${JSON.stringify(key)}`);
    }
  }
  if (typeof ownRecord['valid'] !== 'boolean') {
    throw new Error('composition own-evidence valid must be a boolean');
  }
  if (!Array.isArray(record['members']) || (record['members'] as unknown[]).length < 2) {
    throw new Error('composition view model must carry its member packages (>= 2)');
  }
  if (!Array.isArray(record['bindings']) || (record['bindings'] as unknown[]).length < 1) {
    throw new Error('composition view model must carry its typed bindings (>= 1)');
  }
  if (!Array.isArray(record['applicability']) || (record['applicability'] as unknown[]).length === 0) {
    throw new Error('composition view model must carry context-conditioned applicability (never a universal score)');
  }
  try {
    assertValidProductVmCore(record['core']);
  } catch (cause) {
    throw new Error(`composition view model core is invalid: ${(cause as Error).message}`);
  }
}

/** One diversity family entry of the workspace repertoire. */
export interface EcologyFamilyVM {
  family: string;
  entries: number;
}

/** Which compositions a package revision participates in. */
export interface CompositionParticipationVM {
  package_id: string;
  composition_ids: string[];
}

/**
 * The packages WORKSPACE view model — discovery as a composition surface:
 * the package repertoire with diversity families, the compositions with
 * their independent evidence, and honest state blocks for the surfaces
 * that do not exist yet (live composition repository family, composition
 * building in the demo).
 */
export interface PackagesWorkspaceVM {
  core: ProductVmCore;
  packages: PackageEcologyVM[];
  compositions: CompositionVM[];
  families: EcologyFamilyVM[];
  composition_participation: CompositionParticipationVM[];
  /** Honest state blocks (empty families, not-yet-live surfaces). */
  state_blocks: StateBlock[];
  diversity_note: string;
}

/** The workspace diversity statement (pinned by tests). */
export const PACKAGES_DIVERSITY_NOTE =
  'The repertoire deliberately keeps materially different solution families; discovery never collapses the ' +
  'candidate set into a single global winner (AGENTS.md section 9; spec/architecture.md section 11).';

function compareById(a: { core: ProductVmCore }, b: { core: ProductVmCore }): number {
  return a.core.subject_id < b.core.subject_id ? -1 : a.core.subject_id > b.core.subject_id ? 1 : 0;
}

/** Project the whole packages workspace (deterministic order: by subject id). */
export function projectPackagesWorkspace(input: {
  packages: readonly PackageEcologyVM[];
  compositions: readonly CompositionVM[];
  state_blocks?: readonly StateBlock[];
  rationale: ProductVmCore['rationale'];
  data_source: DataSource;
  evidence_refs: string[];
  uncertainty: UncertaintyView;
  authority: AuthorityView;
  next_allowed_action: NextActionView;
}): PackagesWorkspaceVM {
  const packages = [...input.packages].sort(compareById);
  const compositions = [...input.compositions].sort(compareById);
  const families = new Map<string, number>();
  for (const pkg of packages) {
    families.set(pkg.family, (families.get(pkg.family) ?? 0) + 1);
  }
  const participation = new Map<string, Set<string>>();
  for (const composition of compositions) {
    for (const member of composition.members) {
      const set = participation.get(member.package_id) ?? new Set<string>();
      set.add(composition.composition_id);
      participation.set(member.package_id, set);
    }
  }
  const core: ProductVmCore = {
    subject_id: input.rationale.subject_id,
    data_source: input.data_source,
    rationale: input.rationale,
    evidence_refs: sortedUnique(input.evidence_refs),
    uncertainty: input.uncertainty,
    authority: input.authority,
    next_allowed_action: input.next_allowed_action,
  };
  assertValidProductVmCore(core);
  const vm: PackagesWorkspaceVM = {
    core,
    packages,
    compositions,
    families: [...families.entries()]
      .map(([family, entries]) => ({ family, entries }))
      .sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0)),
    composition_participation: [...participation.entries()]
      .map(([package_id, composition_ids]) => ({ package_id, composition_ids: sortedUnique([...composition_ids]) }))
      .sort((a, b) => (a.package_id < b.package_id ? -1 : a.package_id > b.package_id ? 1 : 0)),
    state_blocks: [...(input.state_blocks ?? [])],
    diversity_note: PACKAGES_DIVERSITY_NOTE,
  };
  assertValidPackagesWorkspaceVM(vm);
  return vm;
}

/** Validate a PackagesWorkspaceVM (throws). */
export function assertValidPackagesWorkspaceVM(value: unknown): asserts value is PackagesWorkspaceVM {
  if (!isPlainObject(value)) {
    throw new Error('packages workspace view model must be an object');
  }
  const record = value as Record<string, unknown>;
  const expected = new Set([
    'core',
    'packages',
    'compositions',
    'families',
    'composition_participation',
    'state_blocks',
    'diversity_note',
  ]);
  const keys = Object.keys(record);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new Error('packages workspace view model must have the exact P10 field set');
  }
  for (const pkg of record['packages'] as PackageEcologyVM[]) {
    assertValidPackageEcologyVM(pkg);
  }
  for (const composition of record['compositions'] as CompositionVM[]) {
    assertValidCompositionVM(composition);
  }
  // Diversity discipline: every package family is listed (no silent collapse).
  const families = new Set((record['families'] as EcologyFamilyVM[]).map((entry) => entry.family));
  for (const pkg of record['packages'] as PackageEcologyVM[]) {
    if (!families.has(pkg.family)) {
      throw new Error(`workspace family ${JSON.stringify(pkg.family)} is missing from the family list (diversity preserved, never collapsed)`);
    }
  }
  // Composition participation covers every member (reuse wiring is complete).
  const participation = new Set((record['composition_participation'] as CompositionParticipationVM[]).map((entry) => entry.package_id));
  for (const composition of record['compositions'] as CompositionVM[]) {
    for (const member of composition.members) {
      if (!participation.has(member.package_id)) {
        throw new Error(`composition member ${member.package_id} is missing from the participation list`);
      }
    }
  }
  if (!Array.isArray(record['state_blocks'])) {
    throw new Error('packages workspace view model must carry its state blocks');
  }
  if (!isNonEmptyString(record['diversity_note'])) {
    throw new Error('packages workspace view model must carry the diversity note');
  }
}
