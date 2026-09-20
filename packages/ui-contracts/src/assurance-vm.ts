/**
 * AssuranceVM — the assurance-review view model (Work Order W11;
 * spec/architecture.md §5 Assurance Case; §13 assurance).
 *
 * A pure projection of an @sos-2/assurance AssuranceCaseArtifact plus its
 * LIVING evaluation (the derived verdict — never stored, always recomputed
 * by the W8 authority). All eight case sections and the evaluation types
 * (verdict, invalidations, objections) are IMPORTED from @sos-2/assurance —
 * never redefined.
 *
 * Objections are first-class and never dropped: the view model carries ALL
 * objections with their lifecycle plus the open (unresolved) subset —
 * objections discipline is the W8 contract and this projection preserves
 * it verbatim.
 */

import { isArtifactId, isArtifactStatus } from '@sos-2/semantic-spine';
import type { ArtifactStatus } from '@sos-2/semantic-spine';
import type {
  AssuranceArgument,
  AssuranceAssumption,
  AssuranceCaseArtifact,
  AssuranceControl,
  AssuranceEvaluation,
  AssuranceHazard,
  AssuranceInvalidation,
  AssuranceVerdict,
  EvidenceRef,
  Objection,
  ValidityCondition,
} from '@sos-2/assurance';
import {
  ASSURANCE_VERDICTS,
  assertValidAssuranceCase,
} from '@sos-2/assurance';
import type { AssuranceClaim } from '@sos-2/assurance';
import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/** The assurance review view model. */
export interface AssuranceVM {
  id: string;
  version: number;
  status: ArtifactStatus;
  created_at: string;
  claims: AssuranceClaim[];
  arguments: AssuranceArgument[];
  assumptions: AssuranceAssumption[];
  hazards: AssuranceHazard[];
  controls: AssuranceControl[];
  evidence_refs: EvidenceRef[];
  validity_conditions: ValidityCondition[];
  /** ALL objections, with lifecycle (never dropped — the W8 discipline). */
  objections: Objection[];
  /** The unresolved subset, sorted by id. */
  open_objections: Objection[];
  /** The DERIVED verdict (VALID | OBJECTIONED | INVALID), or null when not evaluated. */
  verdict: AssuranceVerdict | null;
  /** All tracked invalidations (empty iff verdict !== INVALID). */
  invalidations: AssuranceInvalidation[];
  /** The evaluation instant, or null when not evaluated. */
  evaluated_at: string | null;
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Structural check for an AssuranceEvaluation (the W8 result shape). */
function isAssuranceEvaluation(value: unknown): value is AssuranceEvaluation {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record['case_id']) &&
    typeof record['case_version'] === 'number' &&
    isNonEmptyString(record['evaluated_at']) &&
    ASSURANCE_VERDICTS.includes(record['verdict'] as AssuranceVerdict) &&
    Array.isArray(record['invalidations']) &&
    Array.isArray(record['open_objections'])
  );
}

export interface ProjectAssuranceInput {
  case: AssuranceCaseArtifact;
  /** The living evaluation (verdict is derived, never stored), or null. */
  evaluation: AssuranceEvaluation | null;
  rationale: RationaleChain;
}

/** Project an assurance case (+ evaluation) onto the review view model. */
export function projectAssurance(input: ProjectAssuranceInput): AssuranceVM {
  assertValidAssuranceCase(input.case);
  if (input.evaluation !== null) {
    if (!isAssuranceEvaluation(input.evaluation)) {
      throw new UIContractError('evaluation does not match the AssuranceEvaluation contract');
    }
    if (input.evaluation.case_id !== input.case.envelope.id) {
      throw new UIContractError(
        `evaluation belongs to case ${input.evaluation.case_id}, not ${input.case.envelope.id}`,
      );
    }
  }
  if (input.rationale.subject_id !== input.case.envelope.id) {
    throw new UIContractError(
      `rationale chain subject ${JSON.stringify(input.rationale.subject_id)} does not match the case id ${JSON.stringify(input.case.envelope.id)}`,
    );
  }
  assertValidRationaleChain(input.rationale);

  const objections = structuredClone(input.case.content.objections);
  const vm: AssuranceVM = {
    id: input.case.envelope.id,
    version: input.case.envelope.version,
    status: input.case.envelope.status,
    created_at: input.case.envelope.created_at,
    claims: structuredClone(input.case.content.claims),
    arguments: structuredClone(input.case.content.arguments),
    assumptions: structuredClone(input.case.content.assumptions),
    hazards: structuredClone(input.case.content.hazards),
    controls: structuredClone(input.case.content.controls),
    evidence_refs: structuredClone(input.case.content.evidence),
    validity_conditions: structuredClone(input.case.content.validity_conditions),
    objections,
    open_objections: objections
      .filter((objection) => objection.status === 'OPEN')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    verdict: input.evaluation === null ? null : input.evaluation.verdict,
    invalidations: input.evaluation === null ? [] : structuredClone(input.evaluation.invalidations),
    evaluated_at: input.evaluation === null ? null : input.evaluation.evaluated_at,
    rationale: input.rationale,
  };
  assertValidAssuranceVM(vm);
  return vm;
}

/** Validate an AssuranceVM (throws UIContractError). */
export function assertValidAssuranceVM(value: unknown): asserts value is AssuranceVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`assurance view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set([
    'id',
    'version',
    'status',
    'created_at',
    'claims',
    'arguments',
    'assumptions',
    'hazards',
    'controls',
    'evidence_refs',
    'validity_conditions',
    'objections',
    'open_objections',
    'verdict',
    'invalidations',
    'evaluated_at',
    'rationale',
  ]);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('assurance view model must have the exact W11 field set (eight sections + verdict + rationale)');
  }
  if (!isNonEmptyString(record['id']) || !isArtifactId(record['id'])) {
    throw new UIContractError('assurance view model id must be a well-formed spine artifact id');
  }
  if (!isArtifactStatus(record['status'])) {
    throw new UIContractError('assurance view model status must be from the frozen envelope vocabulary');
  }
  for (const section of ['claims', 'arguments', 'assumptions', 'hazards', 'controls', 'evidence_refs', 'validity_conditions', 'objections'] as const) {
    if (!Array.isArray(record[section])) {
      throw new UIContractError(`assurance view model ${section} must be an array`);
    }
  }
  if ((record['claims'] as unknown[]).length === 0) {
    throw new UIContractError('assurance view model must carry at least one claim');
  }
  if (!Array.isArray(record['open_objections'])) {
    throw new UIContractError('assurance view model open_objections must be an array');
  }
  for (const objection of [...(record['objections'] as Objection[]), ...(record['open_objections'] as Objection[])]) {
    if (!isPlainObject(objection) || !isNonEmptyString(objection.id) || !isNonEmptyString(objection.statement)) {
      throw new UIContractError('objections must carry { id, statement, ... } — objections are never dropped');
    }
    if (objection.status !== 'OPEN' && objection.status !== 'RESOLVED') {
      throw new UIContractError(`objection status must be OPEN or RESOLVED, received: ${JSON.stringify(objection.status)}`);
    }
  }
  for (const open of record['open_objections'] as Objection[]) {
    if (open.status !== 'OPEN') {
      throw new UIContractError('open_objections must contain only OPEN objections');
    }
  }
  if (record['verdict'] !== null && !ASSURANCE_VERDICTS.includes(record['verdict'] as AssuranceVerdict)) {
    throw new UIContractError(
      `assurance verdict must be one of the frozen verdicts ${ASSURANCE_VERDICTS.join(', ')} or null, received: ${JSON.stringify(record['verdict'])}`,
    );
  }
  if (record['verdict'] === 'INVALID' && (record['invalidations'] as AssuranceInvalidation[]).length === 0) {
    throw new UIContractError('an INVALID verdict must carry at least one tracked invalidation (the why)');
  }
  if (record['verdict'] === 'VALID' && (record['open_objections'] as Objection[]).length > 0) {
    throw new UIContractError('a VALID verdict cannot coexist with open objections (verdicts are never inflated)');
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`assurance view model rationale is invalid: ${(cause as Error).message}`);
  }
  const rationale = record['rationale'] as RationaleChain;
  if (rationale.subject_id !== record['id']) {
    throw new UIContractError('assurance view model rationale must bind this case id');
  }
  if (rationale.evidence_refs.length === 0) {
    throw new UIContractError(
      'assurance view model rationale must cite evidence (an assurance case without evidence refs is not arguable)',
    );
  }
}

/** Predicate form of assertValidAssuranceVM. */
export function validateAssuranceVM(value: unknown): value is AssuranceVM {
  try {
    assertValidAssuranceVM(value);
    return true;
  } catch {
    return false;
  }
}
