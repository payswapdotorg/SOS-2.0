/**
 * THE IDE BRIDGE ADAPTER (Work Order P11) — the §4 tier-4 ('extension')
 * adapter bridging an IDE integration onto the companion/harness
 * surface, with the SAME adapter discipline as the browser bridge.
 *
 * - Typed ports over an INJECTABLE transport: openFile/diagnostics
 *   requests marshal onto bridge commands; every reply is validated
 *   against the exact typed shape (a malformed reply is a truthful
 *   FAILED — never a silent success).
 * - THE SEAM CARRIES NO AUTHORITY: requests are validated against EXACT
 *   field sets — a smuggled grant/permission key is a typed violation
 *   naming the field (IDE extensions are ADAPTERS, never SOS
 *   authorities — pinned by tests).
 * - HONEST CONNECTION: descriptor().connection is NOT_YET_CONNECTED while
 *   no real IDE integration exists (null transport — connection evidence
 *   is never fabricated), or carries the explicit simulated marker when
 *   the deterministic reference transport backs the bridge (the P8
 *   connection-status vocabulary, consumed).
 *
 * Determinism: pure marshaling + validation — no clock, no randomness, no
 * network.
 */

import { InvalidIdeBridgeSpecError } from './errors.js';
import { ideBridgeReplyValueViolation, ideBridgeRequestViolation } from './shapes.js';
import type { IdeBridgeTransport, IdeDiagnosticsResult, IdeOpenFileResult } from './transport.js';
import { ADAPTER_NOT_YET_CONNECTED, simulatedAdapterConnection } from '@sos-2/harness-adapters';
import type { AdapterConnection } from '@sos-2/harness-adapters';
import { assertValidAdapterConnection } from '@sos-2/harness-adapters';
import { assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';
import type { JsonValue } from '@sos-2/semantic-spine';

/** The typed outcome of one IDE-bridge operation (OK | FAILED — never silent). */
export type IdeBridgeResult<T> =
  | { readonly status: 'OK'; readonly value: T }
  | { readonly status: 'FAILED'; readonly error: string };

/** The IDE-bridge descriptor — tier + provenance + honest connection. */
export interface IdeBridgeDescriptor {
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
export interface IdeBridgeAdapterInput {
  /** Bridge identity — a RUNTIME identifier (never spine-shaped). */
  readonly bridgeId: string;
  /** Vendor provenance (metadata only). */
  readonly provider: { readonly name: string; readonly version: string };
  /**
   * The injectable transport, or null while NO real IDE integration
   * exists — null is the honest NOT_YET_CONNECTED state (connection
   * evidence is never fabricated).
   */
  readonly transport: IdeBridgeTransport | null;
  /** One honest sentence about this bridge. */
  readonly note?: string;
}

/** The request of one bridge.ide.openFile dispatch. */
export interface IdeOpenFileRequest {
  readonly task_ref: string;
  /** The workspace-relative document path to open in the user's editor. */
  readonly path: string;
}

/** The request of one bridge.ide.diagnostics dispatch. */
export interface IdeDiagnosticsRequest {
  readonly task_ref: string;
  /** The workspace-relative document path whose diagnostics are read. */
  readonly path: string;
}

const SPEC_NAMESPACE = 'ide-bridge-adapter';

/** Validate the adapter input (throws InvalidIdeBridgeSpecError). */
export function assertValidIdeBridgeAdapterInput(value: unknown): asserts value is IdeBridgeAdapterInput {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidIdeBridgeSpecError(SPEC_NAMESPACE, 'IDE bridge adapter input must be an object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = ['bridgeId', 'provider', 'transport', 'note'];
  if (keys.length < 3 || !expected.every((key) => (key === 'note' ? true : Object.prototype.hasOwnProperty.call(record, key)))) {
    throw new InvalidIdeBridgeSpecError(SPEC_NAMESPACE, `IDE bridge adapter input must have the exact field set { ${expected.join(', ')} } (note optional)`);
  }
  try {
    assertValidRuntimeIdentifier(record['bridgeId'], 'IDE bridge adapter bridgeId');
  } catch (cause) {
    throw new InvalidIdeBridgeSpecError(SPEC_NAMESPACE, (cause as Error).message);
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
    throw new InvalidIdeBridgeSpecError(
      SPEC_NAMESPACE,
      `IDE bridge adapter provider must be { name, version } (non-empty vendor provenance strings — metadata only), received: ${JSON.stringify(provider)}`,
    );
  }
  const transport = record['transport'];
  if (transport !== null && (typeof transport !== 'object' || typeof (transport as IdeBridgeTransport).dispatch !== 'function')) {
    throw new InvalidIdeBridgeSpecError(SPEC_NAMESPACE, 'the IDE bridge transport must be null (NOT_YET_CONNECTED) or an IdeBridgeTransport { dispatch }');
  }
  if (record['note'] !== undefined && (typeof record['note'] !== 'string' || (record['note'] as string).length === 0)) {
    throw new InvalidIdeBridgeSpecError(SPEC_NAMESPACE, 'IDE bridge adapter note must be a non-empty string when present');
  }
}

/**
 * THE IDE BRIDGE ADAPTER — §4 tier 4. Serves the typed IDE-facing ports
 * (openFile/diagnostics) over the injectable integration transport.
 */
export class IdeBridgeAdapter {
  private readonly input: IdeBridgeAdapterInput;

  constructor(input: IdeBridgeAdapterInput) {
    assertValidIdeBridgeAdapterInput(input);
    this.input = input;
  }

  /** The bridge descriptor (tier + provenance + honest connection). */
  descriptor(): IdeBridgeDescriptor {
    return {
      bridge_id: this.input.bridgeId,
      tier: 'extension',
      provider: { ...this.input.provider },
      connection: this.connection(),
      note:
        this.input.note ??
        'the optional IDE bridge (§4 tier 4 — extension): an IDE integration is an ADAPTER bridging onto the companion/harness surface, never an SOS authority',
    };
  }

  /** The honest connection state: NOT_YET_CONNECTED while no real IDE integration exists. */
  connection(): AdapterConnection {
    if (this.input.transport === null) {
      return ADAPTER_NOT_YET_CONNECTED;
    }
    if (this.input.transport.simulated) {
      return simulatedAdapterConnection('a deterministic SIMULATED IDE integration transport backs this bridge — never a real plugin; real IDE integrations attach later through the same transport without contract change.');
    }
    const real: AdapterConnection = {
      status: 'CONNECTED',
      simulated: false,
      note: 'a real IDE integration is attached through the bridge transport.',
    };
    assertValidAdapterConnection(real);
    return real;
  }

  /** Open a document in the user's editor (reply-validated against the exact typed shape). */
  openFile(request: IdeOpenFileRequest): IdeBridgeResult<IdeOpenFileResult> {
    return this.dispatch<IdeOpenFileResult>('bridge.ide.openFile', request as unknown as object);
  }

  /** Read a document's diagnostics (reply-validated against the exact typed shape). */
  diagnostics(request: IdeDiagnosticsRequest): IdeBridgeResult<IdeDiagnosticsResult> {
    return this.dispatch<IdeDiagnosticsResult>('bridge.ide.diagnostics', request as unknown as object);
  }

  /** Marshal, dispatch and reply-validate one bridge command. */
  private dispatch<T>(command: string, request: object): IdeBridgeResult<T> {
    if (this.input.transport === null) {
      return { status: 'FAILED', error: 'the IDE bridge is NOT_YET_CONNECTED — no real IDE integration exists in this Work Order (reference runtime only) and connection evidence is never fabricated' };
    }
    const violation = ideBridgeRequestViolation(command, request);
    if (violation !== null) {
      return { status: 'FAILED', error: violation };
    }
    const reply = this.input.transport.dispatch({ command, body: structuredClone(request) as unknown as JsonValue });
    if (reply.status === 'UNKNOWN_COMMAND') {
      return { status: 'FAILED', error: `the IDE bridge transport answered UNKNOWN_COMMAND: ${reply.message}` };
    }
    if (reply.status === 'ERROR') {
      return { status: 'FAILED', error: `the IDE bridge transport reported an error: ${reply.message}` };
    }
    if (reply.body === null) {
      return { status: 'FAILED', error: `malformed transport reply for ${command}: the bridge returned no body — never a silent success` };
    }
    const replyViolation = ideBridgeReplyValueViolation(command, reply.body);
    if (replyViolation !== null) {
      return { status: 'FAILED', error: `malformed transport reply for ${command}: ${replyViolation} — never a silent success` };
    }
    return { status: 'OK', value: reply.body as unknown as T };
  }
}
