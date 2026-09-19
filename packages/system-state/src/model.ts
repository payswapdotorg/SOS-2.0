/**
 * System State content — typed realization of spec/architecture.md §5:
 *
 *     "System State: architecture, implementation, configuration, deployment,
 *      policy, environment relationships, active experiments and package
 *      realizations."
 *
 * The content has the EXACT eight-section field set above (closed set; the
 * section names follow the spec sentence 1:1). Guard discipline mirrors
 * @sos-2/contracts: guards never accept anything the W2 contract rejects and
 * never reject anything a legitimate SOS SystemState needs.
 *
 * Exact-revision discipline (W2 acceptance): implementation, deployment and
 * configuration references each carry an ExactRevision of the matching frozen
 * kind. Missing or empty revisions make the SystemState INVALID.
 *
 * Environment relationships use a small typed, extensible registry (same
 * registry API pattern as the spine's artifact kinds, kebab-case vocabulary
 * instead of PascalCase).
 */

import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import { SystemStateError } from './errors.js';
import {
  CONFIGURATION_REVISION_KIND,
  DEPLOYMENT_REVISION_KIND,
  IMPLEMENTATION_REVISION_KIND,
  assertExactRevision,
  assertRevisionKind,
  isRevisionKind,
} from './revision.js';
import type { ExactRevision } from './revision.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function requireNonEmptyStringArray(value: unknown, field: string): void {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new SystemStateError(`${field} must be an array of non-empty strings`);
  }
}

function requireExactFieldSet(record: Record<string, unknown>, keys: readonly string[], field: string): void {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new SystemStateError(`${field} must have the exact field set { ${keys.join(', ')} }`);
  }
}

function assertArtifactIdOfKind(value: unknown, field: string, expectedKind: string): void {
  if (!isArtifactId(value)) {
    throw new SystemStateError(`${field} must be a well-formed artifact id, received: ${JSON.stringify(value)}`);
  }
  const parsed = parseArtifactId(value as string);
  if (parsed.kind !== expectedKind) {
    throw new SystemStateError(
      `${field} must be a sos://${expectedKind}/ artifact id, received kind "${parsed.kind}"`,
    );
  }
}

function assertVersionInteger(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new SystemStateError(`${field} must be an integer >= 1, received: ${String(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Environment relationship kinds (typed, extensible registry)
// ---------------------------------------------------------------------------

/** Kebab-case relationship kind names. */
export const ENV_RELATIONSHIP_KIND_PATTERN = /^[a-z][a-z0-9-]*$/;

export const CORE_ENV_RELATIONSHIP_KINDS = [
  'depends-on',
  'promotes-to',
  'mirrors',
  'isolated-from',
] as const;

export type CoreEnvRelationshipKind = (typeof CORE_ENV_RELATIONSHIP_KINDS)[number];

export type EnvRelationshipKind = CoreEnvRelationshipKind | (string & {});

export interface EnvRelationshipKindRegistry {
  /** Register a new relationship kind. Throws on invalid format or duplicates. */
  register(kind: string): void;
  isRegistered(kind: string): boolean;
  /** Sorted list of registered kinds (deterministic). */
  list(): string[];
}

export function createEnvRelationshipKindRegistry(
  seed: readonly string[] = CORE_ENV_RELATIONSHIP_KINDS,
): EnvRelationshipKindRegistry {
  const kinds = new Set<string>(seed);
  return {
    register(kind: string): void {
      if (typeof kind !== 'string' || !ENV_RELATIONSHIP_KIND_PATTERN.test(kind)) {
        throw new SystemStateError(
          `invalid environment relationship kind: ${JSON.stringify(kind)} (expected kebab-case, e.g. "depends-on")`,
        );
      }
      if (kinds.has(kind)) {
        throw new SystemStateError(`environment relationship kind already registered: ${kind}`);
      }
      kinds.add(kind);
    },
    isRegistered(kind: string): boolean {
      return kinds.has(kind);
    },
    list(): string[] {
      return [...kinds].sort();
    },
  };
}

/**
 * The default (process-wide) registry, seeded with the four canonical kinds.
 * Downstream Work Orders register extensions here, or build isolated
 * registries with `createEnvRelationshipKindRegistry`.
 */
const defaultEnvRegistry: EnvRelationshipKindRegistry = createEnvRelationshipKindRegistry();

export function registerEnvRelationshipKind(kind: string): void {
  defaultEnvRegistry.register(kind);
}

export function isRegisteredEnvRelationshipKind(kind: string): boolean {
  return defaultEnvRegistry.isRegistered(kind);
}

export function listEnvRelationshipKinds(): string[] {
  return defaultEnvRegistry.list();
}

// ---------------------------------------------------------------------------
// Reference types (one per §5 section)
// ---------------------------------------------------------------------------

/** Reference to the ArchitectureGraph artifact this SystemState is observed against. */
export interface ArchitectureReference {
  /** sos://ArchitectureGraph/<segment> artifact id. */
  artifact_id: string;
  /** Envelope version of the referenced architecture revision. */
  version: number;
}

/**
 * Reference to an EXACT SystemState revision — the anchor an
 * ArchitectureGraph hypothesis projects (spec/architecture.md section 6:
 * "Architecture is a versioned projection/hypothesis over System State").
 * Consumed by @sos-2/architecture.
 */
export interface SystemStateRevisionRef {
  /** sos://SystemState/<segment> artifact id. */
  system_state_id: string;
  /** Envelope version of the referenced SystemState revision. */
  version: number;
}

export function isSystemStateRevisionRef(value: unknown): value is SystemStateRevisionRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    return false;
  }
  if (!isNonEmptyString(record.system_state_id) || !isArtifactId(record.system_state_id)) {
    return false;
  }
  const parsed = parseArtifactId(record.system_state_id);
  if (parsed.kind !== 'SystemState') {
    return false;
  }
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) {
    return false;
  }
  return true;
}

export function isArchitectureReference(value: unknown): value is ArchitectureReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    return false;
  }
  if (!isNonEmptyString(record.artifact_id) || !isArtifactId(record.artifact_id)) {
    return false;
  }
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) {
    return false;
  }
  return true;
}

/** Implementation reference with an EXACT git-sha revision. */
export interface ImplementationReference {
  /** sos://ImplementationModel/<segment> artifact id. */
  artifact_id: string;
  /** Exact source revision (kind must be "git-sha"). */
  revision: ExactRevision;
}

export function isImplementationReference(value: unknown): value is ImplementationReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    return false;
  }
  if (!isNonEmptyString(record.artifact_id) || !isArtifactId(record.artifact_id)) {
    return false;
  }
  const parsed = parseArtifactId(record.artifact_id);
  if (parsed.kind !== 'ImplementationModel') {
    return false;
  }
  return (
    typeof record.revision === 'object' &&
    record.revision !== null &&
    isRevisionKind((record.revision as { kind?: unknown }).kind) &&
    (record.revision as { kind?: unknown }).kind === 'git-sha' &&
    isNonEmptyString((record.revision as { value?: unknown }).value)
  );
}

/** Configuration reference with an EXACT config-version revision. */
export interface ConfigurationReference {
  /** Configuration identifier (e.g. "checkout-config"). */
  config_id: string;
  /** Exact configuration version (kind must be "config-version"). */
  revision: ExactRevision;
}

export function isConfigurationReference(value: unknown): value is ConfigurationReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    return false;
  }
  if (!isNonEmptyString(record.config_id)) {
    return false;
  }
  const revision = record.revision as { kind?: unknown; value?: unknown } | undefined;
  return (
    revision !== null &&
    typeof revision === 'object' &&
    revision.kind === 'config-version' &&
    isNonEmptyString(revision.value)
  );
}

/** Deployment reference with an EXACT deployment-id revision. */
export interface DeploymentReference {
  /** Deployment identifier (e.g. "deploy-prod-2025-06-01"). */
  deployment_id: string;
  /** Environment (e.g. "production"). */
  environment: string;
  /** Exact deployment revision (kind must be "deployment-id"). */
  revision: ExactRevision;
}

export function isDeploymentReference(value: unknown): value is DeploymentReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) {
    return false;
  }
  if (!isNonEmptyString(record.deployment_id) || !isNonEmptyString(record.environment)) {
    return false;
  }
  const revision = record.revision as { kind?: unknown; value?: unknown } | undefined;
  return (
    revision !== null &&
    typeof revision === 'object' &&
    revision.kind === 'deployment-id' &&
    isNonEmptyString(revision.value)
  );
}

/** Active policy reference (policies are versioned artifacts of the governance plane). */
export interface PolicyReference {
  /** Policy identifier (e.g. "deployment-policy"). */
  policy_id: string;
  /** Exact policy version (integer >= 1). */
  version: number;
}

export function isPolicyReference(value: unknown): value is PolicyReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    return false;
  }
  if (!isNonEmptyString(record.policy_id)) {
    return false;
  }
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) {
    return false;
  }
  return true;
}

/** Typed relationship between two environments (e.g. staging promotes-to production). */
export interface EnvironmentRelationship {
  /** Source environment (e.g. "staging"). */
  source: string;
  /** Target environment (e.g. "production"). */
  target: string;
  /** Registered relationship kind (see the kind registry). */
  kind: EnvRelationshipKind;
}

export function isEnvironmentRelationship(value: unknown): value is EnvironmentRelationship {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) {
    return false;
  }
  if (!isNonEmptyString(record.source) || !isNonEmptyString(record.target)) {
    return false;
  }
  if (!isNonEmptyString(record.kind) || !ENV_RELATIONSHIP_KIND_PATTERN.test(record.kind)) {
    return false;
  }
  return true;
}

/** Active experiment reference (experiments are core spine artifacts). */
export interface ActiveExperimentReference {
  /** sos://Experiment/<segment> artifact id. */
  experiment_id: string;
  /** Environment the experiment runs in (e.g. "production"). */
  environment: string;
}

export function isActiveExperimentReference(value: unknown): value is ActiveExperimentReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    return false;
  }
  if (!isNonEmptyString(record.experiment_id) || !isArtifactId(record.experiment_id)) {
    return false;
  }
  const parsed = parseArtifactId(record.experiment_id);
  if (parsed.kind !== 'Experiment') {
    return false;
  }
  return isNonEmptyString(record.environment);
}

/** Package realization reference: a validated Package realized in this system. */
export interface PackageRealizationReference {
  /** sos://Package/<segment> artifact id. */
  package_id: string;
  /** Exact package version (e.g. "1.4.0"). */
  version: string;
  /** Component ids (architecture graph nodes) that realize the package. */
  realized_by: string[];
}

export function isPackageRealizationReference(value: unknown): value is PackageRealizationReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) {
    return false;
  }
  if (!isNonEmptyString(record.package_id) || !isArtifactId(record.package_id)) {
    return false;
  }
  const parsed = parseArtifactId(record.package_id);
  if (parsed.kind !== 'Package') {
    return false;
  }
  if (!isNonEmptyString(record.version)) {
    return false;
  }
  return (
    Array.isArray(record.realized_by) && record.realized_by.every((entry) => isNonEmptyString(entry))
  );
}

// ---------------------------------------------------------------------------
// SystemState content
// ---------------------------------------------------------------------------

/** The exact eight sections of a SystemState (spec/architecture.md §5). */
export interface SystemStateContent {
  /** The architecture hypothesis this system state is observed against. */
  architecture_ref: ArchitectureReference;
  /** Implementation models in force, each with an exact git-sha revision. */
  implementation: ImplementationReference[];
  /** Configurations in force, each with an exact config-version revision. */
  configuration: ConfigurationReference[];
  /** Deployments in force, each with an exact deployment-id revision. */
  deployment: DeploymentReference[];
  /** Active policies (versioned). */
  policy: PolicyReference[];
  /** Typed relationships between environments. */
  environment_relationships: EnvironmentRelationship[];
  /** Experiments currently active in the system. */
  active_experiments: ActiveExperimentReference[];
  /** Packages realized in the system. */
  package_realizations: PackageRealizationReference[];
}

export const SYSTEM_STATE_CONTENT_KEYS = [
  'architecture_ref',
  'implementation',
  'configuration',
  'deployment',
  'policy',
  'environment_relationships',
  'active_experiments',
  'package_realizations',
] as const;

function assertNoDuplicates(items: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) {
      throw new SystemStateError(`duplicate ${field} entry: ${item}`);
    }
    seen.add(item);
  }
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SystemStateError(`${field} must be an array`);
  }
  return value;
}

/** Full semantic validation of a SystemState content (throws SystemStateError). */
export function assertValidSystemStateContent(value: unknown): asserts value is SystemStateContent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SystemStateError('system state content must be an object');
  }
  const record = value as Record<string, unknown>;
  requireExactFieldSet(record, SYSTEM_STATE_CONTENT_KEYS, 'system state content');

  // architecture_ref
  const arch = record.architecture_ref;
  if (typeof arch !== 'object' || arch === null || Array.isArray(arch)) {
    throw new SystemStateError('architecture_ref must be an object { artifact_id, version }');
  }
  const archRecord = arch as Record<string, unknown>;
  requireExactFieldSet(archRecord, ['artifact_id', 'version'], 'architecture_ref');
  assertArtifactIdOfKind(archRecord.artifact_id, 'architecture_ref.artifact_id', 'ArchitectureGraph');
  assertVersionInteger(archRecord.version, 'architecture_ref.version');

  // implementation (exact git-sha revisions)
  const implementations = requireArray(record.implementation, 'implementation');
  for (const entry of implementations) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SystemStateError('implementation entries must be objects { artifact_id, revision }');
    }
    const implRecord = entry as Record<string, unknown>;
    requireExactFieldSet(implRecord, ['artifact_id', 'revision'], 'implementation entry');
    assertArtifactIdOfKind(implRecord.artifact_id, 'implementation.artifact_id', 'ImplementationModel');
    assertExactRevision(implRecord.revision, 'implementation');
    assertRevisionKind(implRecord.revision as ExactRevision, 'implementation', IMPLEMENTATION_REVISION_KIND);
  }
  assertNoDuplicates(
    implementations.map((entry) => (entry as { artifact_id: string }).artifact_id),
    'implementation artifact_id',
  );

  // configuration (exact config-version revisions)
  const configurations = requireArray(record.configuration, 'configuration');
  for (const entry of configurations) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SystemStateError('configuration entries must be objects { config_id, revision }');
    }
    const configRecord = entry as Record<string, unknown>;
    requireExactFieldSet(configRecord, ['config_id', 'revision'], 'configuration entry');
    if (!isNonEmptyString(configRecord.config_id)) {
      throw new SystemStateError('configuration.config_id must be a non-empty string');
    }
    assertExactRevision(configRecord.revision, 'configuration');
    assertRevisionKind(configRecord.revision as ExactRevision, 'configuration', CONFIGURATION_REVISION_KIND);
  }
  assertNoDuplicates(
    configurations.map((entry) => (entry as { config_id: string }).config_id),
    'configuration config_id',
  );

  // deployment (exact deployment-id revisions)
  const deployments = requireArray(record.deployment, 'deployment');
  for (const entry of deployments) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SystemStateError('deployment entries must be objects { deployment_id, environment, revision }');
    }
    const deployRecord = entry as Record<string, unknown>;
    requireExactFieldSet(deployRecord, ['deployment_id', 'environment', 'revision'], 'deployment entry');
    if (!isNonEmptyString(deployRecord.deployment_id)) {
      throw new SystemStateError('deployment.deployment_id must be a non-empty string');
    }
    if (!isNonEmptyString(deployRecord.environment)) {
      throw new SystemStateError('deployment.environment must be a non-empty string');
    }
    assertExactRevision(deployRecord.revision, 'deployment');
    assertRevisionKind(deployRecord.revision as ExactRevision, 'deployment', DEPLOYMENT_REVISION_KIND);
  }
  assertNoDuplicates(
    deployments.map((entry) => (entry as { deployment_id: string }).deployment_id),
    'deployment deployment_id',
  );

  // policy
  const policies = requireArray(record.policy, 'policy');
  for (const entry of policies) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SystemStateError('policy entries must be objects { policy_id, version }');
    }
    const policyRecord = entry as Record<string, unknown>;
    requireExactFieldSet(policyRecord, ['policy_id', 'version'], 'policy entry');
    if (!isNonEmptyString(policyRecord.policy_id)) {
      throw new SystemStateError('policy.policy_id must be a non-empty string');
    }
    assertVersionInteger(policyRecord.version, 'policy.version');
  }
  assertNoDuplicates(
    policies.map((entry) => (entry as { policy_id: string }).policy_id),
    'policy policy_id',
  );

  // environment_relationships
  const relationships = requireArray(record.environment_relationships, 'environment_relationships');
  for (const entry of relationships) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SystemStateError('environment_relationships entries must be objects { source, target, kind }');
    }
    const relRecord = entry as Record<string, unknown>;
    requireExactFieldSet(relRecord, ['source', 'target', 'kind'], 'environment_relationships entry');
    if (!isNonEmptyString(relRecord.source)) {
      throw new SystemStateError('environment_relationships.source must be a non-empty string');
    }
    if (!isNonEmptyString(relRecord.target)) {
      throw new SystemStateError('environment_relationships.target must be a non-empty string');
    }
    if (!isNonEmptyString(relRecord.kind)) {
      throw new SystemStateError('environment_relationships.kind must be a non-empty string');
    }
    if (!ENV_RELATIONSHIP_KIND_PATTERN.test(relRecord.kind as string)) {
      throw new SystemStateError(
        `environment_relationships.kind must be kebab-case, received: ${JSON.stringify(relRecord.kind)}`,
      );
    }
    if (!defaultEnvRegistry.isRegistered(relRecord.kind as string)) {
      throw new SystemStateError(
        `environment_relationships.kind is not registered: ${JSON.stringify(relRecord.kind)} ` +
          `(register extensions via registerEnvRelationshipKind first)`,
      );
    }
  }
  assertNoDuplicates(
    relationships.map((entry) => {
      const rel = entry as { source: string; target: string; kind: string };
      return `${rel.source}->${rel.target}->${rel.kind}`;
    }),
    'environment_relationships (source,target,kind)',
  );

  // active_experiments
  const experiments = requireArray(record.active_experiments, 'active_experiments');
  for (const entry of experiments) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SystemStateError('active_experiments entries must be objects { experiment_id, environment }');
    }
    const expRecord = entry as Record<string, unknown>;
    requireExactFieldSet(expRecord, ['experiment_id', 'environment'], 'active_experiments entry');
    assertArtifactIdOfKind(expRecord.experiment_id, 'active_experiments.experiment_id', 'Experiment');
    if (!isNonEmptyString(expRecord.environment)) {
      throw new SystemStateError('active_experiments.environment must be a non-empty string');
    }
  }
  assertNoDuplicates(
    experiments.map((entry) => (entry as { experiment_id: string }).experiment_id),
    'active_experiments experiment_id',
  );

  // package_realizations
  const packages = requireArray(record.package_realizations, 'package_realizations');
  for (const entry of packages) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SystemStateError(
        'package_realizations entries must be objects { package_id, version, realized_by }',
      );
    }
    const pkgRecord = entry as Record<string, unknown>;
    requireExactFieldSet(pkgRecord, ['package_id', 'version', 'realized_by'], 'package_realizations entry');
    assertArtifactIdOfKind(pkgRecord.package_id, 'package_realizations.package_id', 'Package');
    if (!isNonEmptyString(pkgRecord.version)) {
      throw new SystemStateError('package_realizations.version must be a non-empty string');
    }
    requireNonEmptyStringArray(pkgRecord.realized_by, 'package_realizations.realized_by');
  }
  assertNoDuplicates(
    packages.map((entry) => (entry as { package_id: string }).package_id),
    'package_realizations package_id',
  );
}

/** Predicate form of assertValidSystemStateContent. */
export function validateSystemStateContent(value: unknown): value is SystemStateContent {
  try {
    assertValidSystemStateContent(value);
    return true;
  } catch {
    return false;
  }
}
