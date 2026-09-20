/**
 * MissionVM — the mission-onboarding view model (Work Order W11).
 *
 * A pure projection of a @sos-2/mission MissionArtifact onto display data.
 * Every domain field type is IMPORTED from @sos-2/mission (goals, measures,
 * constraints, ...) — nothing is redefined here. The view-model adds only
 * the rationale chain (typed spine trace links + evidence refs) required by
 * the W11 acceptance.
 *
 * Projections are deterministic: collection order is preserved as authored
 * (mission content is author-ordered data, not derived lists), the
 * validator re-checks every invariant, and the projection itself calls the
 * validator before returning (an invalid view-model can never be emitted).
 */

import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { isArtifactId, isArtifactStatus } from '@sos-2/semantic-spine';
import type { MissionArtifact } from '@sos-2/mission';
import { assertValidMission } from '@sos-2/mission';
import type {
  MissionAmbiguity,
  MissionAssumption,
  MissionConstraint,
  MissionGoal,
  MissionMeasure,
  MissionOutcome,
  MissionStakeholder,
} from '@sos-2/mission';
import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/** The mission view model (all domain content types imported, never redefined). */
export interface MissionVM {
  id: string;
  version: number;
  status: ArtifactStatus;
  created_at: string;
  supersedes: string | null;
  authority_ref: string | null;
  provenance: string[];
  purpose: string;
  goals: MissionGoal[];
  outcomes: MissionOutcome[];
  stakeholders: MissionStakeholder[];
  measures: MissionMeasure[];
  assumptions: MissionAssumption[];
  ambiguities: MissionAmbiguity[];
  constraints: MissionConstraint[];
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

/** Project a mission artifact onto its view model (deterministic, total). */
export function projectMission(
  mission: MissionArtifact,
  rationale: RationaleChain,
): MissionVM {
  assertValidMission(mission);
  if (rationale.subject_id !== mission.envelope.id) {
    throw new UIContractError(
      `rationale chain subject ${JSON.stringify(rationale.subject_id)} does not match the mission id ${JSON.stringify(mission.envelope.id)}`,
    );
  }
  assertValidRationaleChain(rationale);
  const vm: MissionVM = {
    id: mission.envelope.id,
    version: mission.envelope.version,
    status: mission.envelope.status,
    created_at: mission.envelope.created_at,
    supersedes: mission.envelope.supersedes,
    authority_ref: mission.envelope.authority_ref,
    provenance: [...mission.envelope.provenance],
    purpose: mission.content.purpose,
    goals: structuredClone(mission.content.goals),
    outcomes: structuredClone(mission.content.outcomes),
    stakeholders: structuredClone(mission.content.stakeholders),
    measures: structuredClone(mission.content.measures),
    assumptions: structuredClone(mission.content.assumptions),
    ambiguities: structuredClone(mission.content.ambiguities),
    constraints: structuredClone(mission.content.constraints),
    rationale,
  };
  assertValidMissionVM(vm);
  return vm;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate a MissionVM (throws UIContractError). The projection contract:
 * identity is a well-formed spine id, the status is from the frozen envelope
 * vocabulary, the purpose is present, and the rationale chain binds THIS
 * mission with at least one typed trace link.
 */
export function assertValidMissionVM(value: unknown): asserts value is MissionVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`mission view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set([
    'id',
    'version',
    'status',
    'created_at',
    'supersedes',
    'authority_ref',
    'provenance',
    'purpose',
    'goals',
    'outcomes',
    'stakeholders',
    'measures',
    'assumptions',
    'ambiguities',
    'constraints',
    'rationale',
  ]);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('mission view model must have the exact W11 field set (envelope + content + rationale)');
  }
  if (!isNonEmptyString(record['id']) || !isArtifactId(record['id'])) {
    throw new UIContractError(
      `mission view model id must be a well-formed spine artifact id, received: ${JSON.stringify(record['id'])}`,
    );
  }
  if (typeof record['version'] !== 'number' || !Number.isInteger(record['version']) || record['version'] < 1) {
    throw new UIContractError('mission view model version must be an integer >= 1');
  }
  if (!isArtifactStatus(record['status'])) {
    throw new UIContractError(
      `mission view model status must be a frozen artifact status, received: ${JSON.stringify(record['status'])}`,
    );
  }
  if (!isNonEmptyString(record['created_at'])) {
    throw new UIContractError('mission view model created_at must be a non-empty RFC3339 string');
  }
  if (record['supersedes'] !== null && !isNonEmptyString(record['supersedes'])) {
    throw new UIContractError('mission view model supersedes must be null or a non-empty artifact id');
  }
  if (record['authority_ref'] !== null && (!isNonEmptyString(record['authority_ref']) || !isArtifactId(record['authority_ref']))) {
    throw new UIContractError('mission view model authority_ref must be null or a well-formed spine id');
  }
  if (!Array.isArray(record['provenance']) || record['provenance'].length === 0 || !record['provenance'].every(isNonEmptyString)) {
    throw new UIContractError('mission view model provenance must be a non-empty array of non-empty strings');
  }
  if (!isNonEmptyString(record['purpose'])) {
    throw new UIContractError('mission view model purpose must be a non-empty string (the mission anchor)');
  }
  for (const collection of ['goals', 'outcomes', 'stakeholders', 'measures', 'assumptions', 'ambiguities', 'constraints'] as const) {
    if (!Array.isArray(record[collection])) {
      throw new UIContractError(`mission view model ${collection} must be an array`);
    }
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`mission view model rationale is invalid: ${(cause as Error).message}`);
  }
  if ((record['rationale'] as RationaleChain).subject_id !== record['id']) {
    throw new UIContractError('mission view model rationale must bind this mission id');
  }
}

/** Predicate form of assertValidMissionVM. */
export function validateMissionVM(value: unknown): value is MissionVM {
  try {
    assertValidMissionVM(value);
    return true;
  } catch {
    return false;
  }
}
