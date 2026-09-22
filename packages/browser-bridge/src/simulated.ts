/**
 * THE SIMULATED BROWSER EXTENSION TRANSPORT (Work Order P11) — the
 * deterministic LOCAL REFERENCE RUNTIME behind the browser bridge.
 *
 * NO real browser extension ships in this Work Order: this transport
 * serves the SAME command-dispatch shape with a deterministic fixture
 * page model (page ids are sequences; titles derive from the host; read
 * returns the fixture content). The `simulated: true` honesty marker is
 * carried on the transport so a simulated connection can never render as
 * a real one (the P4/P8 discipline). A real extension implements
 * BrowserBridgeTransport with simulated: false — attaching later without
 * contract change.
 *
 * Determinism: pure state machine — no clock, no randomness, no network.
 */

import { browserBridgeRequestViolation } from './shapes.js';
import type { BrowserBridgeCommand, BrowserBridgeReply, BrowserBridgeTransport } from './transport.js';
import type { JsonValue } from '@sos-2/semantic-spine';

interface FixturePage {
  readonly page_id: string;
  readonly url: string;
  readonly title: string | null;
  readonly content: string;
}

/**
 * The simulated browser extension: deterministic open/interact over a
 * fixture page model. Unknown pages answer a truthful ERROR reply; the
 * request shapes are validated exactly (a smuggled authority key is an
 * ERROR naming the field — never accepted).
 */
export class SimulatedBrowserExtensionTransport implements BrowserBridgeTransport {
  readonly simulated = true;

  private readonly pages = new Map<string, FixturePage>();
  private sequence = 0;

  dispatch(command: BrowserBridgeCommand): BrowserBridgeReply {
    const violation = browserBridgeRequestViolation(command.command, command.body);
    if (violation !== null) {
      return { status: 'ERROR', message: violation };
    }
    const body = command.body as Record<string, unknown>;
    switch (command.command) {
      case 'bridge.browser.open': {
        this.sequence += 1;
        const url = String(body['url']);
        const page: FixturePage = {
          page_id: `page-${String(this.sequence).padStart(4, '0')}`,
          url,
          title: `simulated page: ${hostOf(url)}`,
          content: `simulated fixture content for ${url}`,
        };
        this.pages.set(page.page_id, page);
        return { status: 'OK', body: { page_id: page.page_id, url: page.url, title: page.title } };
      }
      case 'bridge.browser.interact': {
        const pageId = String(body['page_id']);
        const page = this.pages.get(pageId);
        if (page === undefined) {
          return { status: 'ERROR', message: `no open page ${JSON.stringify(pageId)} on this simulated extension` };
        }
        const action = String(body['action']);
        if (action === 'read') {
          return { status: 'OK', body: { result: { text: page.content } } };
        }
        if (action === 'click') {
          return { status: 'OK', body: { result: { clicked: String(body['target']) } } };
        }
        return { status: 'OK', body: { result: { typed: String(body['value'] ?? '') } } };
      }
      default:
        return { status: 'UNKNOWN_COMMAND', message: `no browser-bridge operation maps to command ${JSON.stringify(command.command)}` };
    }
  }

  /** The open fixture pages (audit/test probe). */
  openPages(): readonly { readonly page_id: string; readonly url: string; readonly title: string | null }[] {
    return [...this.pages.values()].map((page) => ({ page_id: page.page_id, url: page.url, title: page.title }));
  }
}

function hostOf(url: string): string {
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return match === null ? url.slice(0, 40) : match[1]!;
}

/** A JSON value helper for tests (identity for JSON values). */
export function asJson(value: JsonValue): JsonValue {
  return structuredClone(value);
}
