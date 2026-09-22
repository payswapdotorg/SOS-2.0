/**
 * THE TYPED-PORT MARSHALING DISCIPLINE OF THE IDE BRIDGE SEAM (Work
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

/** The IDE-bridge command vocabulary (§4 tier 4 — the extension surface). */
export const IDE_BRIDGE_COMMANDS = ['bridge.ide.openFile', 'bridge.ide.diagnostics'] as const;

export type IdeBridgeCommandName = (typeof IDE_BRIDGE_COMMANDS)[number];

const COMMAND_SET: ReadonlySet<string> = new Set(IDE_BRIDGE_COMMANDS);

/** The exact field set of every IDE-bridge request (the anti-smuggling table). */
export const IDE_BRIDGE_REQUEST_SHAPES: Readonly<Record<IdeBridgeCommandName, readonly string[]>> = {
  'bridge.ide.openFile': ['task_ref', 'path'],
  'bridge.ide.diagnostics': ['task_ref', 'path'],
};

/** The exact field set of every IDE-bridge reply value. */
export const IDE_BRIDGE_REPLY_SHAPES: Readonly<Record<IdeBridgeCommandName, readonly string[]>> = {
  'bridge.ide.openFile': ['opened', 'document_id'],
  'bridge.ide.diagnostics': ['diagnostics'],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Render a smuggled-field violation (names the field — never silent). */
function smuggledViolation(command: string, smuggled: readonly string[], expected: readonly string[]): string {
  return `the ${command} request carries unexpected field(s) ${smuggled.map((key) => JSON.stringify(key)).join(', ')} — the bridge seam carries NO AUTHORITY (an IDE extension is an adapter, never an SOS authority; a smuggled grant/permission key is a typed violation); the exact field set is { ${expected.join(', ')} }`;
}

/**
 * Validate a marshaled IDE-bridge request: exact command, EXACT field
 * set, typed fields. Returns the violation reason or null when
 * well-formed.
 */
export function ideBridgeRequestViolation(command: string, request: unknown): string | null {
  if (!COMMAND_SET.has(command)) {
    return `unknown IDE-bridge command: ${JSON.stringify(command)} (vocabulary: ${IDE_BRIDGE_COMMANDS.join(', ')})`;
  }
  const name = command as IdeBridgeCommandName;
  if (!isPlainObject(request)) {
    return `the ${name} request must be an object, received: ${JSON.stringify(request)}`;
  }
  const expected = IDE_BRIDGE_REQUEST_SHAPES[name]!;
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
  if (!isNonEmptyString(request['path'])) {
    return `the ${name} request requires a non-empty path`;
  }
  return null;
}

/**
 * Validate a marshaled IDE-bridge reply VALUE against the command's
 * typed reply shape. Returns the violation reason or null when
 * well-formed. A malformed reply is the adapter's truthful FAILED result
 * — never a silent success.
 */
export function ideBridgeReplyValueViolation(command: string, value: unknown): string | null {
  if (!COMMAND_SET.has(command)) {
    return `unknown IDE-bridge command: ${JSON.stringify(command)}`;
  }
  const name = command as IdeBridgeCommandName;
  if (!isPlainObject(value)) {
    return `the ${name} reply value must be an object, received: ${JSON.stringify(value)}`;
  }
  const expected = IDE_BRIDGE_REPLY_SHAPES[name]!;
  const actual = Object.keys(value);
  if (actual.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    const smuggled = actual.filter((key) => !expected.includes(key));
    if (smuggled.length > 0) {
      return `the ${name} reply value carries unexpected field(s) ${smuggled.map((key) => JSON.stringify(key)).join(', ')} — the bridge seam carries NO AUTHORITY; the exact field set is { ${expected.join(', ')} }`;
    }
    return `the ${name} reply value must have the exact field set { ${expected.join(', ')} }, received { ${actual.join(', ')} }`;
  }
  switch (name) {
    case 'bridge.ide.openFile':
      if (value['opened'] !== true) {
        return 'the bridge.ide.openFile reply value opened must be true';
      }
      if (!isNonEmptyString(value['document_id'])) {
        return 'the bridge.ide.openFile reply value document_id must be a non-empty string';
      }
      break;
    case 'bridge.ide.diagnostics': {
      const diagnostics = value['diagnostics'];
      if (!Array.isArray(diagnostics)) {
        return 'the bridge.ide.diagnostics reply value diagnostics must be an array';
      }
      for (const entry of diagnostics) {
        if (
          !isPlainObject(entry) ||
          !['error', 'warning', 'info'].includes(String((entry as Record<string, unknown>)['severity'])) ||
          ((entry as Record<string, unknown>)['code'] !== null && !isNonEmptyString((entry as Record<string, unknown>)['code'])) ||
          !isNonEmptyString((entry as Record<string, unknown>)['message']) ||
          typeof (entry as Record<string, unknown>)['line'] !== 'number' ||
          !Number.isInteger((entry as Record<string, unknown>)['line']) ||
          ((entry as Record<string, unknown>)['line'] as number) < 1
        ) {
          return 'the bridge.ide.diagnostics reply value diagnostics must be { severity: error|warning|info, code: string|null, message: string, line: positive integer } records';
        }
      }
      break;
    }
  }
  return null;
}
