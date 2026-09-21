/**
 * The sandbox policy (Work Order P8) — the bounded-environment contract as
 * INJECTED DATA (no ambient reads anywhere, mirroring the P3 environment
 * contract and the P5 bounded-environment description discipline).
 *
 * The vocabulary is CONSUMED from the merged P5 runtime contracts where it
 * exists (FilesystemMode, NetworkEgressPolicy, IsolationLevel): the P8
 * sandbox never invents core vocabulary. The P8-specific surface is the
 * resource envelope realized as deterministic operation budgets
 * (fileWrites/fileBytes/shellCommands/networkCalls/secretReveals) — the
 * in-process realization of cpu/memory/time budgets: a real provider
 * sandbox maps the same envelope onto cgroup/VM limits without contract
 * change.
 *
 * SECRETS ARE NAMES ONLY: the policy declares credential NAMES; the values
 * are injected separately into the sandbox closure and are never echoed,
 * logged or serialized anywhere (see local-sandbox.ts).
 */

import { InvalidSandboxPolicyError } from './errors.js';
import type { FilesystemMode, NetworkEgressPolicy } from '@sos-2/runtime-contracts';
import { FILESYSTEM_MODES, BOUNDED_ENVIRONMENT_MAX_DURATION_MS } from '@sos-2/runtime-contracts';

/**
 * The deterministic budget counters of the resource envelope (the
 * in-process realization of cpu/memory/time budgets as injected limits).
 */
export const SANDBOX_BUDGET_COUNTERS = [
  'fileWrites',
  'fileBytes',
  'shellCommands',
  'networkCalls',
  'secretReveals',
] as const;

export type SandboxBudgetCounter = (typeof SANDBOX_BUDGET_COUNTERS)[number];

const BUDGET_COUNTER_SET: ReadonlySet<string> = new Set(SANDBOX_BUDGET_COUNTERS);

/** The resource envelope as injected deterministic budgets (null = unbounded). */
export interface SandboxBudgetEnvelope {
  /** Max workspace file writes, or null when unbounded. */
  readonly fileWrites: number | null;
  /** Max total bytes written into the workspace, or null when unbounded. */
  readonly fileBytes: number | null;
  /** Max shell command executions, or null when unbounded. */
  readonly shellCommands: number | null;
  /** Max authorized network exchanges, or null when unbounded. */
  readonly networkCalls: number | null;
  /** Max credential resolutions, or null when unbounded. */
  readonly secretReveals: number | null;
}

/**
 * The sandbox policy: filesystem scope, network egress policy, secret
 * NAMES, deterministic budgets and the provider-facing resource envelope.
 */
export interface SandboxPolicy {
  /** Filesystem scope (mode + root, when scoped). */
  readonly filesystem: { readonly mode: FilesystemMode; readonly root: string | null };
  /** Network egress policy (none | allowlist | open). */
  readonly network: NetworkEgressPolicy;
  /** Credential NAMES the closure may resolve (values are injected separately — never here). */
  readonly secrets: readonly string[];
  /** The deterministic operation budgets. */
  readonly budgets: SandboxBudgetEnvelope;
  /** The provider-facing resource envelope (bounded durations, memory ceiling or null). */
  readonly resourceEnvelope: { readonly maxDurationMs: number; readonly maxMemoryMb: number | null };
}

const POLICY_NAMESPACE = 'sandbox-policy';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveIntegerOrNull(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value > 0)
  );
}

/** Validate a sandbox policy (throws InvalidSandboxPolicyError). */
export function assertValidSandboxPolicy(value: unknown): asserts value is SandboxPolicy {
  if (!isPlainObject(value)) {
    throw new InvalidSandboxPolicyError(POLICY_NAMESPACE, 'sandbox policy must be an object');
  }
  const expected = ['filesystem', 'network', 'secrets', 'budgets', 'resourceEnvelope'];
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidSandboxPolicyError(
      POLICY_NAMESPACE,
      `sandbox policy must have the exact field set { ${expected.join(', ')} }`,
    );
  }
  const filesystem = value['filesystem'];
  if (
    !isPlainObject(filesystem) ||
    Object.keys(filesystem).length !== 2 ||
    typeof filesystem['mode'] !== 'string' ||
    !FILESYSTEM_MODES.includes(filesystem['mode'] as FilesystemMode) ||
    (filesystem['root'] !== null && !isNonEmptyString(filesystem['root']))
  ) {
    throw new InvalidSandboxPolicyError(
      POLICY_NAMESPACE,
      `sandbox policy filesystem must be { mode: ${FILESYSTEM_MODES.join(' | ')}, root: string | null }, received: ${JSON.stringify(filesystem)}`,
    );
  }
  if (String(filesystem['mode']) !== 'none' && filesystem['root'] === null) {
    throw new InvalidSandboxPolicyError(
      POLICY_NAMESPACE,
      `sandbox policy filesystem mode ${JSON.stringify(filesystem['mode'])} requires a root`,
    );
  }
  if (String(filesystem['mode']) === 'none' && filesystem['root'] !== null) {
    throw new InvalidSandboxPolicyError(
      POLICY_NAMESPACE,
      'sandbox policy filesystem mode "none" carries root null (no scope is the honest declaration)',
    );
  }
  const network = value['network'];
  if (!isPlainObject(network)) {
    throw new InvalidSandboxPolicyError(POLICY_NAMESPACE, 'sandbox policy network must be an egress policy object');
  }
  const egress = network['egress'];
  if (egress === 'none' || egress === 'open') {
    if (Object.keys(network).length !== 1) {
      throw new InvalidSandboxPolicyError(
        POLICY_NAMESPACE,
        `egress ${JSON.stringify(egress)} carries no further fields`,
      );
    }
  } else if (egress === 'allowlist') {
    const hosts = network['allowedHosts'];
    if (
      Object.keys(network).length !== 2 ||
      !Array.isArray(hosts) ||
      hosts.length === 0 ||
      !hosts.every((host) => isNonEmptyString(host) && !/\s/.test(host))
    ) {
      throw new InvalidSandboxPolicyError(
        POLICY_NAMESPACE,
        'egress "allowlist" requires a non-empty allowedHosts array of whitespace-free hosts (use egress "none" instead of an empty allowlist)',
      );
    }
    if (new Set(hosts as string[]).size !== (hosts as string[]).length) {
      throw new InvalidSandboxPolicyError(POLICY_NAMESPACE, 'egress allowlist hosts must be duplicate-free');
    }
  } else {
    throw new InvalidSandboxPolicyError(
      POLICY_NAMESPACE,
      `sandbox policy network egress must be none | allowlist | open, received: ${JSON.stringify(egress)}`,
    );
  }
  const secrets = value['secrets'];
  if (!Array.isArray(secrets) || !secrets.every((name) => isNonEmptyString(name) && !name.includes('='))) {
    throw new InvalidSandboxPolicyError(
      POLICY_NAMESPACE,
      'sandbox policy secrets must be an array of non-empty credential NAMES (never values — a NAME=value pair is a typed violation)',
    );
  }
  if (new Set(secrets as string[]).size !== (secrets as string[]).length) {
    throw new InvalidSandboxPolicyError(POLICY_NAMESPACE, 'sandbox policy secrets must be duplicate-free');
  }
  const budgets = value['budgets'];
  if (
    !isPlainObject(budgets) ||
    Object.keys(budgets).length !== SANDBOX_BUDGET_COUNTERS.length ||
    !SANDBOX_BUDGET_COUNTERS.every((counter) => Object.prototype.hasOwnProperty.call(budgets, counter)) ||
    !SANDBOX_BUDGET_COUNTERS.every((counter) => isPositiveIntegerOrNull(budgets[counter]))
  ) {
    throw new InvalidSandboxPolicyError(
      POLICY_NAMESPACE,
      `sandbox policy budgets must be { ${SANDBOX_BUDGET_COUNTERS.join(', ')} } (positive integers or null = unbounded), received: ${JSON.stringify(budgets)}`,
    );
  }
  const envelope = value['resourceEnvelope'];
  if (
    !isPlainObject(envelope) ||
    Object.keys(envelope).length !== 2 ||
    typeof envelope['maxDurationMs'] !== 'number' ||
    !Number.isInteger(envelope['maxDurationMs']) ||
    envelope['maxDurationMs'] <= 0 ||
    envelope['maxDurationMs'] > BOUNDED_ENVIRONMENT_MAX_DURATION_MS ||
    (envelope['maxMemoryMb'] !== null &&
      (typeof envelope['maxMemoryMb'] !== 'number' || !Number.isFinite(envelope['maxMemoryMb']) || envelope['maxMemoryMb'] <= 0))
  ) {
    throw new InvalidSandboxPolicyError(
      POLICY_NAMESPACE,
      `sandbox policy resourceEnvelope must be { maxDurationMs: positive integer <= ${BOUNDED_ENVIRONMENT_MAX_DURATION_MS}, maxMemoryMb: positive number | null }, received: ${JSON.stringify(envelope)}`,
    );
  }
}

/** Is this a well-formed budget counter name? */
export function isSandboxBudgetCounter(value: unknown): value is SandboxBudgetCounter {
  return typeof value === 'string' && BUDGET_COUNTER_SET.has(value);
}
