/**
 * Runtime capability envelopes and the bounded-environment description
 * (Work Order P5).
 *
 * A RUNTIME CAPABILITY ENVELOPE describes one runtime/cloud capability a
 * harness/body can integrate: its operation vocabulary plus the candidate
 * integration surfaces (one per §4 tier that exists for it).
 *
 * The BOUNDED-ENVIRONMENT DESCRIPTION describes the environment a body or
 * runtime integration executes within — filesystem scope, network egress
 * policy, isolation level, resource limits and the environment variable
 * NAMES the environment exposes. NAMES ONLY, never values: secret values
 * are never echoed, logged or serialized (mirroring the P3 environment
 * contract and secret policy discipline — this package performs NO
 * ambient process.env reads; callers inject descriptions as data).
 *
 * The vocabulary mirrors §3 of the execution architecture ("isolation
 * level, network policy, filesystem scope ... cost and resource
 * envelope"). The P3 body-provider configuration vocabulary
 * (@sos-2/infra-deployment) mirrors the SAME spec list as an independent
 * typed vocabulary — alignment is by spec, import is deliberately absent
 * (the P3 structural-isolation precedent), and both vocabularies are
 * pinned to the §3 surfaces by their own tests.
 */

import { InvalidRuntimeContractError } from './errors.js';
import { assertValidRuntimeIdentifier } from './identifiers.js';
import type { RuntimeIntegration } from './integration-tiers.js';
import { assertValidRuntimeIntegration } from './integration-tiers.js';

/** Isolation levels, weakest to strongest (mirrors §3; aligned with P3 by spec). */
export const ISOLATION_LEVELS = ['none', 'process', 'container', 'vm', 'account'] as const;
export type IsolationLevel = (typeof ISOLATION_LEVELS)[number];

/** Network egress policy (mirrors §3 "network policy"). */
export type NetworkEgressPolicy =
  | { readonly egress: 'none' }
  | { readonly egress: 'allowlist'; readonly allowedHosts: readonly string[] }
  | { readonly egress: 'open' };

/** Filesystem scope modes (mirrors §3 "filesystem scope"). */
export const FILESYSTEM_MODES = ['none', 'workspace', 'sandboxed-tree', 'host'] as const;
export type FilesystemMode = (typeof FILESYSTEM_MODES)[number];

const ISOLATION_LEVEL_SET: ReadonlySet<string> = new Set(ISOLATION_LEVELS);
const FILESYSTEM_MODE_SET: ReadonlySet<string> = new Set(FILESYSTEM_MODES);

/** Hard bound on any bounded-environment duration (aligned with P3's 24h limit by spec). */
export const BOUNDED_ENVIRONMENT_MAX_DURATION_MS = 24 * 60 * 60_000;

/**
 * The bounded-environment description: what an execution environment
 * looks like, as injectable DATA (no ambient reads anywhere).
 */
export interface BoundedEnvironmentDescription {
  /** Filesystem scope (mode + root, when scoped). */
  readonly filesystem: { readonly mode: FilesystemMode; readonly root: string | null };
  /** Network egress policy. */
  readonly network: NetworkEgressPolicy;
  /** Isolation level. */
  readonly isolation: IsolationLevel;
  /** Resource limits (positive, bounded durations). */
  readonly limits: { readonly maxDurationMs: number; readonly maxMemoryMb: number | null };
  /**
   * Environment variable NAMES the environment exposes — never values
   * (secret values are never echoed, logged or serialized).
   */
  readonly environmentVariables: readonly string[];
}

/**
 * The runtime capability envelope: one runtime/cloud capability with its
 * operation vocabulary and its candidate integration surfaces.
 */
export interface RuntimeCapabilityEnvelope {
  /** The runtime/cloud capability id (e.g. "github", "neon", "filesystem"). */
  readonly capability: string;
  /** The capability's operation vocabulary (non-empty, unique). */
  readonly operations: readonly string[];
  /** Candidate integration surfaces (at least one; every surface must target this capability). */
  readonly integrations: readonly RuntimeIntegration[];
  /** The bounded environment this runtime exposes, or null when it exposes none. */
  readonly boundedEnvironment: BoundedEnvironmentDescription | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isUniqueStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isNonEmptyString(entry)) &&
    new Set(value as string[]).size === (value as string[]).length
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

const ENVIRONMENT_NAMESPACE = 'bounded-environment';

/** Validate a bounded-environment description (throws InvalidRuntimeContractError). */
export function assertValidBoundedEnvironment(value: unknown): asserts value is BoundedEnvironmentDescription {
  if (!isPlainObject(value)) {
    throw new InvalidRuntimeContractError(ENVIRONMENT_NAMESPACE, 'bounded environment must be an object');
  }
  const keys = Object.keys(value);
  const expected = ['filesystem', 'network', 'isolation', 'limits', 'environmentVariables'];
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidRuntimeContractError(
      ENVIRONMENT_NAMESPACE,
      'bounded environment must have the exact field set { filesystem, network, isolation, limits, environmentVariables }',
    );
  }
  const filesystem = value['filesystem'];
  if (
    !isPlainObject(filesystem) ||
    Object.keys(filesystem).length !== 2 ||
    !FILESYSTEM_MODE_SET.has(String(filesystem['mode'])) ||
    (filesystem['root'] !== null && !isNonEmptyString(filesystem['root']))
  ) {
    throw new InvalidRuntimeContractError(
      ENVIRONMENT_NAMESPACE,
      `bounded environment filesystem must be { mode: ${FILESYSTEM_MODES.join(' | ')}, root: string | null }, received: ${JSON.stringify(filesystem)}`,
    );
  }
  if (filesystem['mode'] !== 'none' && filesystem['root'] === null) {
    throw new InvalidRuntimeContractError(
      ENVIRONMENT_NAMESPACE,
      `bounded environment filesystem mode ${JSON.stringify(filesystem['mode'])} requires a root (only mode "none" has root null)`,
    );
  }
  if (filesystem['mode'] === 'none' && filesystem['root'] !== null) {
    throw new InvalidRuntimeContractError(
      ENVIRONMENT_NAMESPACE,
      'bounded environment filesystem mode "none" must carry root null (no scope is the honest declaration)',
    );
  }
  const network = value['network'];
  if (!isPlainObject(network)) {
    throw new InvalidRuntimeContractError(ENVIRONMENT_NAMESPACE, 'bounded environment network must be an egress policy object');
  }
  const egress = network['egress'];
  if (egress === 'none' || egress === 'open') {
    if (Object.keys(network).length !== 1) {
      throw new InvalidRuntimeContractError(
        ENVIRONMENT_NAMESPACE,
        `egress ${JSON.stringify(egress)} carries no further fields, received: ${JSON.stringify(network)}`,
      );
    }
  } else if (egress === 'allowlist') {
    if (Object.keys(network).length !== 2 || !isUniqueStringArray(network['allowedHosts'])) {
      throw new InvalidRuntimeContractError(
        ENVIRONMENT_NAMESPACE,
        'egress "allowlist" requires a non-empty, duplicate-free allowedHosts array (use egress "none" instead of an empty allowlist)',
      );
    }
  } else {
    throw new InvalidRuntimeContractError(
      ENVIRONMENT_NAMESPACE,
      `bounded environment network egress must be none | allowlist | open, received: ${JSON.stringify(egress)}`,
    );
  }
  if (!isPlainObject(value['isolation']) && !ISOLATION_LEVEL_SET.has(String(value['isolation']))) {
    throw new InvalidRuntimeContractError(
      ENVIRONMENT_NAMESPACE,
      `bounded environment isolation must be one of ${ISOLATION_LEVELS.join(', ')}, received: ${JSON.stringify(value['isolation'])}`,
    );
  }
  const limits = value['limits'];
  if (
    !isPlainObject(limits) ||
    Object.keys(limits).length !== 2 ||
    typeof limits['maxDurationMs'] !== 'number' ||
    !Number.isInteger(limits['maxDurationMs']) ||
    limits['maxDurationMs'] <= 0 ||
    limits['maxDurationMs'] > BOUNDED_ENVIRONMENT_MAX_DURATION_MS ||
    (limits['maxMemoryMb'] !== null &&
      (typeof limits['maxMemoryMb'] !== 'number' || !Number.isFinite(limits['maxMemoryMb']) || limits['maxMemoryMb'] <= 0))
  ) {
    throw new InvalidRuntimeContractError(
      ENVIRONMENT_NAMESPACE,
      `bounded environment limits must be { maxDurationMs: positive integer <= ${BOUNDED_ENVIRONMENT_MAX_DURATION_MS}, maxMemoryMb: positive number | null }, received: ${JSON.stringify(limits)}`,
    );
  }
  if (!isStringArray(value['environmentVariables'])) {
    throw new InvalidRuntimeContractError(
      ENVIRONMENT_NAMESPACE,
      'bounded environment environmentVariables must be an array of non-empty NAME strings (never values — secret values are never echoed)',
    );
  }
  for (const name of value['environmentVariables'] as string[]) {
    if (name.includes('=')) {
      throw new InvalidRuntimeContractError(
        ENVIRONMENT_NAMESPACE,
        `bounded environment environmentVariables carries NAME=value pair ${JSON.stringify(name)} — only NAMES are ever declared; secret values are never echoed, logged or serialized`,
      );
    }
  }
  const names = value['environmentVariables'] as string[];
  if (new Set(names).size !== names.length) {
    throw new InvalidRuntimeContractError(ENVIRONMENT_NAMESPACE, 'bounded environment environmentVariables must be duplicate-free');
  }
}

const ENVELOPE_NAMESPACE = 'runtime-capability-envelope';

/** Validate a runtime capability envelope (throws InvalidRuntimeContractError). */
export function assertValidRuntimeCapabilityEnvelope(value: unknown): asserts value is RuntimeCapabilityEnvelope {
  if (!isPlainObject(value)) {
    throw new InvalidRuntimeContractError(ENVELOPE_NAMESPACE, 'runtime capability envelope must be an object');
  }
  const keys = Object.keys(value);
  const expected = ['capability', 'operations', 'integrations', 'boundedEnvironment'];
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidRuntimeContractError(
      ENVELOPE_NAMESPACE,
      'runtime capability envelope must have the exact field set { capability, operations, integrations, boundedEnvironment }',
    );
  }
  try {
    assertValidRuntimeIdentifier(value['capability'], 'runtime capability envelope capability');
  } catch (cause) {
    throw new InvalidRuntimeContractError(ENVELOPE_NAMESPACE, (cause as Error).message);
  }
  if (!isUniqueStringArray(value['operations'])) {
    throw new InvalidRuntimeContractError(
      ENVELOPE_NAMESPACE,
      'runtime capability envelope operations must be a non-empty, duplicate-free array of non-empty strings',
    );
  }
  const integrations = value['integrations'];
  if (!Array.isArray(integrations) || integrations.length === 0) {
    throw new InvalidRuntimeContractError(
      ENVELOPE_NAMESPACE,
      'runtime capability envelope requires at least one integration surface (an envelope with no surfaces is not a capability)',
    );
  }
  const vocabulary = new Set(value['operations'] as string[]);
  const seen = new Set<string>();
  for (const integration of integrations) {
    assertValidRuntimeIntegration(integration);
    const surface = integration as RuntimeIntegration;
    if (surface.capability !== (value['capability'] as string)) {
      throw new InvalidRuntimeContractError(
        ENVELOPE_NAMESPACE,
        `integration surface ${JSON.stringify(surface.integration_id)} targets capability ${JSON.stringify(surface.capability)} but the envelope is ${JSON.stringify(value['capability'])}`,
      );
    }
    for (const operation of surface.operations) {
      if (!vocabulary.has(operation)) {
        throw new InvalidRuntimeContractError(
          ENVELOPE_NAMESPACE,
          `integration surface ${JSON.stringify(surface.integration_id)} exposes operation ${JSON.stringify(operation)} outside the envelope vocabulary`,
        );
      }
    }
    if (seen.has(surface.integration_id)) {
      throw new InvalidRuntimeContractError(
        ENVELOPE_NAMESPACE,
        `duplicate integration surface id: ${JSON.stringify(surface.integration_id)}`,
      );
    }
    seen.add(surface.integration_id);
  }
  if (value['boundedEnvironment'] !== null) {
    try {
      assertValidBoundedEnvironment(value['boundedEnvironment']);
    } catch (cause) {
      throw new InvalidRuntimeContractError(ENVELOPE_NAMESPACE, (cause as Error).message);
    }
  }
}
