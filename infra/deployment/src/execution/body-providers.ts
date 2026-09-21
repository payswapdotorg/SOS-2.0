/**
 * Execution/body provider configuration contract (Work Order P3).
 *
 * Config schema for execution/body providers — the replaceable execution
 * mechanisms of the Spirit/Body architecture (spec/
 * productization-execution-architecture.md sections 1-3). A body ADVERTISES:
 * capabilities, isolation level, network policy, filesystem scope, cost
 * and resource envelope, and supported task lifecycle. SOS chooses bodies
 * from declared capabilities, never vendor identity.
 *
 * STRUCTURAL ISOLATION (tested): this module has ZERO imports from or into
 * packages/* — providers remain adapters; body configuration must never
 * become semantically coupled to the frozen core. The only import here is
 * the shared typed-primitive module of this package. The test suite pins
 * this by scanning the module source for forbidden specifiers.
 *
 * Pure data + pure functions; no process.env, no network, no clock.
 */

import { BodyProviderConfigError } from '../core/types.ts';

/**
 * Capability vocabulary — mirrors the body advertisement surfaces of the
 * execution architecture (section 3) as an INDEPENDENT typed vocabulary
 * (alignment documented, import forbidden by design).
 */
export const BODY_CAPABILITIES = [
  'terminal',
  'filesystem',
  'repository-operations',
  'browser-ui',
  'runtime-cloud-apis',
  'ide-desktop',
  'deployment-operations',
] as const;
export type BodyCapability = (typeof BODY_CAPABILITIES)[number];

/** Isolation levels, weakest to strongest. */
export const BODY_ISOLATION_LEVELS = ['none', 'process', 'container', 'vm', 'account'] as const;
export type BodyIsolationLevel = (typeof BODY_ISOLATION_LEVELS)[number];

/** Network egress policy. */
export type BodyNetworkPolicy =
  | { readonly egress: 'none' }
  | { readonly egress: 'allowlist'; readonly allowedHosts: readonly string[] }
  | { readonly egress: 'open' };

/** Filesystem scope modes. */
export const BODY_FILESYSTEM_MODES = ['none', 'workspace', 'sandboxed-tree', 'host'] as const;
export type BodyFilesystemMode = (typeof BODY_FILESYSTEM_MODES)[number];

/** Cost and resource envelope (bounded by contract). */
export interface BodyCostEnvelope {
  /** Hard upper bound on task duration the provider accepts/charges. */
  readonly maxDurationMs: number;
  /** Memory ceiling in MB where the provider accounts one. */
  readonly maxMemoryMb?: number;
  /** Cost ceiling in USD per task where the provider meters one. */
  readonly maxCostUsdPerTask?: number;
}

/** Supported task lifecycle operations. */
export interface BodyTaskLifecycleSupport {
  readonly supportsCreate: true;
  readonly supportsResume: boolean;
  readonly supportsPause: boolean;
  readonly supportsCancel: boolean;
  readonly supportsCheckpoints: boolean;
}

/** The execution/body provider configuration record. */
export interface BodyProviderConfig {
  readonly providerId: string;
  readonly capabilities: readonly BodyCapability[];
  readonly isolationLevel: BodyIsolationLevel;
  readonly networkPolicy: BodyNetworkPolicy;
  readonly filesystem: { readonly mode: BodyFilesystemMode; readonly workspaceRoot?: string };
  readonly costEnvelope: BodyCostEnvelope;
  readonly taskLifecycle: BodyTaskLifecycleSupport;
  /** Execution placement: cloud bodies keep working when the user device is off. */
  readonly placement: 'cloud' | 'remote' | 'user-device';
}

/** Hard bound the contract places on any body duration envelope. */
export const BODY_MAX_DURATION_HARD_LIMIT_MS = 24 * 60 * 60_000; // 24h

/**
 * Validates a body provider configuration. Typed rejections (never
 * warnings) for: empty/unknown capabilities, unsafe isolation/network
 * combinations, unbounded or absurd cost envelopes, impossible lifecycle
 * declarations, and placement/file-system contradictions.
 */
export function validateBodyProviderConfig(config: BodyProviderConfig): void {
  if (typeof config.providerId !== 'string' || config.providerId.length === 0) {
    throw new BodyProviderConfigError('body provider configuration requires a non-empty providerId');
  }
  if (!Array.isArray(config.capabilities) || config.capabilities.length === 0) {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' must advertise at least one capability (capability-based selection is the contract)`,
    );
  }
  const seen = new Set<string>();
  for (const capability of config.capabilities) {
    if (!(BODY_CAPABILITIES as readonly string[]).includes(capability)) {
      throw new BodyProviderConfigError(
        `body provider '${config.providerId}' advertises unknown capability '${String(capability)}' (vocabulary: ${BODY_CAPABILITIES.join(', ')})`,
      );
    }
    if (seen.has(capability)) {
      throw new BodyProviderConfigError(
        `body provider '${config.providerId}' advertises duplicate capability '${capability}'`,
      );
    }
    seen.add(capability);
  }
  if (!(BODY_ISOLATION_LEVELS as readonly string[]).includes(config.isolationLevel)) {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' declares unknown isolation level '${String(config.isolationLevel)}'`,
    );
  }
  // Unsafe combination: no isolation + open egress is never acceptable.
  if (config.isolationLevel === 'none' && config.networkPolicy.egress === 'open') {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' combines isolation 'none' with open network egress — unconfined execution is typed-rejected (isolation + network policy must form a safe pair)`,
    );
  }
  if (config.networkPolicy.egress === 'allowlist') {
    if (!Array.isArray(config.networkPolicy.allowedHosts) || config.networkPolicy.allowedHosts.length === 0) {
      throw new BodyProviderConfigError(
        `body provider '${config.providerId}' declares allowlist egress with an empty host list — use egress 'none' instead of an empty allowlist`,
      );
    }
    for (const host of config.networkPolicy.allowedHosts) {
      if (typeof host !== 'string' || host.length === 0 || /\s/.test(host)) {
        throw new BodyProviderConfigError(
          `body provider '${config.providerId}' allowlist contains an invalid host (hosts are non-empty, whitespace-free)`,
        );
      }
    }
  }
  if (!(BODY_FILESYSTEM_MODES as readonly string[]).includes(config.filesystem.mode)) {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' declares unknown filesystem mode '${String(config.filesystem.mode)}'`,
    );
  }
  if (config.filesystem.mode === 'host' && config.isolationLevel !== 'account') {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' grants host filesystem scope without account-level isolation — host scope is only ever paired with account isolation`,
    );
  }
  if (config.filesystem.mode === 'workspace' && typeof config.filesystem.workspaceRoot !== 'string') {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' declares workspace filesystem scope without a workspaceRoot`,
    );
  }
  const envelope = config.costEnvelope;
  if (
    !Number.isFinite(envelope.maxDurationMs) ||
    envelope.maxDurationMs <= 0 ||
    envelope.maxDurationMs > BODY_MAX_DURATION_HARD_LIMIT_MS
  ) {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' cost envelope maxDurationMs must be a positive bounded value (<= ${BODY_MAX_DURATION_HARD_LIMIT_MS}ms)`,
    );
  }
  if (envelope.maxMemoryMb !== undefined && (!Number.isFinite(envelope.maxMemoryMb) || envelope.maxMemoryMb <= 0)) {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' cost envelope maxMemoryMb must be positive and finite when present`,
    );
  }
  if (envelope.maxCostUsdPerTask !== undefined && (!Number.isFinite(envelope.maxCostUsdPerTask) || envelope.maxCostUsdPerTask <= 0)) {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' cost envelope maxCostUsdPerTask must be positive and finite when present`,
    );
  }
  if (config.taskLifecycle.supportsCreate !== true) {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' task lifecycle must support create — bodies that cannot be summoned are not bodies`,
    );
  }
  if (!config.taskLifecycle.supportsCheckpoints && !config.taskLifecycle.supportsResume) {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' supports neither checkpoints nor resume — durable task bodies must survive replacement (task state outlives body leases)`,
    );
  }
  if (config.placement !== 'cloud' && config.placement !== 'remote' && config.placement !== 'user-device') {
    throw new BodyProviderConfigError(
      `body provider '${config.providerId}' declares unknown placement '${String(config.placement)}' (cloud | remote | user-device)`,
    );
  }
  return;
}

/**
 * Selects body providers for a REQUIRED capability set — capability-based,
 * never vendor-based. Deterministic: preserves the input order.
 */
export function selectBodyProvidersForCapabilities(
  required: readonly BodyCapability[],
  configs: readonly BodyProviderConfig[],
): readonly BodyProviderConfig[] {
  for (const capability of required) {
    if (!(BODY_CAPABILITIES as readonly string[]).includes(capability)) {
      throw new BodyProviderConfigError(`required capability '${String(capability)}' is not part of the vocabulary`);
    }
  }
  for (const config of configs) {
    validateBodyProviderConfig(config);
  }
  return configs.filter((config) => required.every((capability) => config.capabilities.includes(capability)));
}

/** True when a body keeps working while the user's device is offline. */
export function worksWithoutUserDevice(config: BodyProviderConfig): boolean {
  validateBodyProviderConfig(config);
  return config.placement === 'cloud' || config.placement === 'remote';
}
