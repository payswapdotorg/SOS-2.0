/**
 * PackageVM — the package discovery/composition view model (Work Order
 * W11; spec/architecture.md §10 retrieval at the highest safe validated
 * reasoning altitude, §11 diversity; R24-R29).
 *
 * A pure projection of @sos-2/registry RetrievalCandidates onto the
 * REPERTOIRE view. The projection NEVER ranks candidates into a single
 * winner: it preserves the declared diversity family and dimension stances,
 * the context-conditioned applicability estimates, the uncertainty view
 * (never a bare score), the evidence context (resolved vs unresolved —
 * never zeroed), the learned limitations and the retained failure contexts
 * (negative evidence is retained), and the assurance obligations (reuse
 * never bypasses assurance).
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import type { EvidenceContext, FailureContext, RetrievalCandidate, RetrievalResult } from '@sos-2/registry';
import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/** One repertoire entry (a current package or composition candidate). */
export interface PackageVM {
  /** PACKAGE or COMPOSITION. */
  kind: string;
  id: string;
  version: number;
  semantic_capability: string;
  contracts: string[];
  maturity: string;
  /** The typed retrieval altitude (the §10 ladder). */
  altitude: string;
  /** Declared solution family (diversity grouping — preserved, never collapsed). */
  family: string;
  /** Declared behavioral dimension stances. */
  dimensions: RetrievalCandidate['dimensions'];
  /** ALL applicability estimates (context-conditioned, verbatim). */
  applicability: RetrievalCandidate['applicability'];
  /** Best estimate for the query context, or null when none matches. */
  best_estimate: RetrievalCandidate['best_estimate'];
  /** The uncertainty view for the query (never a bare score). */
  uncertainty: RetrievalCandidate['uncertainty'];
  /** The evidence context (resolved where possible; honest otherwise). */
  evidence_context: EvidenceContext;
  /** Learned limitations (verbatim). */
  learned_limitations: string[];
  /** Retained failure contexts (negative evidence retained). */
  failure_contexts: FailureContext[];
  /** Assurance obligations (verbatim — reuse never bypasses assurance). */
  assurance_obligations: RetrievalCandidate['assurance_obligations'];
  /** Whether the query context matched an applicability estimate. */
  context_match: RetrievalCandidate['context_match'];
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

/** The repertoire view model (the DIVERSE candidate set, never one winner). */
export interface RepertoireVM {
  /** The query capability (verbatim). */
  capability: string;
  /** Candidates in registry ranking order (altitude-first, deterministic). */
  candidates: PackageVM[];
  /** Distinct declared families present (sorted). */
  families: string[];
  /** Candidate count per family. */
  family_counts: Record<string, number>;
  /** Entries matching the capability (+ contracts) filter before diversity shaping. */
  matched_count: number;
  /** Total current entries in the registry. */
  total_current_entries: number;
}

/** Project one retrieval candidate onto a repertoire entry. */
export function projectPackage(
  candidate: RetrievalCandidate,
  rationale: RationaleChain,
): PackageVM {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new UIContractError('retrieval candidate must be an object');
  }
  if (rationale.subject_id !== candidate.id) {
    throw new UIContractError(
      `rationale chain subject ${JSON.stringify(rationale.subject_id)} does not match the candidate id ${JSON.stringify(candidate.id)}`,
    );
  }
  assertValidRationaleChain(rationale);
  const vm: PackageVM = {
    kind: candidate.kind,
    id: candidate.id,
    version: candidate.version,
    semantic_capability: candidate.semantic_capability,
    contracts: [...candidate.contracts],
    maturity: candidate.maturity,
    altitude: candidate.altitude,
    family: candidate.family,
    dimensions: structuredClone(candidate.dimensions),
    applicability: structuredClone(candidate.applicability),
    best_estimate: candidate.best_estimate === null ? null : structuredClone(candidate.best_estimate),
    uncertainty: structuredClone(candidate.uncertainty),
    evidence_context: structuredClone(candidate.evidence_context),
    learned_limitations: [...candidate.learned_limitations],
    failure_contexts: structuredClone(candidate.failure_contexts),
    assurance_obligations: structuredClone(candidate.assurance_obligations),
    context_match: candidate.context_match,
    rationale,
  };
  assertValidPackageVM(vm);
  return vm;
}

/** Project a full retrieval result onto the repertoire view model. */
export function projectRepertoire(
  result: RetrievalResult,
  rationales: ReadonlyMap<string, RationaleChain>,
): RepertoireVM {
  if (typeof result !== 'object' || result === null) {
    throw new UIContractError('retrieval result must be an object');
  }
  const candidates = result.candidates.map((candidate) => {
    const rationale = rationales.get(candidate.id);
    if (rationale === undefined) {
      throw new UIContractError(
        `missing rationale chain for repertoire candidate ${candidate.id} (every repertoire entry must expose its rationale)`,
      );
    }
    return projectPackage(candidate, rationale);
  });
  const vm: RepertoireVM = {
    capability: result.query.capability,
    candidates,
    families: [...result.families],
    family_counts: { ...result.family_counts },
    matched_count: result.matched_count,
    total_current_entries: result.total_current_entries,
  };
  assertValidRepertoireVM(vm);
  return vm;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate a PackageVM (throws UIContractError). */
export function assertValidPackageVM(value: unknown): asserts value is PackageVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`package view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set([
    'kind',
    'id',
    'version',
    'semantic_capability',
    'contracts',
    'maturity',
    'altitude',
    'family',
    'dimensions',
    'applicability',
    'best_estimate',
    'uncertainty',
    'evidence_context',
    'learned_limitations',
    'failure_contexts',
    'assurance_obligations',
    'context_match',
    'rationale',
  ]);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('package view model must have the exact W11 field set (diversity + applicability + evidence + limitations + rationale)');
  }
  if (record['kind'] !== 'PACKAGE' && record['kind'] !== 'COMPOSITION') {
    throw new UIContractError('package view model kind must be PACKAGE or COMPOSITION');
  }
  if (!isNonEmptyString(record['id']) || !isArtifactId(record['id'])) {
    throw new UIContractError('package view model id must be a well-formed spine artifact id');
  }
  if (!isNonEmptyString(record['semantic_capability'])) {
    throw new UIContractError('package view model semantic_capability must be a non-empty string');
  }
  if (!Array.isArray(record['contracts']) || record['contracts'].length === 0) {
    throw new UIContractError('package view model must declare at least one contract');
  }
  if (!isNonEmptyString(record['family'])) {
    throw new UIContractError('package view model must declare its diversity family (families are preserved, never collapsed)');
  }
  if (!Array.isArray(record['dimensions']) || record['dimensions'].length === 0) {
    throw new UIContractError('package view model must carry at least one diversity dimension stance');
  }
  if (!Array.isArray(record['applicability']) || record['applicability'].length === 0) {
    throw new UIContractError(
      'package view model must carry at least one context-conditioned applicability estimate (universal scores are forbidden)',
    );
  }
  const uncertainty = record['uncertainty'];
  if (!isPlainObject(uncertainty) || !isNonEmptyString((uncertainty as Record<string, unknown>)['uncertainty_class'] as string)) {
    throw new UIContractError('package view model must carry its uncertainty view (never a bare score)');
  }
  const evidence = record['evidence_context'];
  if (!isPlainObject(evidence) || typeof (evidence as Record<string, unknown>)['total_refs'] !== 'number') {
    throw new UIContractError('package view model must carry its evidence context');
  }
  if (!Array.isArray(record['assurance_obligations']) || record['assurance_obligations'].length === 0) {
    throw new UIContractError('package view model must carry its assurance obligations (reuse never bypasses assurance)');
  }
  if (record['context_match'] !== 'MATCHED' && record['context_match'] !== 'UNMATCHED' && record['context_match'] !== 'NO_QUERY_CONTEXT') {
    throw new UIContractError('package view model context_match must be MATCHED, UNMATCHED or NO_QUERY_CONTEXT');
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`package view model rationale is invalid: ${(cause as Error).message}`);
  }
  const rationale = record['rationale'] as RationaleChain;
  if (rationale.subject_id !== record['id']) {
    throw new UIContractError('package view model rationale must bind this entry id');
  }
  if (rationale.evidence_refs.length === 0) {
    throw new UIContractError(
      'package view model rationale must cite evidence (spec/architecture.md §18: packages require evidence)',
    );
  }
}

/** Predicate form of assertValidPackageVM. */
export function validatePackageVM(value: unknown): value is PackageVM {
  try {
    assertValidPackageVM(value);
    return true;
  } catch {
    return false;
  }
}

/** Validate a RepertoireVM (throws UIContractError). */
export function assertValidRepertoireVM(value: unknown): asserts value is RepertoireVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`repertoire view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['capability', 'candidates', 'families', 'family_counts', 'matched_count', 'total_current_entries']);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('repertoire view model must have the exact W11 field set');
  }
  if (!isNonEmptyString(record['capability'])) {
    throw new UIContractError('repertoire view model capability must be a non-empty string');
  }
  if (!Array.isArray(record['candidates'])) {
    throw new UIContractError('repertoire view model candidates must be an array');
  }
  for (const candidate of record['candidates']) {
    assertValidPackageVM(candidate);
  }
  if (!Array.isArray(record['families'])) {
    throw new UIContractError('repertoire view model families must be an array');
  }
  // Diversity discipline: when any candidate exists, at least one family is
  // present and every candidate's family is listed (no silent collapse).
  const families = new Set(record['families'] as string[]);
  for (const candidate of record['candidates'] as PackageVM[]) {
    if (!families.has(candidate.family)) {
      throw new UIContractError(
        `repertoire family ${JSON.stringify(candidate.family)} is missing from the family list (diversity is preserved, never collapsed)`,
      );
    }
  }
  if ((record['candidates'] as PackageVM[]).length > 0 && families.size === 0) {
    throw new UIContractError('a non-empty repertoire must declare its families');
  }
}

/** Predicate form of assertValidRepertoireVM. */
export function validateRepertoireVM(value: unknown): value is RepertoireVM {
  try {
    assertValidRepertoireVM(value);
    return true;
  } catch {
    return false;
  }
}
