/**
 * Implementation Model — typed structure per spec/architecture.md §5:
 * "source artifacts, interfaces, dependency graph, tests, builds, deployments
 * and runtime mappings."
 *
 * Aligned 1:1 with spec/contracts/implementation-model.schema.json
 * ($id: sos://schema/implementation-model; additionalProperties: false
 * throughout; every section is required, empty arrays are permitted).
 *
 * The `components` list is the normalization layer: source artifacts are
 * grouped into components, and components may declare which declared
 * ArchitectureGraph node ids they (partially) realize via `realizes`.
 */

export interface ImplementationComponent {
  /** Stable component id within the model (e.g. "auth-service"). */
  id: string;
  /** Observed component kind (e.g. "service", "library", "datastore"). */
  kind: string;
  /** Source artifact paths that realize this component. */
  realized_by: string[];
  /** Declared ArchitectureGraph node ids this component (partially) realizes. */
  realizes: string[];
}

export interface SourceArtifact {
  /** Repository-relative path. */
  path: string;
  /** Exact revision of the artifact. */
  revision: string;
}

export interface InterfaceDeclaration {
  /** Interface id (e.g. "iface:auth-api"). */
  id: string;
  /** Implementing component id. */
  provider: string;
  /** Reference to the contract this interface exposes, or null. */
  contract_ref: string | null;
  /** Component ids consuming this interface. */
  consumers: string[];
}

export interface ImplementationDependency {
  /** Source component id. */
  source: string;
  /** Target component id. */
  target: string;
  /** Dependency kind (e.g. "uses", "imports"). */
  kind: string;
}

export interface TestRef {
  /** Test id (artifact id or locally-scoped id). */
  id: string;
  /** Subject the test covers (component id, interface id, or artifact path). */
  subject: string;
  /** Test framework, or null. */
  framework: string | null;
}

export interface BuildRef {
  /** Build id. */
  id: string;
  /** Exact source revision the build was produced from. */
  source_revision: string;
  /** Build outputs. */
  outputs: string[];
  /** Whether the build is reproducible from the exact revision. */
  reproducible: boolean;
}

export interface DeploymentRef {
  /** Deployment id. */
  id: string;
  /** Deployed build id. */
  build_id: string;
  /** Environment (e.g. "production"). */
  environment: string;
  /** Exact deployed revision. */
  revision: string;
}

export interface RuntimeMapping {
  /** Mapping id. */
  id: string;
  /** Component id. */
  component: string;
  /** Runtime reference (URL, process, queue, ...). */
  runtime_ref: string;
  /** Environment (e.g. "production"). */
  environment: string;
}

export interface ImplementationModel {
  /** ImplementationModel artifact id (sos://ImplementationModel/<segment>). */
  id: string;
  /** Exact source revision this model was extracted from. */
  revision: string;
  /** Normalized components (the unit compared against declared architecture). */
  components: ImplementationComponent[];
  /** Source artifacts. */
  source_artifacts: SourceArtifact[];
  /** Interfaces. */
  interfaces: InterfaceDeclaration[];
  /** Dependency graph. */
  dependencies: ImplementationDependency[];
  /** Tests. */
  tests: TestRef[];
  /** Builds. */
  builds: BuildRef[];
  /** Deployments. */
  deployments: DeploymentRef[];
  /** Runtime mappings. */
  runtime_mappings: RuntimeMapping[];
}

export function isImplementationComponent(value: unknown): value is ImplementationComponent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    !['id', 'kind', 'realized_by', 'realizes'].every((key) =>
      Object.prototype.hasOwnProperty.call(record, key),
    )
  ) {
    return false;
  }
  if (Object.keys(record).length !== 4) {
    return false;
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return false;
  }
  if (typeof record.kind !== 'string' || record.kind.length === 0) {
    return false;
  }
  for (const key of ['realized_by', 'realizes'] as const) {
    const list = record[key];
    if (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string')) {
      return false;
    }
  }
  return true;
}

export function isSourceArtifact(value: unknown): value is SourceArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    return false;
  }
  if (typeof record.path !== 'string' || record.path.length === 0) {
    return false;
  }
  if (typeof record.revision !== 'string' || record.revision.length === 0) {
    return false;
  }
  return true;
}

export function isInterfaceDeclaration(value: unknown): value is InterfaceDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    !['id', 'provider', 'contract_ref', 'consumers'].every((key) =>
      Object.prototype.hasOwnProperty.call(record, key),
    )
  ) {
    return false;
  }
  if (Object.keys(record).length !== 4) {
    return false;
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return false;
  }
  if (typeof record.provider !== 'string' || record.provider.length === 0) {
    return false;
  }
  if (record.contract_ref !== null && (typeof record.contract_ref !== 'string' || record.contract_ref.length === 0)) {
    return false;
  }
  if (!Array.isArray(record.consumers) || !record.consumers.every((entry) => typeof entry === 'string')) {
    return false;
  }
  return true;
}

export function isImplementationDependency(value: unknown): value is ImplementationDependency {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) {
    return false;
  }
  if (typeof record.source !== 'string' || record.source.length === 0) {
    return false;
  }
  if (typeof record.target !== 'string' || record.target.length === 0) {
    return false;
  }
  if (typeof record.kind !== 'string' || record.kind.length === 0) {
    return false;
  }
  return true;
}

export function isTestRef(value: unknown): value is TestRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) {
    return false;
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return false;
  }
  if (typeof record.subject !== 'string' || record.subject.length === 0) {
    return false;
  }
  if (record.framework !== null && (typeof record.framework !== 'string' || record.framework.length === 0)) {
    return false;
  }
  return true;
}

export function isBuildRef(value: unknown): value is BuildRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    !['id', 'source_revision', 'outputs', 'reproducible'].every((key) =>
      Object.prototype.hasOwnProperty.call(record, key),
    )
  ) {
    return false;
  }
  if (Object.keys(record).length !== 4) {
    return false;
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return false;
  }
  if (typeof record.source_revision !== 'string' || record.source_revision.length === 0) {
    return false;
  }
  if (!Array.isArray(record.outputs) || !record.outputs.every((entry) => typeof entry === 'string')) {
    return false;
  }
  if (typeof record.reproducible !== 'boolean') {
    return false;
  }
  return true;
}

export function isDeploymentRef(value: unknown): value is DeploymentRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4) {
    return false;
  }
  for (const key of ['id', 'build_id', 'environment', 'revision'] as const) {
    if (typeof record[key] !== 'string' || (record[key] as string).length === 0) {
      return false;
    }
  }
  return true;
}

export function isRuntimeMapping(value: unknown): value is RuntimeMapping {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4) {
    return false;
  }
  for (const key of ['id', 'component', 'runtime_ref', 'environment'] as const) {
    if (typeof record[key] !== 'string' || (record[key] as string).length === 0) {
      return false;
    }
  }
  return true;
}

export function isImplementationModel(value: unknown): value is ImplementationModel {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const requiredKeys = [
    'id',
    'revision',
    'components',
    'source_artifacts',
    'interfaces',
    'dependencies',
    'tests',
    'builds',
    'deployments',
    'runtime_mappings',
  ] as const;
  if (
    !requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  ) {
    return false;
  }
  if (Object.keys(record).length !== requiredKeys.length) {
    return false;
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return false;
  }
  if (typeof record.revision !== 'string' || record.revision.length === 0) {
    return false;
  }
  if (!Array.isArray(record.components) || !record.components.every(isImplementationComponent)) {
    return false;
  }
  if (!Array.isArray(record.source_artifacts) || !record.source_artifacts.every(isSourceArtifact)) {
    return false;
  }
  if (!Array.isArray(record.interfaces) || !record.interfaces.every(isInterfaceDeclaration)) {
    return false;
  }
  if (!Array.isArray(record.dependencies) || !record.dependencies.every(isImplementationDependency)) {
    return false;
  }
  if (!Array.isArray(record.tests) || !record.tests.every(isTestRef)) {
    return false;
  }
  if (!Array.isArray(record.builds) || !record.builds.every(isBuildRef)) {
    return false;
  }
  if (!Array.isArray(record.deployments) || !record.deployments.every(isDeploymentRef)) {
    return false;
  }
  if (!Array.isArray(record.runtime_mappings) || !record.runtime_mappings.every(isRuntimeMapping)) {
    return false;
  }
  return true;
}
