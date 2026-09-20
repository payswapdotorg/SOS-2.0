/**
 * Deterministic HTML rendering helpers — pure string functions, zero DOM,
 * zero external assets (the console runs standalone with no network).
 *
 * Every visible string is escaped; every list is rendered in a fixed
 * (sorted or authored) order; no clocks, no randomness — the same
 * view-model ALWAYS renders the same bytes.
 */

export function esc(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Badge kinds (color semantics; no blue/indigo per SOS console palette). */
export type BadgeKind = 'good' | 'bad' | 'unknown' | 'warn' | 'neutral' | 'accent';

const BADGE_CLASS: Record<BadgeKind, string> = {
  good: 'badge badge-good',
  bad: 'badge badge-bad',
  unknown: 'badge badge-unknown',
  warn: 'badge badge-warn',
  neutral: 'badge',
  accent: 'badge badge-accent',
};

export function badge(text: string, kind: BadgeKind = 'neutral'): string {
  return `<span class="${BADGE_CLASS[kind]}">${esc(text)}</span>`;
}

/** Truth-state badge semantics (the 6 states are never conflated). */
export function truthStateBadge(state: string): string {
  switch (state) {
    case 'SUCCESS':
      return badge(state, 'good');
    case 'FAILURE':
      return badge(state, 'bad');
    case 'PARTIAL':
      return badge(state, 'warn');
    case 'UNKNOWN':
    case 'UNAVAILABLE':
    case 'UNSUPPORTED':
      return badge(state, 'unknown');
    default:
      return badge(state);
  }
}

/** Verdict-like statuses keep their own semantics. */
export function statusBadge(status: string): string {
  switch (status) {
    case 'ACTIVE':
    case 'VALID':
    case 'SATISFIED':
    case 'FRESH':
    case 'CURRENT':
    case 'SUCCESS':
    case 'REALIZED':
    case 'RESOLVED':
      return badge(status, 'good');
    case 'INVALID':
    case 'REFUTED':
    case 'BREACHED':
    case 'FAILURE':
    case 'EXPIRED_TIME_WINDOW':
    case 'SUPERSEDED_SUBJECT_REVISION':
    case 'SUPERSEDED':
    case 'VIOLATED':
      return badge(status, 'bad');
    case 'OBJECTIONED':
    case 'NOT_ESTABLISHED':
    case 'OPEN':
    case 'UNKNOWN':
    case 'UNKNOWN_PROVENANCE':
    case 'UNAVAILABLE':
    case 'UNSUPPORTED':
    case 'PARTIAL':
    case 'INCOMPLETE':
      return badge(status, 'unknown');
    case 'DRAFT':
    case 'NOT_SATISFIED':
      return badge(status, 'warn');
    default:
      return badge(status);
  }
}

/** A definition-list row pair. */
export function dl(pairs: readonly (readonly [string, string])[]): string {
  if (pairs.length === 0) {
    return '<p class="empty">none</p>';
  }
  return `<dl class="kv">${pairs
    .map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${value}</dd></div>`)
    .join('')}</dl>`;
}

export function ul(items: readonly string[], ordered = false): string {
  if (items.length === 0) {
    return '<p class="empty">none</p>';
  }
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`;
}

/** An artifact id shown as monospace text (with its kind label). */
export function artifactRef(id: string): string {
  return `<code class="artifact" title="${esc(id)}">${esc(id)}</code>`;
}

/** A link to the rationale chain page of an artifact. */
export function rationaleLink(subjectId: string): string {
  return `<a class="rationale-link" href="/rationale?id=${encodeURIComponent(subjectId)}">rationale</a>`;
}

/** A plain table (headers + rows of pre-rendered cells). */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) {
    return '<p class="empty">no rows</p>';
  }
  const head = `<thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<div class="table-wrap"><table>${head}${body}</table></div>`;
}

const CSS = `
:root {
  --bg: #faf9f7; --panel: #ffffff; --ink: #1c1917; --muted: #57534e;
  --line: #e7e5e4; --accent: #166534; --accent-soft: #f0fdf4;
  --good: #166534; --good-soft: #f0fdf4; --bad: #b91c1c; --bad-soft: #fef2f2;
  --warn: #b45309; --warn-soft: #fffbeb; --unknown: #6d28d9; --unknown-soft: #f5f3ff;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg); color: var(--ink); line-height: 1.55;
  display: flex; flex-direction: column; min-height: 100vh;
}
a { color: var(--accent); }
code, .mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.86em; }
code.artifact { background: #f5f5f4; padding: 0.1em 0.35em; border-radius: 4px; word-break: break-all; }
header.site { background: #14201a; color: #f0fdf4; padding: 0.9rem 1.4rem; }
header.site h1 { margin: 0; font-size: 1.15rem; letter-spacing: 0.02em; }
header.site p { margin: 0.15rem 0 0; color: #bbf7d0; font-size: 0.8rem; }
nav.journeys { background: #1c2b23; padding: 0.4rem 1.4rem; display: flex; flex-wrap: wrap; gap: 0.15rem 0.9rem; }
nav.journeys a { color: #d1fae5; text-decoration: none; font-size: 0.82rem; padding: 0.2rem 0; }
nav.journeys a.active { color: #ffffff; border-bottom: 2px solid #4ade80; }
main { flex: 1; width: 100%; max-width: 1180px; margin: 0 auto; padding: 1.4rem 1.4rem 2.5rem; }
footer.site { background: #14201a; color: #a7f3d0; padding: 0.8rem 1.4rem; font-size: 0.75rem; }
footer.site a { color: #d1fae5; }
h2 { font-size: 1.25rem; margin: 0 0 0.4rem; }
h3 { font-size: 1.02rem; margin: 1.4rem 0 0.4rem; }
p.lede { color: var(--muted); margin-top: 0; max-width: 72ch; }
section.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1rem 1.2rem; margin: 1rem 0; }
section.panel > h2:first-child, section.panel > h3:first-child { margin-top: 0.1rem; }
.rationale-box { background: var(--accent-soft); border: 1px solid #bbf7d0; border-radius: 10px; padding: 0.7rem 1rem; margin: 0.8rem 0; font-size: 0.9rem; }
.rationale-box .side { margin: 0.25rem 0; }
dl.kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 1rem; margin: 0.4rem 0; }
dl.kv div { display: contents; }
dl.kv dt { color: var(--muted); font-size: 0.82rem; }
dl.kv dd { margin: 0; font-size: 0.9rem; }
.badge { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 0.03rem 0.55rem; font-size: 0.72rem; background: #f5f5f4; color: var(--ink); vertical-align: middle; }
.badge-good { background: var(--good-soft); color: var(--good); border-color: #bbf7d0; }
.badge-bad { background: var(--bad-soft); color: var(--bad); border-color: #fecaca; }
.badge-warn { background: var(--warn-soft); color: var(--warn); border-color: #fde68a; }
.badge-unknown { background: var(--unknown-soft); color: var(--unknown); border-color: #ddd6fe; }
.badge-accent { background: var(--accent-soft); color: var(--accent); border-color: #bbf7d0; }
.table-wrap { overflow-x: auto; margin: 0.6rem 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.86rem; }
th { text-align: left; background: #f5f5f4; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
th, td { border: 1px solid var(--line); padding: 0.4rem 0.6rem; vertical-align: top; }
p.empty { color: var(--muted); font-style: italic; font-size: 0.86rem; }
form.stack { display: grid; gap: 0.6rem; max-width: 70ch; }
form.stack label { display: grid; gap: 0.2rem; font-size: 0.85rem; color: var(--muted); }
form.stack input[type="text"], form.stack textarea, form.stack input[type="datetime-local"] {
  font: inherit; padding: 0.45rem 0.6rem; border: 1px solid var(--line); border-radius: 8px; background: #fff;
}
form.stack textarea { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.8rem; min-height: 14rem; }
form.stack button { justify-self: start; background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 0.5rem 1.1rem; font: inherit; cursor: pointer; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 0.9rem; }
article.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 0.85rem 1rem; }
article.card h3 { margin: 0 0 0.3rem; font-size: 0.95rem; }
article.card p { margin: 0.25rem 0; font-size: 0.85rem; color: var(--muted); }
.note { font-size: 0.8rem; color: var(--muted); }
.error-box { background: var(--bad-soft); border: 1px solid #fecaca; border-radius: 10px; padding: 0.8rem 1rem; }
.counts { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.4rem 0; }
.updown { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 760px) { .updown { grid-template-columns: 1fr; } }
.updown h4 { margin: 0.2rem 0 0.3rem; font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.link-line { font-size: 0.82rem; margin: 0.2rem 0; word-break: break-all; }
.evidence-provenance { color: var(--muted); font-size: 0.78rem; }
`;

export interface NavEntry {
  path: string;
  label: string;
}

export const NAV: readonly NavEntry[] = [
  { path: '/', label: 'Overview' },
  { path: '/mission', label: 'Mission' },
  { path: '/import', label: 'System import' },
  { path: '/reconciliation', label: 'Reconciliation' },
  { path: '/evidence', label: 'Evidence' },
  { path: '/candidates', label: 'Candidates' },
  { path: '/assurance', label: 'Assurance' },
  { path: '/experiments', label: 'Experiments' },
  { path: '/ask', label: 'ASK' },
  { path: '/rollback', label: 'Rollback' },
  { path: '/packages', label: 'Packages' },
  { path: '/history', label: 'History' },
  { path: '/evolution', label: 'Self-evolution' },
];

/** The full document wrapper (semantic HTML, sticky footer, inline CSS). */
export function page(title: string, activePath: string, body: string): string {
  const nav = NAV.map(
    (entry) =>
      `<a href="${entry.path}"${entry.path === activePath ? ' class="active"' : ''}>${esc(entry.label)}</a>`,
  ).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — SOS 2.0 Console</title>
<style>${CSS}</style>
</head>
<body>
<header class="site">
  <h1>SOS 2.0 — Human Console</h1>
  <p>mission-governed evolutionary control plane · every consequential decision exposes its rationale chain</p>
</header>
<nav class="journeys" aria-label="Journeys">${nav}</nav>
<main>
${body}
</main>
<footer class="site">
  <span>SOS 2.0 console (W11) · deterministic server-rendered view-models from <code>@sos-2/ui-contracts</code> · demo fixture, zero network · the repository is the sole durable authority</span>
</footer>
</body>
</html>`;
}
