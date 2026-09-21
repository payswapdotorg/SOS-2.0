/**
 * The capability advertisement model (Work Order P5) — the §3 body
 * advertisement list of spec/productization-execution-architecture.md,
 * mirrored FIELD-FOR-FIELD:
 *
 *   "A body advertises:
 *      - capabilities
 *      - isolation level
 *      - network policy
 *      - filesystem scope
 *      - browser capability
 *      - shell capability
 *      - git capability
 *      - runtime/cloud integrations
 *      - supported task lifecycle
 *      - evidence/artifact capture
 *      - cost and resource envelope"
 *
 * The capability vocabulary mirrors the §1 body surfaces (terminal and
 * filesystem access, repository operations, browser/UI interaction,
 * runtime/cloud APIs, IDE or desktop interaction, deployment operations).
 * The P3 body-provider configuration vocabulary
 * (@sos-2/infra-deployment) mirrors the SAME spec lists as an independent
 * typed vocabulary — alignment is by spec, import is deliberately absent
 * (the P3 structural-isolation precedent), and both vocabularies are
 * pinned to the §1/§3 surfaces by their own tests.
 *
 * THE ADVERTISEMENT IS BINDING: isOperationAdvertised maps every §9
 * operation onto the advertisement, and the contract surface answers a
 * typed UNSUPPORTED result for operations the advertisement does not
 * carry — never silent failure, never a surprise capability.
 */

import { InvalidHarnessContractError } from './errors.js';
import {
  BROWSER_OPERATIONS,
  GIT_OPERATIONS,
  HARNESS_OPERATIONS,
  SHELL_OPERATIONS,
} from './operations.js';
import type { BrowserOperation, GitOperation, HarnessOperationName, ShellOperation } from './operations.js';
import type {
  FilesystemMode,
  IsolationLevel,
  NetworkEgressPolicy,
  RuntimeCapabilityEnvelope,
} from '@sos-2/runtime-contracts';
import {
  FILESYSTEM_MODES,
  ISOLATION_LEVELS,
  assertValidRuntimeCapabilityEnvelope,
} from '@sos-2/runtime-contracts';

/** The body surface vocabulary — the §1 body surfaces / §3 "capabilities". */
export const HARNESS_CAPABILITIES = [
  'terminal',
  'filesystem',
  'repository-operations',
  'browser-ui',
  'runtime-cloud-apis',
  'ide-desktop',
  'deployment-operations',
] as const;

export type HarnessCapability = (typeof HARNESS_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(HARNESS_CAPABILITIES);
const FILESYSTEM_MODE_SET: ReadonlySet<string> = new Set(FILESYSTEM_MODES);
const ISOLATION_LEVEL_SET: ReadonlySet<string> = new Set(ISOLATION_LEVELS);
const BROWSER_OPERATION_SET: ReadonlySet<string> = new Set(BROWSER_OPERATIONS);
const SHELL_OPERATION_SET: ReadonlySet<string> = new Set(SHELL_OPERATIONS);
const GIT_OPERATION_SET: ReadonlySet<string> = new Set(GIT_OPERATIONS);

/** Hard bound on any advertised task duration (aligned with P3's 24h limit by spec). */
export const HARNESS_MAX_DURATION_HARD_LIMIT_MS = 24 * 60 * 60_000;

/** The supported task lifecycle (§3 "supported task lifecycle"). */
export interface HarnessTaskLifecycleSupport {
  /** Bodies that cannot be summoned are not bodies (mirror of the P3 rule). */
  readonly create: boolean;
  readonly resume: boolean;
  readonly pause: boolean;
  readonly cancel: boolean;
  readonly checkpoints: boolean;
}

/** Evidence/artifact capture support (§3 "evidence/artifact capture"). */
export interface HarnessEvidenceCaptureSupport {
  /** artifacts.capture() support. */
  readonly artifacts: boolean;
  /** observations.emit() support. */
  readonly observations: boolean;
  /** events.subscribe() support. */
  readonly events: boolean;
}

/** The cost and resource envelope (§3 "cost and resource envelope"). */
export interface HarnessCostEnvelope {
  /** Hard upper bound on task duration the body accepts (positive, <= 24h). */
  readonly maxDurationMs: number;
  /** Memory ceiling in MB, or null when unaccounted. */
  readonly maxMemoryMb: number | null;
  /** Cost ceiling in USD per task, or null when unmetered. */
  readonly maxCostUsdPerTask: number | null;
}

/**
 * The full §3 capability advertisement, field-for-field.
 */
export interface HarnessCapabilities {
  /** §3 "capabilities" — the body surface vocabulary (non-empty, unique). */
  readonly capabilities: readonly HarnessCapability[];
  /** §3 "isolation level". */
  readonly isolationLevel: IsolationLevel;
  /** §3 "network policy". */
  readonly networkPolicy: NetworkEgressPolicy;
  /** §3 "filesystem scope" (mode + root, when scoped). */
  readonly filesystemScope: { readonly mode: FilesystemMode; readonly root: string | null };
  /** §3 "browser capability" — the supported browser operations ([] = explicitly unsupported). */
  readonly browser: readonly BrowserOperation[];
  /** §3 "shell capability" — the supported shell operations ([] = explicitly unsupported). */
  readonly shell: readonly ShellOperation[];
  /** §3 "git capability" — the supported git operations ([] = explicitly unsupported). */
  readonly git: readonly GitOperation[];
  /** §3 "runtime/cloud integrations". */
  readonly runtimeIntegrations: readonly RuntimeCapabilityEnvelope[];
  /** §3 "supported task lifecycle". */
  readonly taskLifecycle: HarnessTaskLifecycleSupport;
  /** §3 "evidence/artifact capture". */
  readonly evidenceCapture: HarnessEvidenceCaptureSupport;
  /** §3 "cost and resource envelope". */
  readonly costEnvelope: HarnessCostEnvelope;
}

const CAPABILITIES_NAMESPACE = 'harness-capabilities';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isUniqueVocabularyList(value: unknown, vocabulary: ReadonlySet<string>): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && vocabulary.has(entry)) &&
    new Set(value as string[]).size === (value as string[]).length
  );
}

/** Validate a capability advertisement (throws InvalidHarnessContractError). */
export function assertValidHarnessCapabilities(value: unknown): asserts value is HarnessCapabilities {
  if (!isPlainObject(value)) {
    throw new InvalidHarnessContractError(CAPABILITIES_NAMESPACE, 'capability advertisement must be an object');
  }
  const keys = Object.keys(value);
  const expected = [
    'capabilities',
    'isolationLevel',
    'networkPolicy',
    'filesystemScope',
    'browser',
    'shell',
    'git',
    'runtimeIntegrations',
    'taskLifecycle',
    'evidenceCapture',
    'costEnvelope',
  ];
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'capability advertisement must mirror the §3 body advertisement list with the exact field set { capabilities, isolationLevel, networkPolicy, filesystemScope, browser, shell, git, runtimeIntegrations, taskLifecycle, evidenceCapture, costEnvelope }',
    );
  }
  // §3 "capabilities" — non-empty, unique, from the vocabulary.
  if (!Array.isArray(value['capabilities']) || value['capabilities'].length === 0) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'capability advertisement must advertise at least one capability (capability-based selection is the contract)',
    );
  }
  const seen = new Set<string>();
  for (const capability of value['capabilities']) {
    if (!CAPABILITY_SET.has(String(capability))) {
      throw new InvalidHarnessContractError(
        CAPABILITIES_NAMESPACE,
        `unknown capability ${JSON.stringify(capability)} (vocabulary: ${HARNESS_CAPABILITIES.join(', ')})`,
      );
    }
    if (seen.has(String(capability))) {
      throw new InvalidHarnessContractError(CAPABILITIES_NAMESPACE, `duplicate capability ${JSON.stringify(capability)}`);
    }
    seen.add(String(capability));
  }
  if (typeof value['isolationLevel'] !== 'string' || !ISOLATION_LEVEL_SET.has(value['isolationLevel'])) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      `isolationLevel must be one of ${ISOLATION_LEVELS.join(', ')}, received: ${JSON.stringify(value['isolationLevel'])}`,
    );
  }
  const network = value['networkPolicy'];
  if (!isPlainObject(network)) {
    throw new InvalidHarnessContractError(CAPABILITIES_NAMESPACE, 'networkPolicy must be an egress policy object');
  }
  if (network['egress'] === 'none' || network['egress'] === 'open') {
    if (Object.keys(network).length !== 1) {
      throw new InvalidHarnessContractError(CAPABILITIES_NAMESPACE, `egress ${JSON.stringify(network['egress'])} carries no further fields`);
    }
  } else if (network['egress'] === 'allowlist') {
    const hosts = network['allowedHosts'];
    if (
      Object.keys(network).length !== 2 ||
      !Array.isArray(hosts) ||
      hosts.length === 0 ||
      !hosts.every((host) => isNonEmptyString(host) && !/\s/.test(host))
    ) {
      throw new InvalidHarnessContractError(
        CAPABILITIES_NAMESPACE,
        'egress "allowlist" requires a non-empty allowedHosts array of whitespace-free hosts (use egress "none" instead of an empty allowlist)',
      );
    }
  } else {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      `networkPolicy egress must be none | allowlist | open, received: ${JSON.stringify(network['egress'])}`,
    );
  }
  const filesystem = value['filesystemScope'];
  if (
    !isPlainObject(filesystem) ||
    Object.keys(filesystem).length !== 2 ||
    !FILESYSTEM_MODE_SET.has(String(filesystem['mode'])) ||
    (filesystem['root'] !== null && !isNonEmptyString(filesystem['root']))
  ) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      `filesystemScope must be { mode: ${FILESYSTEM_MODES.join(' | ')}, root: string | null }, received: ${JSON.stringify(filesystem)}`,
    );
  }
  if (String(filesystem['mode']) !== 'none' && filesystem['root'] === null) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      `filesystemScope mode ${JSON.stringify(filesystem['mode'])} requires a root`,
    );
  }
  if (String(filesystem['mode']) === 'none' && filesystem['root'] !== null) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'filesystemScope mode "none" carries root null (no scope is the honest declaration)',
    );
  }
  // §3 browser/shell/git capability — explicit operation lists from their vocabularies.
  if (!isUniqueVocabularyList(value['browser'], BROWSER_OPERATION_SET)) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      `browser capability must be a duplicate-free list from ${BROWSER_OPERATIONS.join(', ')} ([] = explicitly unsupported)`,
    );
  }
  if (!isUniqueVocabularyList(value['shell'], SHELL_OPERATION_SET)) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      `shell capability must be a duplicate-free list from ${SHELL_OPERATIONS.join(', ')} ([] = explicitly unsupported)`,
    );
  }
  if (!isUniqueVocabularyList(value['git'], GIT_OPERATION_SET)) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      `git capability must be a duplicate-free list from ${GIT_OPERATIONS.join(', ')} ([] = explicitly unsupported)`,
    );
  }
  // Cross-consistency: an operation list without the matching surface capability is a lie.
  if ((value['browser'] as string[]).length > 0 && !seen.has('browser-ui')) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'browser operations are advertised without the "browser-ui" capability — the advertisement must be consistent',
    );
  }
  if ((value['shell'] as string[]).length > 0 && !seen.has('terminal')) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'shell operations are advertised without the "terminal" capability — the advertisement must be consistent',
    );
  }
  if ((value['git'] as string[]).length > 0 && !seen.has('repository-operations')) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'git operations are advertised without the "repository-operations" capability — the advertisement must be consistent',
    );
  }
  if (seen.has('filesystem') && String(filesystem['mode']) === 'none') {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'the "filesystem" capability is advertised with filesystemScope mode "none" — the advertisement must be consistent',
    );
  }
  // §3 runtime/cloud integrations.
  if (!Array.isArray(value['runtimeIntegrations'])) {
    throw new InvalidHarnessContractError(CAPABILITIES_NAMESPACE, 'runtimeIntegrations must be an array of runtime capability envelopes');
  }
  for (const envelope of value['runtimeIntegrations']) {
    try {
      assertValidRuntimeCapabilityEnvelope(envelope);
    } catch (cause) {
      throw new InvalidHarnessContractError(CAPABILITIES_NAMESPACE, (cause as Error).message);
    }
  }
  if ((value['runtimeIntegrations'] as unknown[]).length > 0 && !seen.has('runtime-cloud-apis')) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'runtime integrations are advertised without the "runtime-cloud-apis" capability — the advertisement must be consistent',
    );
  }
  // §3 supported task lifecycle.
  const lifecycle = value['taskLifecycle'];
  if (
    !isPlainObject(lifecycle) ||
    !hasExactKeys(lifecycle, ['create', 'resume', 'pause', 'cancel', 'checkpoints']) ||
    !isBoolean(lifecycle['create']) ||
    !isBoolean(lifecycle['resume']) ||
    !isBoolean(lifecycle['pause']) ||
    !isBoolean(lifecycle['cancel']) ||
    !isBoolean(lifecycle['checkpoints'])
  ) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'taskLifecycle must be { create, resume, pause, cancel, checkpoints } (booleans)',
    );
  }
  if (lifecycle['create'] !== true) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'taskLifecycle must support create — bodies that cannot be summoned are not bodies',
    );
  }
  if (lifecycle['resume'] !== true && lifecycle['checkpoints'] !== true) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'taskLifecycle supports neither resume nor checkpoints — durable task bodies must survive replacement (task state outlives body leases)',
    );
  }
  // §3 evidence/artifact capture.
  const evidenceCapture = value['evidenceCapture'];
  if (
    !isPlainObject(evidenceCapture) ||
    !hasExactKeys(evidenceCapture, ['artifacts', 'observations', 'events']) ||
    !isBoolean(evidenceCapture['artifacts']) ||
    !isBoolean(evidenceCapture['observations']) ||
    !isBoolean(evidenceCapture['events'])
  ) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      'evidenceCapture must be { artifacts, observations, events } (booleans — explicit support or explicit non-support)',
    );
  }
  // §3 cost and resource envelope.
  const envelope = value['costEnvelope'];
  if (
    !isPlainObject(envelope) ||
    !hasExactKeys(envelope, ['maxDurationMs', 'maxMemoryMb', 'maxCostUsdPerTask']) ||
    typeof envelope['maxDurationMs'] !== 'number' ||
    !Number.isInteger(envelope['maxDurationMs']) ||
    envelope['maxDurationMs'] <= 0 ||
    envelope['maxDurationMs'] > HARNESS_MAX_DURATION_HARD_LIMIT_MS ||
    (envelope['maxMemoryMb'] !== null &&
      (typeof envelope['maxMemoryMb'] !== 'number' || !Number.isFinite(envelope['maxMemoryMb']) || envelope['maxMemoryMb'] <= 0)) ||
    (envelope['maxCostUsdPerTask'] !== null &&
      (typeof envelope['maxCostUsdPerTask'] !== 'number' ||
        !Number.isFinite(envelope['maxCostUsdPerTask']) ||
        envelope['maxCostUsdPerTask'] <= 0))
  ) {
    throw new InvalidHarnessContractError(
      CAPABILITIES_NAMESPACE,
      `costEnvelope must be { maxDurationMs: positive integer <= ${HARNESS_MAX_DURATION_HARD_LIMIT_MS}, maxMemoryMb: positive number | null, maxCostUsdPerTask: positive number | null }, received: ${JSON.stringify(envelope)}`,
    );
  }
}

/**
 * THE BINDING ADVERTISEMENT: is the §9 operation advertised by this
 * capability set? Unsupported operations are answered with typed
 * UNSUPPORTED results — never silent failure.
 */
export function isOperationAdvertised(capabilities: HarnessCapabilities, operation: HarnessOperationName): boolean {
  switch (operation) {
    case 'createTask':
      return capabilities.taskLifecycle.create;
    case 'resumeTask':
      return capabilities.taskLifecycle.resume;
    case 'pauseTask':
      return capabilities.taskLifecycle.pause;
    case 'cancelTask':
      return capabilities.taskLifecycle.cancel;
    case 'workspace.read':
    case 'workspace.write':
      // The guard guarantees a scoped filesystem mode whenever the
      // 'filesystem' capability is advertised (mode 'none' + the
      // capability is a rejected inconsistency).
      return capabilities.capabilities.includes('filesystem');
    case 'shell.exec':
      return capabilities.capabilities.includes('terminal') && capabilities.shell.includes('exec');
    case 'browser.open':
      return capabilities.capabilities.includes('browser-ui') && capabilities.browser.includes('open');
    case 'browser.interact':
      return capabilities.capabilities.includes('browser-ui') && capabilities.browser.includes('interact');
    case 'git.status':
    case 'git.diff':
    case 'git.commit':
    case 'git.push':
    case 'git.createBranch':
    case 'git.createPullRequest': {
      if (!capabilities.capabilities.includes('repository-operations')) {
        return false;
      }
      const op = operation.slice('git.'.length) as GitOperation;
      return capabilities.git.includes(op);
    }
    case 'artifacts.capture':
      return capabilities.evidenceCapture.artifacts;
    case 'observations.emit':
      return capabilities.evidenceCapture.observations;
    case 'events.subscribe':
      return capabilities.evidenceCapture.events;
  }
}

/** The deterministic list of advertised §9 operations (for audits/tests). */
export function advertisedOperations(capabilities: HarnessCapabilities): HarnessOperationName[] {
  return HARNESS_OPERATIONS.filter((operation) => isOperationAdvertised(capabilities, operation));
}
