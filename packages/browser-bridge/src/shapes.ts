/**
 * THE TYPED-PORT MARSHALING DISCIPLINE OF THE BROWSER BRIDGE SEAM (Work
 * Order P11): EXACT field sets for every bridge request and every bridge
 * reply value.
 *
 * THE SEAM CANNOT CARRY AUTHORITY: a request or reply carrying an
 * unexpected field (a smuggled grant, permission or authorization key)
 * is a typed violation — named loudly, never silently accepted (the P5
 * fabric / P8 adapter anti-smuggling rule: browser/IDE extensions are
 * ADAPTERS, never SOS authorities).
 *
 * A transport reply whose value does not satisfy the operation's typed
 * reply shape is a MALFORMED payload — the adapter answers a truthful
 * FAILED result naming the violation (never a silent success, never a
 * crash).
 */

import { isBrowserAction } from '@sos-2/harness';

/** The browser-bridge command vocabulary (§4 tier 4 — the extension surface). */
export const BROWSER_BRIDGE_COMMANDS = ['bridge.browser.open', 'bridge.browser.interact'] as const;

export type BrowserBridgeCommandName = (typeof BROWSER_BRIDGE_COMMANDS)[number];

const COMMAND_SET: ReadonlySet<string> = new Set(BROWSER_BRIDGE_COMMANDS);

/** The exact field set of every browser-bridge request (the anti-smuggling table). */
export const BROWSER_BRIDGE_REQUEST_SHAPES: Readonly<Record<BrowserBridgeCommandName, readonly string[]>> = {
  'bridge.browser.open': ['task_ref', 'url'],
  'bridge.browser.interact': ['task_ref', 'page_id', 'action', 'target', 'value'],
};

/** The exact field set of every browser-bridge reply value. */
export const BROWSER_BRIDGE_REPLY_SHAPES: Readonly<Record<BrowserBridgeCommandName, readonly string[]>> = {
  'bridge.browser.open': ['page_id', 'url', 'title'],
  'bridge.browser.interact': ['result'],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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

/** Render a smuggled-field violation (names the field — never silent). */
function smuggledViolation(command: string, smuggled: readonly string[], expected: readonly string[]): string {
  return `the ${command} request carries unexpected field(s) ${smuggled.map((key) => JSON.stringify(key)).join(', ')} — the bridge seam carries NO AUTHORITY (a browser extension is an adapter, never an SOS authority; a smuggled grant/permission key is a typed violation); the exact field set is { ${expected.join(', ')} }`;
}

/**
 * Validate a marshaled browser-bridge request: exact command, EXACT field
 * set, typed fields. Returns the violation reason or null when
 * well-formed.
 */
export function browserBridgeRequestViolation(command: string, request: unknown): string | null {
  if (!COMMAND_SET.has(command)) {
    return `unknown browser-bridge command: ${JSON.stringify(command)} (vocabulary: ${BROWSER_BRIDGE_COMMANDS.join(', ')})`;
  }
  const name = command as BrowserBridgeCommandName;
  if (!isPlainObject(request)) {
    return `the ${name} request must be an object, received: ${JSON.stringify(request)}`;
  }
  const expected = BROWSER_BRIDGE_REQUEST_SHAPES[name]!;
  const actual = Object.keys(request);
  if (actual.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(request, key))) {
    const smuggled = actual.filter((key) => !expected.includes(key));
    if (smuggled.length > 0) {
      return smuggledViolation(name, smuggled, expected);
    }
    return `the ${name} request must have the exact field set { ${expected.join(', ')} }, received { ${actual.join(', ')} }`;
  }
  if (!isNonEmptyString(request['task_ref'])) {
    return `the ${name} request requires a non-empty task_ref`;
  }
  switch (name) {
    case 'bridge.browser.open':
      if (!isNonEmptyString(request['url'])) {
        return 'the bridge.browser.open request requires a non-empty url';
      }
      break;
    case 'bridge.browser.interact':
      if (!isNonEmptyString(request['page_id'])) {
        return 'the bridge.browser.interact request requires a non-empty page_id';
      }
      if (!isBrowserAction(request['action'])) {
        return 'the bridge.browser.interact request action must be click | type | read';
      }
      if (!isNonEmptyString(request['target'])) {
        return 'the bridge.browser.interact request requires a non-empty target';
      }
      if (request['value'] !== null && typeof request['value'] !== 'string') {
        return 'the bridge.browser.interact request value must be null or a string';
      }
      break;
  }
  return null;
}

/**
 * Validate a marshaled browser-bridge reply VALUE against the command's
 * typed reply shape. Returns the violation reason or null when
 * well-formed. A malformed reply is the adapter's truthful FAILED result
 * — never a silent success.
 */
export function browserBridgeReplyValueViolation(command: string, value: unknown): string | null {
  if (!COMMAND_SET.has(command)) {
    return `unknown browser-bridge command: ${JSON.stringify(command)}`;
  }
  const name = command as BrowserBridgeCommandName;
  if (!isPlainObject(value)) {
    return `the ${name} reply value must be an object, received: ${JSON.stringify(value)}`;
  }
  const expected = BROWSER_BRIDGE_REPLY_SHAPES[name]!;
  const actual = Object.keys(value);
  if (actual.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    const smuggled = actual.filter((key) => !expected.includes(key));
    if (smuggled.length > 0) {
      return `the ${name} reply value carries unexpected field(s) ${smuggled.map((key) => JSON.stringify(key)).join(', ')} — the bridge seam carries NO AUTHORITY; the exact field set is { ${expected.join(', ')} }`;
    }
    return `the ${name} reply value must have the exact field set { ${expected.join(', ')} }, received { ${actual.join(', ')} }`;
  }
  switch (name) {
    case 'bridge.browser.open':
      if (!isNonEmptyString(value['page_id']) || !isNonEmptyString(value['url'])) {
        return 'the bridge.browser.open reply value page_id/url must be non-empty strings';
      }
      if (value['title'] !== null && !isNonEmptyString(value['title'])) {
        return 'the bridge.browser.open reply value title must be a non-empty string or null';
      }
      break;
    case 'bridge.browser.interact':
      if (!isJsonOrNull(value['result'])) {
        return 'the bridge.browser.interact reply value result must be JSON or null';
      }
      break;
  }
  return null;
}
