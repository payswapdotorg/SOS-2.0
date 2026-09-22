/**
 * THE BROWSER BRIDGE ADAPTER (Work Order P11) — the §4 tier-4
 * ('extension') adapter bridging a browser extension onto the
 * companion/harness surface.
 *
 * - Typed ports over an INJECTABLE transport: the §9-shaped
 *   browser.open/browser.interact requests marshal onto bridge commands;
 *   every reply is validated against the exact typed shape (a malformed
 *   reply is a truthful FAILED — never a silent success).
 * - THE SEAM CARRIES NO AUTHORITY: requests are validated against EXACT
 *   field sets — a smuggled grant/permission key is a typed violation
 *   naming the field (browser extensions are ADAPTERS, never SOS
 *   authorities — pinned by tests).
 * - HONEST CONNECTION: descriptor().connection is NOT_YET_CONNECTED while
 *   no real extension exists (null transport — connection evidence is
 *   never fabricated), or carries the explicit simulated marker when the
 *   deterministic reference transport backs the bridge (the P8
 *   connection-status vocabulary, consumed).
 *
 * Determinism: pure marshaling + validation — no clock, no randomness, no
 * network.
 */

import { InvalidBrowserBridgeSpecError } from './errors.js';
import { browserBridgeReplyValueViolation, browserBridgeRequestViolation } from './shapes.js';
import type { BrowserBridgeTransport } from './transport.js';
import type { BrowserOpenRequest, BrowserOpenResult, BrowserInteractRequest, BrowserInteractResult, HarnessResult } from '@sos-2/harness';
import { harnessFailed, harnessOk } from '@sos-2/harness';
import { ADAPTER_NOT_YET_CONNECTED, simulatedAdapterConnection } from '@sos-2/harness-adapters';
import type { AdapterConnection } from '@sos-2/harness-adapters';
import { assertValidAdapterConnection } from '@sos-2/harness-adapters';
import { assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';
import type { JsonValue } from '@sos-2/semantic-spine';

/** The browser-bridge descriptor — tier + provenance + honest connection. */
export interface BrowserBridgeDescriptor {
  /** Bridge identity — a RUNTIME identifier, never a SOS semantic identity. */
  readonly bridge_id: string;
  /** The §4 integration tier of this bridge's shape (tier 4 — extension). */
  readonly tier: 'extension';
  /** Vendor provenance — metadata ONLY, never a selection key, never identity. */
  readonly provider: { readonly name: string; readonly version: string };
  /** The honest connection state (the P8 vocabulary, consumed). */
  readonly connection: AdapterConnection;
  /** One honest sentence about this bridge. */
  readonly note: string;
}

/** The input the adapter is constructed from. */
export interface BrowserBridgeAdapterInput {
  /** Bridge identity — a RUNTIME identifier (never spine-shaped). */
  readonly bridgeId: string;
  /** Vendor provenance (metadata only). */
  readonly provider: { readonly name: string; readonly version: string };
  /**
   * The injectable transport, or null while NO real extension exists —
   * null is the honest NOT_YET_CONNECTED state (connection evidence is
   * never fabricated).
   */
  readonly transport: BrowserBridgeTransport | null;
  /** One honest sentence about this bridge. */
  readonly note?: string;
}

const SPEC_NAMESPACE = 'browser-bridge-adapter';

/** Validate the adapter input (throws InvalidBrowserBridgeSpecError). */
export function assertValidBrowserBridgeAdapterInput(value: unknown): asserts value is BrowserBridgeAdapterInput {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidBrowserBridgeSpecError(SPEC_NAMESPACE, 'browser bridge adapter input must be an object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = ['bridgeId', 'provider', 'transport', 'note'];
  if (keys.length < 3 || !expected.every((key) => (key === 'note' ? true : Object.prototype.hasOwnProperty.call(record, key)))) {
    throw new InvalidBrowserBridgeSpecError(SPEC_NAMESPACE, `browser bridge adapter input must have the exact field set { ${expected.join(', ')} } (note optional)`);
  }
  try {
    assertValidRuntimeIdentifier(record['bridgeId'], 'browser bridge adapter bridgeId');
  } catch (cause) {
    throw new InvalidBrowserBridgeSpecError(SPEC_NAMESPACE, (cause as Error).message);
  }
  const provider = record['provider'];
  if (
    typeof provider !== 'object' ||
    provider === null ||
    Object.keys(provider).length !== 2 ||
    typeof (provider as Record<string, unknown>)['name'] !== 'string' ||
    ((provider as Record<string, unknown>)['name'] as string).length === 0 ||
    typeof (provider as Record<string, unknown>)['version'] !== 'string' ||
    ((provider as Record<string, unknown>)['version'] as string).length === 0
  ) {
    throw new InvalidBrowserBridgeSpecError(
      SPEC_NAMESPACE,
      `browser bridge adapter provider must be { name, version } (non-empty vendor provenance strings — metadata only), received: ${JSON.stringify(provider)}`,
    );
  }
  const transport = record['transport'];
  if (transport !== null && (typeof transport !== 'object' || typeof (transport as BrowserBridgeTransport).dispatch !== 'function')) {
    throw new InvalidBrowserBridgeSpecError(SPEC_NAMESPACE, 'the browser bridge transport must be null (NOT_YET_CONNECTED) or a BrowserBridgeTransport { dispatch }');
  }
  if (record['note'] !== undefined && (typeof record['note'] !== 'string' || (record['note'] as string).length === 0)) {
    throw new InvalidBrowserBridgeSpecError(SPEC_NAMESPACE, 'browser bridge adapter note must be a non-empty string when present');
  }
}

/**
 * THE BROWSER BRIDGE ADAPTER — §4 tier 4. Serves the §9-shaped
 * browser.open/browser.interact operations over the injectable
 * extension transport.
 */
export class BrowserBridgeAdapter {
  private readonly input: BrowserBridgeAdapterInput;

  constructor(input: BrowserBridgeAdapterInput) {
    assertValidBrowserBridgeAdapterInput(input);
    this.input = input;
  }

  /** The bridge descriptor (tier + provenance + honest connection). */
  descriptor(): BrowserBridgeDescriptor {
    return {
      bridge_id: this.input.bridgeId,
      tier: 'extension',
      provider: { ...this.input.provider },
      connection: this.connection(),
      note:
        this.input.note ??
        'the optional browser bridge (§4 tier 4 — extension): a browser extension is an ADAPTER bridging onto the companion/harness surface, never an SOS authority',
    };
  }

  /** The honest connection state: NOT_YET_CONNECTED while no real extension exists. */
  connection(): AdapterConnection {
    if (this.input.transport === null) {
      return ADAPTER_NOT_YET_CONNECTED;
    }
    if (this.input.transport.simulated) {
      return simulatedAdapterConnection('a deterministic SIMULATED extension transport backs this bridge — never a real extension; real extensions attach later through the same transport without contract change.');
    }
    const real: AdapterConnection = {
      status: 'CONNECTED',
      simulated: false,
      note: 'a real browser extension is attached through the bridge transport.',
    };
    assertValidAdapterConnection(real);
    return real;
  }

  /** §9 browser.open through the bridge (reply-validated against the exact typed shape). */
  open(request: BrowserOpenRequest): HarnessResult<BrowserOpenResult> {
    return this.dispatch('bridge.browser.open', request as unknown as object);
  }

  /** §9 browser.interact through the bridge (reply-validated against the exact typed shape). */
  interact(request: BrowserInteractRequest): HarnessResult<BrowserInteractResult> {
    return this.dispatch('bridge.browser.interact', request as unknown as object);
  }

  /** Marshal, dispatch and reply-validate one bridge command. */
  private dispatch<T>(command: string, request: object): HarnessResult<T> {
    if (this.input.transport === null) {
      return harnessFailed<T>(
        `the browser bridge is NOT_YET_CONNECTED — no real browser extension exists in this Work Order (reference runtime only) and connection evidence is never fabricated`,
      );
    }
    const violation = browserBridgeRequestViolation(command, request);
    if (violation !== null) {
      return harnessFailed<T>(violation);
    }
    const reply = this.input.transport.dispatch({ command, body: structuredClone(request) as unknown as JsonValue });
    if (reply.status === 'UNKNOWN_COMMAND') {
      return harnessFailed<T>(`the browser bridge transport answered UNKNOWN_COMMAND: ${reply.message}`);
    }
    if (reply.status === 'ERROR') {
      return harnessFailed<T>(`the browser bridge transport reported an error: ${reply.message}`);
    }
    if (reply.body === null) {
      return harnessFailed<T>(`malformed transport reply for ${command}: the bridge returned no body — never a silent success`);
    }
    const replyViolation = browserBridgeReplyValueViolation(command, reply.body);
    if (replyViolation !== null) {
      return harnessFailed<T>(`malformed transport reply for ${command}: ${replyViolation} — never a silent success`);
    }
    return harnessOk(reply.body as unknown as T);
  }
}
