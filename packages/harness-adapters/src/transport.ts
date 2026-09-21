/**
 * The typed-port marshaling discipline of the adapter seam (Work Order
 * P8): EXACT field sets for every §9 request and every §9 reply value.
 *
 * THE SEAM CANNOT CARRY AUTHORITY: a request or reply carrying an
 * unexpected field (a smuggled grant, permission or authorization key)
 * is a typed violation — named loudly, never silently accepted. The
 * discipline mirrors the P5 execution-fabric anti-smuggling rule: a body
 * or a provider cannot widen the operation surface through the adapter.
 *
 * A transport reply whose value does not satisfy the operation's typed
 * reply shape is a MALFORMED payload — adapters answer a truthful FAILED
 * result naming the violation (never a silent success, never a crash).
 */

import type { HarnessOperationName } from '@sos-2/harness';
import { HARNESS_OPERATIONS, isBrowserAction } from '@sos-2/harness';
import type { JsonValue } from '@sos-2/semantic-spine';

/** The exact field set of every §9 request (the anti-smuggling table). */
export const HARNESS_REQUEST_SHAPES: Readonly<Record<HarnessOperationName, readonly string[]>> = {
  createTask: ['task_ref', 'input'],
  resumeTask: ['task_ref', 'input'],
  pauseTask: ['task_ref'],
  cancelTask: ['task_ref'],
  'workspace.read': ['task_ref', 'path'],
  'workspace.write': ['task_ref', 'path', 'content'],
  'shell.exec': ['task_ref', 'command', 'args', 'cwd'],
  'browser.open': ['task_ref', 'url'],
  'browser.interact': ['task_ref', 'page_id', 'action', 'target', 'value'],
  'git.status': ['task_ref'],
  'git.diff': ['task_ref', 'ref'],
  'git.commit': ['task_ref', 'message', 'paths'],
  'git.push': ['task_ref', 'remote', 'ref'],
  'git.createBranch': ['task_ref', 'name', 'from_ref'],
  'git.createPullRequest': ['task_ref', 'title', 'source_branch', 'target_branch'],
  'artifacts.capture': ['task_ref', 'name', 'content'],
  'observations.emit': ['task_ref', 'observation_kind', 'payload'],
  'events.subscribe': ['task_ref', 'filter', 'cursor'],
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

function isJsonOrNull(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a marshaled §9 request: exact operation, EXACT field set,
 * typed fields. Returns the violation reason or null when well-formed.
 */
export function harnessRequestViolation(operation: HarnessOperationName, request: unknown): string | null {
  if (!HARNESS_OPERATIONS.includes(operation)) {
    return `unknown §9 operation: ${JSON.stringify(operation)}`;
  }
  if (!isPlainObject(request)) {
    return `the ${operation} request must be an object, received: ${JSON.stringify(request)}`;
  }
  const expected = HARNESS_REQUEST_SHAPES[operation]!;
  const actual = Object.keys(request);
  if (actual.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(request, key))) {
    const smuggled = actual.filter((key) => !expected.includes(key));
    if (smuggled.length > 0) {
      return `the ${operation} request carries unexpected field(s) ${smuggled.map((key) => JSON.stringify(key)).join(', ')} — the adapter seam carries NO authority (a body/provider cannot mint or widen authority); the exact field set is { ${expected.join(', ')} }`;
    }
    return `the ${operation} request must have the exact field set { ${expected.join(', ')} }, received { ${actual.join(', ')} }`;
  }
  if (!isNonEmptyString(request['task_ref'])) {
    return `the ${operation} request requires a non-empty task_ref`;
  }
  switch (operation) {
    case 'createTask':
    case 'resumeTask':
      if (!isJsonOrNull(request['input'])) {
        return `the ${operation} request input must be JSON or null`;
      }
      break;
    case 'workspace.read':
      if (!isNonEmptyString(request['path'])) {
        return 'the workspace.read request requires a non-empty path';
      }
      break;
    case 'workspace.write':
      if (!isNonEmptyString(request['path'])) {
        return 'the workspace.write request requires a non-empty path';
      }
      if (typeof request['content'] !== 'string') {
        return 'the workspace.write request requires string content';
      }
      break;
    case 'shell.exec':
      if (!isNonEmptyString(request['command'])) {
        return 'the shell.exec request requires a non-empty command';
      }
      if (!isStringArray(request['args'])) {
        return 'the shell.exec request requires args as a string array';
      }
      if (request['cwd'] !== null && !isNonEmptyString(request['cwd'])) {
        return 'the shell.exec request cwd must be null or a non-empty string';
      }
      break;
    case 'browser.open':
      if (!isNonEmptyString(request['url'])) {
        return 'the browser.open request requires a non-empty url';
      }
      break;
    case 'browser.interact':
      if (!isNonEmptyString(request['page_id'])) {
        return 'the browser.interact request requires a non-empty page_id';
      }
      if (!isBrowserAction(request['action'])) {
        return 'the browser.interact request action must be click | type | read';
      }
      if (!isNonEmptyString(request['target'])) {
        return 'the browser.interact request requires a non-empty target';
      }
      if (request['value'] !== null && typeof request['value'] !== 'string') {
        return 'the browser.interact request value must be null or a string';
      }
      break;
    case 'git.diff':
      if (request['ref'] !== null && !isNonEmptyString(request['ref'])) {
        return 'the git.diff request ref must be null or a non-empty string';
      }
      break;
    case 'git.commit':
      if (!isNonEmptyString(request['message'])) {
        return 'the git.commit request requires a non-empty message';
      }
      if (!isStringArray(request['paths'])) {
        return 'the git.commit request requires paths as a string array';
      }
      break;
    case 'git.push':
      if (!isNonEmptyString(request['remote'])) {
        return 'the git.push request requires a non-empty remote';
      }
      if (!isNonEmptyString(request['ref'])) {
        return 'the git.push request requires a non-empty ref';
      }
      break;
    case 'git.createBranch':
      if (!isNonEmptyString(request['name'])) {
        return 'the git.createBranch request requires a non-empty name';
      }
      if (request['from_ref'] !== null && !isNonEmptyString(request['from_ref'])) {
        return 'the git.createBranch request from_ref must be null or a non-empty string';
      }
      break;
    case 'git.createPullRequest':
      for (const key of ['title', 'source_branch', 'target_branch']) {
        if (!isNonEmptyString(request[key])) {
          return `the git.createPullRequest request requires a non-empty ${key}`;
        }
      }
      break;
    case 'artifacts.capture':
      if (!isNonEmptyString(request['name'])) {
        return 'the artifacts.capture request requires a non-empty name';
      }
      if (typeof request['content'] !== 'string') {
        return 'the artifacts.capture request requires string content';
      }
      break;
    case 'observations.emit':
      if (!isNonEmptyString(request['observation_kind'])) {
        return 'the observations.emit request requires a non-empty observation_kind';
      }
      if (!isJsonOrNull(request['payload'])) {
        return 'the observations.emit request payload must be JSON';
      }
      break;
    case 'events.subscribe':
      if (!isJsonOrNull(request['filter'])) {
        return 'the events.subscribe request filter must be JSON or null';
      }
      if (request['cursor'] !== null && !isNonEmptyString(request['cursor'])) {
        return 'the events.subscribe request cursor must be null or a non-empty string';
      }
      break;
    case 'pauseTask':
    case 'cancelTask':
    case 'git.status':
      break;
  }
  return null;
}

/**
 * Validate a marshaled §9 reply VALUE against the operation's typed
 * result shape. Returns the violation reason or null when well-formed.
 * A malformed reply is the adapter's truthful FAILED result — never a
 * silent success.
 */
export function harnessReplyValueViolation(operation: HarnessOperationName, value: unknown): string | null {
  if (!isPlainObject(value)) {
    return `the ${operation} reply value must be an object, received: ${JSON.stringify(value)}`;
  }
  const hasExact = (keys: readonly string[]): string | null => {
    const actual = Object.keys(value);
    if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
      return `the ${operation} reply value must have the exact field set { ${keys.join(', ')} }, received { ${actual.join(', ')} }`;
    }
    return null;
  };
  switch (operation) {
    case 'createTask': {
      const violation = hasExact(['accepted', 'workspace_root']);
      if (violation !== null) return violation;
      if (value['accepted'] !== true) return 'the createTask reply value accepted must be true';
      if (value['workspace_root'] !== null && !isNonEmptyString(value['workspace_root'])) {
        return 'the createTask reply value workspace_root must be a non-empty string or null';
      }
      return null;
    }
    case 'resumeTask': {
      const violation = hasExact(['state', 'recovered']);
      if (violation !== null) return violation;
      if (value['state'] !== 'resumed') return 'the resumeTask reply value state must be "resumed"';
      if (!isJsonOrNull(value['recovered'])) return 'the resumeTask reply value recovered must be JSON or null';
      return null;
    }
    case 'pauseTask': {
      const violation = hasExact(['state']);
      if (violation !== null) return violation;
      if (value['state'] !== 'paused') return 'the pauseTask reply value state must be "paused"';
      return null;
    }
    case 'cancelTask': {
      const violation = hasExact(['state']);
      if (violation !== null) return violation;
      if (value['state'] !== 'cancelled') return 'the cancelTask reply value state must be "cancelled"';
      return null;
    }
    case 'workspace.read': {
      const violation = hasExact(['content']);
      if (violation !== null) return violation;
      if (typeof value['content'] !== 'string') return 'the workspace.read reply value content must be a string';
      return null;
    }
    case 'workspace.write': {
      const violation = hasExact(['bytes']);
      if (violation !== null) return violation;
      if (typeof value['bytes'] !== 'number' || !Number.isInteger(value['bytes']) || value['bytes'] < 0) {
        return 'the workspace.write reply value bytes must be a non-negative integer';
      }
      return null;
    }
    case 'shell.exec': {
      const violation = hasExact(['exit_code', 'stdout', 'stderr']);
      if (violation !== null) return violation;
      if (typeof value['exit_code'] !== 'number' || !Number.isInteger(value['exit_code'])) {
        return 'the shell.exec reply value exit_code must be an integer';
      }
      if (typeof value['stdout'] !== 'string' || typeof value['stderr'] !== 'string') {
        return 'the shell.exec reply value stdout/stderr must be strings';
      }
      return null;
    }
    case 'browser.open': {
      const violation = hasExact(['page_id', 'url', 'title']);
      if (violation !== null) return violation;
      if (!isNonEmptyString(value['page_id']) || !isNonEmptyString(value['url'])) {
        return 'the browser.open reply value page_id/url must be non-empty strings';
      }
      if (value['title'] !== null && !isNonEmptyString(value['title'])) {
        return 'the browser.open reply value title must be a non-empty string or null';
      }
      return null;
    }
    case 'browser.interact': {
      const violation = hasExact(['result']);
      if (violation !== null) return violation;
      if (!isJsonOrNull(value['result'])) return 'the browser.interact reply value result must be JSON or null';
      return null;
    }
    case 'git.status': {
      const violation = hasExact(['branch', 'clean', 'changed']);
      if (violation !== null) return violation;
      if (value['branch'] !== null && !isNonEmptyString(value['branch'])) {
        return 'the git.status reply value branch must be a non-empty string or null';
      }
      if (typeof value['clean'] !== 'boolean') return 'the git.status reply value clean must be a boolean';
      if (!isStringArray(value['changed'])) return 'the git.status reply value changed must be a string array';
      return null;
    }
    case 'git.diff': {
      const violation = hasExact(['diff']);
      if (violation !== null) return violation;
      if (typeof value['diff'] !== 'string') return 'the git.diff reply value diff must be a string';
      return null;
    }
    case 'git.commit': {
      const violation = hasExact(['commit_ref', 'files']);
      if (violation !== null) return violation;
      if (!isNonEmptyString(value['commit_ref'])) return 'the git.commit reply value commit_ref must be a non-empty string';
      if (typeof value['files'] !== 'number' || !Number.isInteger(value['files']) || value['files'] < 0) {
        return 'the git.commit reply value files must be a non-negative integer';
      }
      return null;
    }
    case 'git.push': {
      const violation = hasExact(['pushed_ref']);
      if (violation !== null) return violation;
      if (!isNonEmptyString(value['pushed_ref'])) return 'the git.push reply value pushed_ref must be a non-empty string';
      return null;
    }
    case 'git.createBranch': {
      const violation = hasExact(['branch']);
      if (violation !== null) return violation;
      if (!isNonEmptyString(value['branch'])) return 'the git.createBranch reply value branch must be a non-empty string';
      return null;
    }
    case 'git.createPullRequest': {
      const violation = hasExact(['pull_request_ref', 'url']);
      if (violation !== null) return violation;
      if (!isNonEmptyString(value['pull_request_ref'])) return 'the git.createPullRequest reply value pull_request_ref must be a non-empty string';
      if (value['url'] !== null && !isNonEmptyString(value['url'])) {
        return 'the git.createPullRequest reply value url must be a non-empty string or null';
      }
      return null;
    }
    case 'artifacts.capture': {
      const violation = hasExact(['artifact_id', 'size_bytes', 'description']);
      if (violation !== null) return violation;
      if (!isNonEmptyString(value['artifact_id'])) return 'the artifacts.capture reply value artifact_id must be a non-empty string';
      if (typeof value['size_bytes'] !== 'number' || !Number.isInteger(value['size_bytes']) || value['size_bytes'] < 0) {
        return 'the artifacts.capture reply value size_bytes must be a non-negative integer';
      }
      if (value['description'] !== null && !isNonEmptyString(value['description'])) {
        return 'the artifacts.capture reply value description must be a non-empty string or null';
      }
      return null;
    }
    case 'observations.emit': {
      const violation = hasExact(['accepted']);
      if (violation !== null) return violation;
      if (value['accepted'] !== true) return 'the observations.emit reply value accepted must be true';
      return null;
    }
    case 'events.subscribe': {
      const violation = hasExact(['events', 'next_cursor']);
      if (violation !== null) return violation;
      const events = value['events'];
      if (!Array.isArray(events)) return 'the events.subscribe reply value events must be an array';
      for (const event of events) {
        if (
          !isPlainObject(event) ||
          !isNonEmptyString(event['event_id']) ||
          !isNonEmptyString(event['kind']) ||
          !isJsonOrNull(event['payload'])
        ) {
          return 'the events.subscribe reply value events must be { event_id, kind, payload } body events';
        }
      }
      if (value['next_cursor'] !== null && !isNonEmptyString(value['next_cursor'])) {
        return 'the events.subscribe reply value next_cursor must be a non-empty string or null';
      }
      return null;
    }
  }
}

/** Strip nothing — marshal a typed request to canonical JSON data (identity for JSON values). */
export function marshalRequest<T extends object>(request: T): JsonValue {
  return structuredClone(request) as unknown as JsonValue;
}
