/**
 * THE BROWSER BRIDGE TRANSPORT (Work Order P11) — the §4 tier-4
 * ('extension') command-dispatch seam, mirroring the P8
 * LocalBridgeTransport precedent.
 *
 * Every bridge operation is a BRIDGE COMMAND (dispatched with a JSON
 * body); the adapter marshals typed §9-shaped requests onto command
 * dispatches and validates every reply body against the operation's
 * exact typed shape. Real browser extensions implement the transport;
 * tests inject fakes; the deterministic simulated extension serves the
 * same shape offline.
 */

import type { JsonValue } from '@sos-2/semantic-spine';

/** One browser-bridge command. */
export interface BrowserBridgeCommand {
  /** The command name ('bridge.browser.open' | 'bridge.browser.interact'). */
  readonly command: string;
  /** The typed request as the command body. */
  readonly body: JsonValue;
}

/** The typed reply of one browser-bridge command. */
export type BrowserBridgeReply =
  | { readonly status: 'OK'; readonly body: JsonValue | null }
  | { readonly status: 'ERROR'; readonly message: string }
  | { readonly status: 'UNKNOWN_COMMAND'; readonly message: string };

/**
 * THE BROWSER BRIDGE TRANSPORT — the extension-shaped provider surface.
 * `simulated` is the honesty marker: true when a reference/simulated
 * extension backs the transport (never a real one — connection evidence
 * is never fabricated).
 */
export interface BrowserBridgeTransport {
  /** Is this transport a simulated reference (the honesty marker)? */
  readonly simulated: boolean;
  /** Dispatch one bridge command. */
  dispatch(command: BrowserBridgeCommand): BrowserBridgeReply;
}
