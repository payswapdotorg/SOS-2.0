/**
 * The injectable BROWSER PORT (Work Order P8) — the typed-record seam the
 * browser/evaluator body executes browser journeys through.
 *
 * open/interact are TYPED RECORDS (page records, interaction records),
 * never a real browser: the real browser bridge is a LATER-WAVE adapter
 * that attaches behind this port without contract change. The reference
 * implementation (ScriptedBrowserPort) is a deterministic in-memory page
 * model used by tests and local development.
 */

import { InvalidBodyRuntimeOptionsError } from './errors.js';
import type { BrowserAction } from '@sos-2/harness';
import { isBrowserAction } from '@sos-2/harness';
import type { JsonValue } from '@sos-2/semantic-spine';

/** One opened page — a typed record. */
export interface BrowserPageRecord {
  readonly page_id: string;
  readonly url: string;
  readonly title: string | null;
}

/** One performed interaction — a typed record. */
export interface BrowserInteractionRecord {
  readonly action: BrowserAction;
  readonly target: string;
  readonly value: string | null;
  readonly result: JsonValue | null;
}

/** The outcome of a page open. */
export type BrowserOpenOutcome =
  | { readonly status: 'OPENED'; readonly page: BrowserPageRecord }
  | { readonly status: 'REFUSED'; readonly reason: string };

/** The outcome of an interaction. */
export type BrowserInteractOutcome =
  | { readonly status: 'PERFORMED'; readonly record: BrowserInteractionRecord }
  | { readonly status: 'NO_SUCH_PAGE'; readonly reason: string }
  | { readonly status: 'REFUSED'; readonly reason: string };

/**
 * THE BROWSER PORT — the provider-neutral typed-record seam. Real browser
 * bridges (later wave) implement this port; the reference body never
 * touches a real browser.
 */
export interface BrowserPort {
  /** Open one URL (a typed record; deterministic page ids). */
  open(url: string): BrowserOpenOutcome;
  /** Perform one interaction on an open page (a typed record). */
  interact(pageId: string, action: BrowserAction, target: string, value: string | null): BrowserInteractOutcome;
  /** The open pages (deterministic order — audit). */
  pages(): readonly BrowserPageRecord[];
}

/** One scripted page of the reference browser model. */
export interface ScriptedPageFixture {
  /** The page URL (host must be reachable through the body's network policy). */
  readonly url: string;
  readonly title: string;
  /** Deterministic target -> content model for 'read' interactions. */
  readonly targets: Readonly<Record<string, string>>;
}

/**
 * The reference SCRIPTED BROWSER — a deterministic in-memory page model.
 * Every state it produces is explicitly scripted (never a real page).
 */
export class ScriptedBrowserPort implements BrowserPort {
  private readonly fixtures: ReadonlyMap<string, ScriptedPageFixture>;
  private readonly openPages = new Map<string, ScriptedPageFixture>();
  private sequence = 0;

  constructor(fixtures: readonly ScriptedPageFixture[] = defaultScriptedPages()) {
    if (!Array.isArray(fixtures) || fixtures.length === 0) {
      throw new InvalidBodyRuntimeOptionsError('scripted-browser', 'the scripted browser requires at least one page fixture');
    }
    for (const fixture of fixtures) {
      if (typeof fixture.url !== 'string' || fixture.url.length === 0 || typeof fixture.title !== 'string') {
        throw new InvalidBodyRuntimeOptionsError('scripted-browser', `malformed page fixture: ${JSON.stringify(fixture.url)}`);
      }
    }
    this.fixtures = new Map(fixtures.map((fixture) => [fixture.url, fixture]));
  }

  open(url: string): BrowserOpenOutcome {
    if (typeof url !== 'string' || url.length === 0) {
      return { status: 'REFUSED', reason: 'a page url must be a non-empty string' };
    }
    const fixture = this.fixtures.get(url);
    if (fixture === undefined) {
      return { status: 'REFUSED', reason: `no scripted page for ${JSON.stringify(url)} — the reference browser serves the fixture set only (never fabricated)` };
    }
    this.sequence += 1;
    const page: BrowserPageRecord = {
      page_id: `page-${String(this.sequence).padStart(3, '0')}`,
      url,
      title: fixture.title,
    };
    this.openPages.set(page.page_id, fixture);
    return { status: 'OPENED', page };
  }

  interact(pageId: string, action: BrowserAction, target: string, value: string | null): BrowserInteractOutcome {
    if (!isBrowserAction(action)) {
      return { status: 'REFUSED', reason: `unknown browser action: ${JSON.stringify(action)}` };
    }
    const fixture = this.openPages.get(pageId);
    if (fixture === undefined) {
      return { status: 'NO_SUCH_PAGE', reason: `no open page under id ${JSON.stringify(pageId)}` };
    }
    if (typeof target !== 'string' || target.length === 0) {
      return { status: 'REFUSED', reason: 'an interaction target must be a non-empty string' };
    }
    if (action === 'read') {
      const content = fixture.targets[target];
      if (content === undefined) {
        return { status: 'REFUSED', reason: `no scripted target ${JSON.stringify(target)} on ${JSON.stringify(fixture.url)}` };
      }
      return { status: 'PERFORMED', record: { action, target, value: null, result: content } };
    }
    return { status: 'PERFORMED', record: { action, target, value: value ?? null, result: null } };
  }

  pages(): readonly BrowserPageRecord[] {
    return [...this.openPages.entries()].map(([page_id, fixture]) => ({ page_id, url: fixture.url, title: fixture.title }));
  }
}

/** The default scripted fixture set (deterministic, offline). */
export function defaultScriptedPages(): ScriptedPageFixture[] {
  return [
    {
      url: 'https://example.com/status',
      title: 'Example Status',
      targets: { '#status': 'all systems operational', '#incident-count': '0 open incidents' },
    },
    {
      url: 'https://example.com/docs/quickstart',
      title: 'Quickstart — Example Docs',
      targets: { '#step-1': 'install the companion package', '#step-2': 'connect the repository' },
    },
  ];
}
