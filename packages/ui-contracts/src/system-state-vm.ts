/**
 * SystemStateVM — the system-import view model (Work Order W11).
 *
 * A pure projection of a @sos-2/system-state SystemStateArtifact plus the
 * observed ImplementationModel (@sos-2/contracts) onto display data. All
 * eight §5 section types (architecture/implementation/configuration/
 * deployment/policy/environment relationships/active experiments/package
 * realizations) are IMPORTED from @sos-2/system-state — never redefined.
 *
 * The observed-model summary carries the exact revision and component/
 * dependency counts (the numbers a human needs to see at import time);
 * the full model stays in the domain layer.
 */

import { isArtifactId, isArtifactStatus } from '@sos-2/semantic-spine';
import type { ArtifactStatus, ImplementationModel } from '@sos-2/semantic-spine';
import { isImplementationModel } from '@sos-2/semantic-spine';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { assertValidSystemStateArtifact } from '@sos-2/system-state';
import type {
  ActiveExperimentReference,
  ArchitectureReference,
  ConfigurationReference,
  DeploymentReference,
  EnvironmentRelationship,
  ImplementationReference,
  PackageRealizationReference,
  PolicyReference,
} from '@sos-2/system-state';
import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/** Compact summary of the observed implementation model at import time. */
export interface ObservedModelSummaryVM {
  /** The ImplementationModel artifact id (sos://ImplementationModel/...). */
  id: string;
  /** The exact source revision the model was extracted from. */
  revision: string;
  /** Number of normalized components. */
  component_count: number;
  /** Number of declared dependencies. */
  dependency_count: number;
}

/** The system state view model (all eight §5 sections imported verbatim). */
export interface SystemStateVM {
  id: string;
  version: number;
  status: ArtifactStatus;
  created_at: string;
  supersedes: string | null;
  provenance: string[];
  architecture_ref: ArchitectureReference;
  implementation: ImplementationReference[];
  configuration: ConfigurationReference[];
  deployment: DeploymentReference[];
  policy: PolicyReference[];
  environment_relationships: EnvironmentRelationship[];
  active_experiments: ActiveExperimentReference[];
  package_realizations: PackageRealizationReference[];
  /** The observed implementation model summary, or null when none is presented. */
  observed_model: ObservedModelSummaryVM | null;
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

/** Project a system state artifact (+ optional observed model) onto its view model. */
export function projectSystemState(
  state: SystemStateArtifact,
  observedModel: ImplementationModel | null,
  rationale: RationaleChain,
): SystemStateVM {
  assertValidSystemStateArtifact(state);
  if (observedModel !== null && !isImplementationModel(observedModel)) {
    throw new UIContractError('observed model does not match the ImplementationModel contract');
  }
  if (rationale.subject_id !== state.envelope.id) {
    throw new UIContractError(
      `rationale chain subject ${JSON.stringify(rationale.subject_id)} does not match the system state id ${JSON.stringify(state.envelope.id)}`,
    );
  }
  assertValidRationaleChain(rationale);
  const vm: SystemStateVM = {
    id: state.envelope.id,
    version: state.envelope.version,
    status: state.envelope.status,
    created_at: state.envelope.created_at,
    supersedes: state.envelope.supersedes,
    provenance: [...state.envelope.provenance],
    architecture_ref: { ...state.content.architecture_ref },
    implementation: structuredClone(state.content.implementation),
    configuration: structuredClone(state.content.configuration),
    deployment: structuredClone(state.content.deployment),
    policy: structuredClone(state.content.policy),
    environment_relationships: structuredClone(state.content.environment_relationships),
    active_experiments: structuredClone(state.content.active_experiments),
    package_realizations: structuredClone(state.content.package_realizations),
    observed_model:
      observedModel === null
        ? null
        : {
            id: observedModel.id,
            revision: observedModel.revision,
            component_count: observedModel.components.length,
            dependency_count: observedModel.dependencies.length,
          },
    rationale,
  };
  assertValidSystemStateVM(vm);
  return vm;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate a SystemStateVM (throws UIContractError). */
export function assertValidSystemStateVM(value: unknown): asserts value is SystemStateVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`system state view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set([
    'id',
    'version',
    'status',
    'created_at',
    'supersedes',
    'provenance',
    'architecture_ref',
    'implementation',
    'configuration',
    'deployment',
    'policy',
    'environment_relationships',
    'active_experiments',
    'package_realizations',
    'observed_model',
    'rationale',
  ]);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('system state view model must have the exact W11 field set (envelope + eight sections + rationale)');
  }
  if (!isNonEmptyString(record['id']) || !isArtifactId(record['id'])) {
    throw new UIContractError('system state view model id must be a well-formed spine artifact id');
  }
  if (typeof record['version'] !== 'number' || !Number.isInteger(record['version']) || record['version'] < 1) {
    throw new UIContractError('system state view model version must be an integer >= 1');
  }
  if (!isArtifactStatus(record['status'])) {
    throw new UIContractError('system state view model status must be from the frozen envelope vocabulary');
  }
  if (!isNonEmptyString(record['created_at'])) {
    throw new UIContractError('system state view model created_at must be a non-empty RFC3339 string');
  }
  if (!Array.isArray(record['provenance']) || record['provenance'].length === 0 || !record['provenance'].every(isNonEmptyString)) {
    throw new UIContractError('system state view model provenance must be a non-empty array of non-empty strings');
  }
  for (const section of [
    'implementation',
    'configuration',
    'deployment',
    'policy',
    'environment_relationships',
    'active_experiments',
    'package_realizations',
  ] as const) {
    if (!Array.isArray(record[section])) {
      throw new UIContractError(`system state view model ${section} must be an array`);
    }
  }
  if (record['observed_model'] !== null) {
    const summary = record['observed_model'] as Record<string, unknown>;
    if (!isPlainObject(summary) || Object.keys(summary).length !== 4) {
      throw new UIContractError('observed model summary must have the exact field set { id, revision, component_count, dependency_count }');
    }
    if (!isNonEmptyString(summary['id']) || !isArtifactId(summary['id'])) {
      throw new UIContractError('observed model summary id must be a well-formed spine artifact id');
    }
    if (!isNonEmptyString(summary['revision'])) {
      throw new UIContractError('observed model summary revision must be a non-empty string (the exact revision discipline)');
    }
    for (const count of ['component_count', 'dependency_count'] as const) {
      if (typeof summary[count] !== 'number' || !Number.isInteger(summary[count]) || summary[count] < 0) {
        throw new UIContractError(`observed model summary ${count} must be a non-negative integer`);
      }
    }
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`system state view model rationale is invalid: ${(cause as Error).message}`);
  }
  if ((record['rationale'] as RationaleChain).subject_id !== record['id']) {
    throw new UIContractError('system state view model rationale must bind this system state id');
  }
}

/** Predicate form of assertValidSystemStateVM. */
export function validateSystemStateVM(value: unknown): value is SystemStateVM {
  try {
    assertValidSystemStateVM(value);
    return true;
  } catch {
    return false;
  }
}
