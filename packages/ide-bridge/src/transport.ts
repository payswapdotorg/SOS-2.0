/**
 * THE IDE BRIDGE TRANSPORT (Work Order P11) — the §4 tier-4 ('extension')
 * command-dispatch seam for IDE integrations, mirroring the P8
 * LocalBridgeTransport precedent and the browser-bridge discipline.
 *
 * The IDE bridge serves typed IDE-facing ports (the §1 body surface
 * "IDE or desktop interaction"): opening a document in the user's editor
 * and reading its diagnostics. Real IDE plugins implement the transport;
 * tests inject fakes; the deterministic simulated integration serves the
 * same shape offline.
 */

import type { JsonValue } from '@sos-2/semantic-spine';

/** One IDE-bridge command. */
export interface IdeBridgeCommand {
  /** The command name ('bridge.ide.openFile' | 'bridge.ide.diagnostics'). */
  readonly command: string;
  /** The typed request as the command body. */
  readonly body: JsonValue;
}

/** The typed reply of one IDE-bridge command. */
export type IdeBridgeReply =
  | { readonly status: 'OK'; readonly body: JsonValue | null }
  | { readonly status: 'ERROR'; readonly message: string }
  | { readonly status: 'UNKNOWN_COMMAND'; readonly message: string };

/**
 * THE IDE BRIDGE TRANSPORT — the integration-shaped provider surface.
 * `simulated` is the honesty marker: true when a reference/simulated IDE
 * integration backs the transport (never a real one — connection
 * evidence is never fabricated).
 */
export interface IdeBridgeTransport {
  /** Is this transport a simulated reference (the honesty marker)? */
  readonly simulated: boolean;
  /** Dispatch one bridge command. */
  dispatch(command: IdeBridgeCommand): IdeBridgeReply;
}

/** One IDE diagnostic (a typed record — the §1 IDE interaction surface). */
export interface IdeDiagnostic {
  /** Diagnostic severity: 'error' | 'warning' | 'info'. */
  readonly severity: 'error' | 'warning' | 'info';
  /** The diagnostic code (or null when the analyzer carries none). */
  readonly code: string | null;
  /** The human-readable message. */
  readonly message: string;
  /** The 1-based line the diagnostic points at. */
  readonly line: number;
}

/** The result of one bridge.ide.openFile dispatch (the typed reply value). */
export interface IdeOpenFileResult {
  readonly opened: true;
  readonly document_id: string;
}

/** The result of one bridge.ide.diagnostics dispatch (the typed reply value). */
export interface IdeDiagnosticsResult {
  readonly diagnostics: readonly IdeDiagnostic[];
}
