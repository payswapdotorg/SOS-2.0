/**
 * Brownfield snapshot — the EXISTING-SYSTEM evidence contract (W15 stage 1
 * input): a source tree descriptor (modules), a dependency graph, runtime
 * observations (golden fixtures) and OTel-shaped telemetry traces, plus the
 * deterministic normalization into the spine ImplementationModel contract.
 *
 * EXPORT DISCIPLINE (binding): the ImplementationModel contract, its guard
 * and artifact-id minting come from @sos-2/semantic-spine; raw observation
 * and OTel shapes from @sos-2/telemetry. Nothing is duplicated here — this
 * module only VALIDATES fixture input and PROJECTS it onto the merged
 * contracts (orchestration, never a second authority).
 *
 * DETERMINISM: normalization sorts every section canonically, so a snapshot
 * with the same content in any order produces the byte-identical model (and
 * therefore the same deterministic model id).
 */

import {
  deriveDeterministicArtifactId,
  isImplementationModel,
} from '@sos-2/semantic-spine';
import type { ImplementationModel, ImplementationComponent, InterfaceDeclaration, ImplementationDependency } from '@sos-2/semantic-spine';
import { assertValidRawObservation, rawObservationHash } from '@sos-2/telemetry';
import type { OtelBatch, RawObservation } from '@sos-2/telemetry';
import { BrownfieldError } from './errors.js';

/** Node-id shape accepted by recovery/conformance projections (W2/W4 convention). */
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** One module of the legacy source tree (a component of the existing system). */
export interface BrownfieldModule {
  /** Component id (node-id shaped, unique — e.g. "legacy-catalog"). */
  id: string;
  /** Observed implementation kind (e.g. "service", "library", "datastore"). */
  kind: string;
  /** Source path of the module inside the legacy tree. */
  path: string;
  /** Exact revision of this module's source artifact. */
  revision: string;
  /** Declared ArchitectureGraph node ids this module (partially) realizes. */
  realizes: string[];
  /** Additional source paths realizing this module beyond `path`. */
  realized_by: string[];
}

/** The golden existing-system snapshot (pure JSON, caller-supplied). */
export interface BrownfieldSnapshot {
  /** Human-readable name of the legacy system. */
  system_name: string;
  /** The exact source revision of the observed tree (git sha). */
  revision: string;
  /** RFC3339 capture instant (caller-supplied; no hidden clocks). */
  created_at: string;
  /** The source tree descriptor (>= 1 module). */
  modules: BrownfieldModule[];
  /** Observed interface declarations. */
  interfaces: InterfaceDeclaration[];
  /** The observed dependency graph. */
  dependencies: ImplementationDependency[];
  /** Structural runtime observations (golden fixtures; subject_ref = module id). */
  runtime_observations: RawObservation[];
  /** OTel-shaped telemetry traces of the running legacy system (golden fixtures). */
  telemetry_traces: OtelBatch;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

/** Validate a brownfield snapshot (throws BrownfieldError). */
export function assertValidBrownfieldSnapshot(value: unknown): asserts value is BrownfieldSnapshot {
  if (!isPlainObject(value)) {
    throw new BrownfieldError('INVALID_SNAPSHOT', 'snapshot must be a plain object');
  }
  const snapshot = value as Record<string, unknown>;
  for (const field of ['system_name', 'revision', 'created_at', 'modules', 'interfaces', 'dependencies', 'runtime_observations', 'telemetry_traces'] as const) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, field)) {
      throw new BrownfieldError('INVALID_SNAPSHOT', `snapshot is missing the required field "${field}"`);
    }
  }
  if (!isNonEmptyString(snapshot['system_name'])) {
    throw new BrownfieldError('INVALID_SNAPSHOT', 'snapshot.system_name must be a non-empty string');
  }
  if (!isNonEmptyString(snapshot['revision'])) {
    throw new BrownfieldError('INVALID_SNAPSHOT', 'snapshot.revision must be a non-empty string (exact revisions only)');
  }
  if (!isNonEmptyString(snapshot['created_at'])) {
    throw new BrownfieldError('INVALID_SNAPSHOT', 'snapshot.created_at must be a non-empty RFC3339 string');
  }
  if (!Array.isArray(snapshot['modules']) || snapshot['modules'].length === 0) {
    throw new BrownfieldError('INVALID_SNAPSHOT', 'snapshot.modules must be a non-empty array (a brownfield system has at least one module)');
  }
  const moduleIds = new Set<string>();
  const paths = new Set<string>();
  for (const rawModule of snapshot['modules']) {
    if (!isPlainObject(rawModule)) {
      throw new BrownfieldError('INVALID_SNAPSHOT', 'every snapshot module must be an object');
    }
    for (const field of ['id', 'kind', 'path', 'revision', 'realizes', 'realized_by'] as const) {
      if (!Object.prototype.hasOwnProperty.call(rawModule, field)) {
        throw new BrownfieldError('INVALID_SNAPSHOT', `module is missing the required field "${field}"`);
      }
    }
    if (!isNonEmptyString(rawModule['id']) || !NODE_ID_PATTERN.test(rawModule['id'])) {
      throw new BrownfieldError(
        'INVALID_SNAPSHOT',
        `module.id must be node-id shaped (letters, digits, ".", "_", ":", "-"), received: ${JSON.stringify(rawModule['id'])}`,
      );
    }
    if (moduleIds.has(rawModule['id'])) {
      throw new BrownfieldError('INVALID_SNAPSHOT', `duplicate module id: ${JSON.stringify(rawModule['id'])}`);
    }
    moduleIds.add(rawModule['id']);
    if (!isNonEmptyString(rawModule['kind'])) {
      throw new BrownfieldError('INVALID_SNAPSHOT', `module.kind must be a non-empty string, received: ${JSON.stringify(rawModule['kind'])}`);
    }
    if (!isNonEmptyString(rawModule['path'])) {
      throw new BrownfieldError('INVALID_SNAPSHOT', `module.path must be a non-empty string, received: ${JSON.stringify(rawModule['path'])}`);
    }
    if (!isNonEmptyString(rawModule['revision'])) {
      throw new BrownfieldError('INVALID_SNAPSHOT', 'module.revision must be a non-empty string (exact revisions only)');
    }
    if (paths.has(rawModule['path'])) {
      throw new BrownfieldError('INVALID_SNAPSHOT', `duplicate module path: ${JSON.stringify(rawModule['path'])}`);
    }
    paths.add(rawModule['path']);
    if (!isStringArray(rawModule['realizes']) || !isStringArray(rawModule['realized_by'])) {
      throw new BrownfieldError('INVALID_SNAPSHOT', 'module.realizes and module.realized_by must be arrays of non-empty strings');
    }
  }
  if (!Array.isArray(snapshot['interfaces']) || !Array.isArray(snapshot['dependencies'])) {
    throw new BrownfieldError('INVALID_SNAPSHOT', 'snapshot.interfaces and snapshot.dependencies must be arrays');
  }
  const interfaceIds = new Set<string>();
  for (const rawInterface of snapshot['interfaces']) {
    if (!isPlainObject(rawInterface)) {
      throw new BrownfieldError('INVALID_SNAPSHOT', 'every snapshot interface must be an object');
    }
    const interfaceId = rawInterface['id'];
    if (!isNonEmptyString(interfaceId) || interfaceIds.has(interfaceId)) {
      throw new BrownfieldError('INVALID_SNAPSHOT', `interface ids must be non-empty and unique, received: ${JSON.stringify(interfaceId)}`);
    }
    interfaceIds.add(interfaceId);
    if (!isNonEmptyString(rawInterface['provider']) || !moduleIds.has(rawInterface['provider'])) {
      throw new BrownfieldError('INVALID_SNAPSHOT', `interface ${JSON.stringify(interfaceId)} provider must be a declared module id`);
    }
  }
  const seenDependencyPairs = new Set<string>();
  for (const rawDependency of snapshot['dependencies']) {
    if (!isPlainObject(rawDependency)) {
      throw new BrownfieldError('INVALID_SNAPSHOT', 'every snapshot dependency must be an object { source, target, kind }');
    }
    if (!isNonEmptyString(rawDependency['source']) || !isNonEmptyString(rawDependency['target']) || !isNonEmptyString(rawDependency['kind'])) {
      throw new BrownfieldError('INVALID_SNAPSHOT', 'dependency source, target and kind must be non-empty strings');
    }
    if (!NODE_ID_PATTERN.test(rawDependency['source']) || !NODE_ID_PATTERN.test(rawDependency['target'])) {
      throw new BrownfieldError('INVALID_SNAPSHOT', 'dependency endpoints must be node-id shaped');
    }
    const pair = `${rawDependency['source']}->${rawDependency['target']}`;
    if (seenDependencyPairs.has(pair)) {
      throw new BrownfieldError('INVALID_SNAPSHOT', `duplicate dependency pair: ${pair}`);
    }
    seenDependencyPairs.add(pair);
  }
  if (!Array.isArray(snapshot['runtime_observations'])) {
    throw new BrownfieldError('INVALID_SNAPSHOT', 'snapshot.runtime_observations must be an array of raw observations');
  }
  for (const observation of snapshot['runtime_observations']) {
    try {
      assertValidRawObservation(observation);
    } catch (cause) {
      throw new BrownfieldError('INVALID_SNAPSHOT', `runtime observation is invalid: ${(cause as Error).message}`);
    }
    if (!moduleIds.has((observation as RawObservation).subject_ref)) {
      throw new BrownfieldError(
        'INVALID_SNAPSHOT',
        `runtime observation subject "${(observation as RawObservation).subject_ref}" is not a declared module id (the structural runtime view is keyed by module id)`,
      );
    }
  }
  if (!isPlainObject(snapshot['telemetry_traces'])) {
    throw new BrownfieldError('INVALID_SNAPSHOT', 'snapshot.telemetry_traces must be an OTel batch object');
  }
}

/**
 * Deterministically mint the ImplementationModel id for a snapshot.
 * Content-addressed over the canonically sorted source tree + dependency
 * graph, so identical content in any input order yields the same id.
 */
export function implementationModelId(snapshot: BrownfieldSnapshot): string {
  return deriveDeterministicArtifactId('ImplementationModel', {
    note: 'w15 brownfield normalized implementation model',
    system_name: snapshot.system_name,
    revision: snapshot.revision,
    modules: [...snapshot.modules]
      .map((module) => ({ id: module.id, kind: module.kind, path: module.path, revision: module.revision, realizes: [...module.realizes].sort(), realized_by: [...module.realized_by].sort() }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    interfaces: [...snapshot.interfaces].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    dependencies: [...snapshot.dependencies].sort(
      (a, b) =>
        a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : a.kind < b.kind ? -1 : 1,
    ),
  });
}

/**
 * Normalize a snapshot into the spine ImplementationModel contract
 * (deterministic; canonically sorted sections; deterministic id).
 */
export function normalizeSnapshot(snapshot: BrownfieldSnapshot): ImplementationModel {
  assertValidBrownfieldSnapshot(snapshot);
  const id = implementationModelId(snapshot);
  const components: ImplementationComponent[] = [...snapshot.modules]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((module) => ({
      id: module.id,
      kind: module.kind,
      realized_by: [module.path, ...module.realized_by].sort(),
      realizes: [...module.realizes].sort(),
    }));
  const source_artifacts = [...snapshot.modules]
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((module) => ({ path: module.path, revision: module.revision }));
  const model: ImplementationModel = {
    id,
    revision: snapshot.revision,
    components,
    source_artifacts,
    interfaces: [...snapshot.interfaces].sort((a, b) => (a.id < b.id ? -1 : 1)),
    dependencies: [...snapshot.dependencies].sort(
      (a, b) =>
        a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : a.kind < b.kind ? -1 : 1,
    ),
    tests: [],
    builds: [],
    deployments: [],
    runtime_mappings: [...snapshot.modules]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((module) => ({ id: `runtime:${module.id}`, component: module.id, runtime_ref: module.path, environment: 'production' })),
  };
  if (!isImplementationModel(model)) {
    throw new BrownfieldError('INVALID_SNAPSHOT', 'normalized model does not satisfy the spine ImplementationModel contract');
  }
  return model;
}

/**
 * Sort raw observations canonically (by content hash, then by canonical
 * text) so telemetry-derived digests are order-independent.
 */
export function sortObservations(observations: readonly RawObservation[]): RawObservation[] {
  return [...observations].sort((a, b) => {
    const hashA = rawObservationHash(a);
    const hashB = rawObservationHash(b);
    return hashA < hashB ? -1 : hashA > hashB ? 1 : 0;
  });
}

/** Deterministic digest over a set of raw observations (order-independent). */
export function observationsDigest(observations: readonly RawObservation[]): string {
  const hashes = sortObservations(observations).map((observation) => rawObservationHash(observation));
  const combined = hashes.length === 0 ? 'empty' : hashes.join(',');
  let hash = 5381;
  for (let index = 0; index < combined.length; index += 1) {
    hash = ((hash << 5) + hash + combined.charCodeAt(index)) | 0;
  }
  return `obs:${(hash >>> 0).toString(16).padStart(8, '0')}:${hashes.length}`;
}
