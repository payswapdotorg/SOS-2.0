/**
 * The orchestrator-facing operation union (Work Order P5) — one operation
 * per §9 contract operation dispatchable through the fabric (the task
 * lifecycle flows live on the fabric's dedicated methods).
 *
 * THE SURFACE CANNOT CARRY AUTHORITY: every variant is validated against
 * an EXACT field set — an injected `grant`, `authority`, `permission` or
 * any other key is a typed OPERATION_INVALID denial naming the smuggled
 * field (a body or an attacker cannot widen the operation surface; the
 * authority plane resolves grants from the durable store only).
 */

import { InvalidFabricInputError } from './errors.js';
import type { BrowserAction, HarnessOperationName } from '@sos-2/harness';
import { isBrowserAction } from '@sos-2/harness';
import type { JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';

/** The dispatchable §9 operations (task lifecycle excluded — fabric methods own it). */
export type FabricOperation =
  | { readonly kind: 'workspace.read'; readonly path: string }
  | { readonly kind: 'workspace.write'; readonly path: string; readonly content: string }
  | { readonly kind: 'shell.exec'; readonly command: string; readonly args: readonly string[]; readonly cwd: string | null }
  | { readonly kind: 'browser.open'; readonly url: string }
  | {
      readonly kind: 'browser.interact';
      readonly page_id: string;
      readonly action: BrowserAction;
      readonly target: string;
      readonly value: string | null;
    }
  | { readonly kind: 'git.status' }
  | { readonly kind: 'git.diff'; readonly ref: string | null }
  | { readonly kind: 'git.commit'; readonly message: string; readonly paths: readonly string[] }
  | { readonly kind: 'git.push'; readonly remote: string; readonly ref: string }
  | { readonly kind: 'git.createBranch'; readonly name: string; readonly from_ref: string | null }
  | { readonly kind: 'git.createPullRequest'; readonly title: string; readonly source_branch: string; readonly target_branch: string }
  | { readonly kind: 'artifacts.capture'; readonly name: string; readonly content: string }
  | { readonly kind: 'observations.emit'; readonly observation_kind: string; readonly payload: JsonValue }
  | { readonly kind: 'events.subscribe'; readonly filter: JsonValue | null; readonly cursor: string | null };

export type FabricOperationKind = FabricOperation['kind'];

/** The exact field set of every operation variant (the anti-smuggling rule). */
export const FABRIC_OPERATION_SHAPES: Readonly<Record<FabricOperationKind, readonly string[]>> = {
  'workspace.read': ['kind', 'path'],
  'workspace.write': ['kind', 'path', 'content'],
  'shell.exec': ['kind', 'command', 'args', 'cwd'],
  'browser.open': ['kind', 'url'],
  'browser.interact': ['kind', 'page_id', 'action', 'target', 'value'],
  'git.status': ['kind'],
  'git.diff': ['kind', 'ref'],
  'git.commit': ['kind', 'message', 'paths'],
  'git.push': ['kind', 'remote', 'ref'],
  'git.createBranch': ['kind', 'name', 'from_ref'],
  'git.createPullRequest': ['kind', 'title', 'source_branch', 'target_branch'],
  'artifacts.capture': ['kind', 'name', 'content'],
  'observations.emit': ['kind', 'observation_kind', 'payload'],
  'events.subscribe': ['kind', 'filter', 'cursor'],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isJson(value: unknown): boolean {
  try {
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a fabric operation: exact variant, EXACT field set, typed
 * fields. Throws InvalidFabricInputError with a reason naming the
 * violation — including smuggled authority keys.
 */
export function assertValidFabricOperation(value: unknown): asserts value is FabricOperation {
  if (!isPlainObject(value)) {
    throw new InvalidFabricInputError('fabric operation must be an object');
  }
  const kind = value['kind'];
  if (!isNonEmptyString(kind) || !(kind in FABRIC_OPERATION_SHAPES)) {
    throw new InvalidFabricInputError(
      `fabric operation kind must be one of ${Object.keys(FABRIC_OPERATION_SHAPES).join(', ')}, received: ${JSON.stringify(kind)}`,
    );
  }
  const expected = FABRIC_OPERATION_SHAPES[kind as FabricOperationKind]!;
  const actual = Object.keys(value);
  if (actual.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    const smuggled = actual.filter((key) => !expected.includes(key));
    if (smuggled.length > 0) {
      throw new InvalidFabricInputError(
        `fabric operation ${JSON.stringify(kind)} carries unexpected field(s) ${smuggled.map((key) => JSON.stringify(key)).join(', ')} — the operation surface carries NO authority (a body cannot mint or widen authority); the exact field set is { ${expected.join(', ')} }`,
      );
    }
    throw new InvalidFabricInputError(
      `fabric operation ${JSON.stringify(kind)} must have the exact field set { ${expected.join(', ')} }, received { ${actual.join(', ')} }`,
    );
  }
  switch (kind) {
    case 'workspace.read':
      if (!isNonEmptyString(value['path'])) throw new InvalidFabricInputError('workspace.read requires a non-empty path');
      break;
    case 'workspace.write':
      if (!isNonEmptyString(value['path'])) throw new InvalidFabricInputError('workspace.write requires a non-empty path');
      if (typeof value['content'] !== 'string') throw new InvalidFabricInputError('workspace.write requires string content');
      break;
    case 'shell.exec':
      if (!isNonEmptyString(value['command'])) throw new InvalidFabricInputError('shell.exec requires a non-empty command');
      if (!isStringArray(value['args'])) throw new InvalidFabricInputError('shell.exec requires args as a string array');
      if (value['cwd'] !== null && !isNonEmptyString(value['cwd'])) throw new InvalidFabricInputError('shell.exec cwd must be null or a non-empty string');
      break;
    case 'browser.open':
      if (!isNonEmptyString(value['url'])) throw new InvalidFabricInputError('browser.open requires a non-empty url');
      break;
    case 'browser.interact':
      if (!isNonEmptyString(value['page_id'])) throw new InvalidFabricInputError('browser.interact requires a non-empty page_id');
      if (!isBrowserAction(value['action'])) throw new InvalidFabricInputError('browser.interact action must be click | type | read');
      if (!isNonEmptyString(value['target'])) throw new InvalidFabricInputError('browser.interact requires a non-empty target');
      if (value['value'] !== null && typeof value['value'] !== 'string') throw new InvalidFabricInputError('browser.interact value must be null or a string');
      break;
    case 'git.diff':
      if (value['ref'] !== null && !isNonEmptyString(value['ref'])) throw new InvalidFabricInputError('git.diff ref must be null or a non-empty string');
      break;
    case 'git.commit':
      if (!isNonEmptyString(value['message'])) throw new InvalidFabricInputError('git.commit requires a non-empty message');
      if (!isStringArray(value['paths'])) throw new InvalidFabricInputError('git.commit requires paths as a string array');
      break;
    case 'git.push':
      if (!isNonEmptyString(value['remote'])) throw new InvalidFabricInputError('git.push requires a non-empty remote');
      if (!isNonEmptyString(value['ref'])) throw new InvalidFabricInputError('git.push requires a non-empty ref');
      break;
    case 'git.createBranch':
      if (!isNonEmptyString(value['name'])) throw new InvalidFabricInputError('git.createBranch requires a non-empty name');
      if (value['from_ref'] !== null && !isNonEmptyString(value['from_ref'])) throw new InvalidFabricInputError('git.createBranch from_ref must be null or a non-empty string');
      break;
    case 'git.createPullRequest':
      if (!isNonEmptyString(value['title'])) throw new InvalidFabricInputError('git.createPullRequest requires a non-empty title');
      if (!isNonEmptyString(value['source_branch'])) throw new InvalidFabricInputError('git.createPullRequest requires a non-empty source_branch');
      if (!isNonEmptyString(value['target_branch'])) throw new InvalidFabricInputError('git.createPullRequest requires a non-empty target_branch');
      break;
    case 'artifacts.capture':
      if (!isNonEmptyString(value['name'])) throw new InvalidFabricInputError('artifacts.capture requires a non-empty name');
      if (typeof value['content'] !== 'string') throw new InvalidFabricInputError('artifacts.capture requires string content');
      break;
    case 'observations.emit':
      if (!isNonEmptyString(value['observation_kind'])) throw new InvalidFabricInputError('observations.emit requires a non-empty observation_kind');
      if (!isJson(value['payload'])) throw new InvalidFabricInputError('observations.emit requires a canonical-JSON payload');
      break;
    case 'events.subscribe':
      if (value['filter'] !== null && !isJson(value['filter'])) throw new InvalidFabricInputError('events.subscribe filter must be null or canonical JSON');
      if (value['cursor'] !== null && !isNonEmptyString(value['cursor'])) throw new InvalidFabricInputError('events.subscribe cursor must be null or a non-empty string');
      break;
    case 'git.status':
      break;
  }
}

/** The harness operation name of a fabric operation (1:1 mapping). */
export function harnessOperationOf(operation: FabricOperation): HarnessOperationName {
  return operation.kind as HarnessOperationName;
}
