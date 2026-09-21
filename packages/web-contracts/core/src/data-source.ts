/**
 * Data-source provenance — the P1 demo-honesty contract.
 *
 * ARCHITECT_START_HERE.md: "The product must never make demo fixture state
 * look like live state." spec/productization-requirements.md: "Demo fixtures
 * are explicitly DEMO/SIMULATED."
 *
 * EVERY product-shell view model carries a `data_source` field of this type.
 * A view model projected from the DEMO dataset ALWAYS carries
 * `{ kind: 'DEMO', label: DEMO_MARKER_TEXT, fixture_revision }` — the label
 * is rendered as a visible badge on every fixture-backed surface, and a
 * projection that drops or alters the marker is REJECTED by its validator
 * (pinned by tests). The LIVE variant exists in the contract so the live
 * data plane (Work Order P2) can fill the same shape without changing any
 * view model; producing a LIVE-marked view model from the demo dataset is
 * structurally impossible because the demo projections hard-code the DEMO
 * provenance.
 *
 * Pure types + pure functions: deterministic, zero DOM dependencies.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import { WebContractError } from './errors.js';

/**
 * The exact badge text rendered on every fixture-backed surface. The string
 * is part of the CONTRACT (tests pin it); changing it is a contract change.
 */
export const DEMO_MARKER_TEXT = 'DEMO — SIMULATED DATA';

/** The demo data source: clearly-labelled, revision-pinned fixture data. */
export interface DemoProvenance {
  kind: 'DEMO';
  /** Always DEMO_MARKER_TEXT (validated; never altered or dropped). */
  label: string;
  /** The exact repository revision the fixture dataset is pinned to (static literal). */
  fixture_revision: string;
  /** One-line explanation of what the fixture is (rendered with the badge). */
  note: string;
}

/** The live data source: authoritative durable stores (Work Order P2 and later). */
export interface LiveProvenance {
  kind: 'LIVE';
  /** The durable store reference the data was read from (never a queue). */
  store_ref: string;
  /** The exact read revision or instant (RFC3339 / revision token; caller-supplied, never a hidden clock). */
  as_of: string;
}

export type DataSource = DemoProvenance | LiveProvenance;

/** Build the DEMO data-source provenance for the fixed fixture revision. */
export function demoDataSource(fixtureRevision: string, note: string): DemoProvenance {
  return {
    kind: 'DEMO',
    label: DEMO_MARKER_TEXT,
    fixture_revision: fixtureRevision,
    note,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate a DataSource (throws WebContractError). A DEMO source whose label
 * is not exactly DEMO_MARKER_TEXT is REJECTED — the visible demo badge is a
 * structural property of every fixture-backed surface, not a decoration.
 */
export function assertValidDataSource(value: unknown): asserts value is DataSource {
  if (!isPlainObject(value)) {
    throw new WebContractError(`data source must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  if (record['kind'] === 'DEMO') {
    const keys = Object.keys(record);
    const expected = new Set(['kind', 'label', 'fixture_revision', 'note']);
    if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
      throw new WebContractError('demo data source must have the exact field set { kind, label, fixture_revision, note }');
    }
    if (record['label'] !== DEMO_MARKER_TEXT) {
      throw new WebContractError(
        `demo data source label must be exactly ${JSON.stringify(DEMO_MARKER_TEXT)}, received: ${JSON.stringify(record['label'])}`,
      );
    }
    if (!isNonEmptyString(record['fixture_revision'])) {
      throw new WebContractError('demo data source fixture_revision must be a non-empty revision token');
    }
    if (!isNonEmptyString(record['note'])) {
      throw new WebContractError('demo data source note must be a non-empty string');
    }
    return;
  }
  if (record['kind'] === 'LIVE') {
    const keys = Object.keys(record);
    const expected = new Set(['kind', 'store_ref', 'as_of']);
    if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
      throw new WebContractError('live data source must have the exact field set { kind, store_ref, as_of }');
    }
    if (!isNonEmptyString(record['store_ref'])) {
      throw new WebContractError('live data source store_ref must be a non-empty durable store reference');
    }
    if (!isNonEmptyString(record['as_of'])) {
      throw new WebContractError('live data source as_of must be a non-empty revision token or RFC3339 instant');
    }
    return;
  }
  throw new WebContractError(
    `data source kind must be 'DEMO' or 'LIVE', received: ${JSON.stringify(record['kind'])}`,
  );
}

/** Predicate form of assertValidDataSource. */
export function isValidDataSource(value: unknown): value is DataSource {
  try {
    assertValidDataSource(value);
    return true;
  } catch {
    return false;
  }
}

/** Is this view model fixture-backed (DEMO)? (Negation of isLiveBacked.) */
export function isDemoBacked(value: { data_source: DataSource }): boolean {
  return value.data_source.kind === 'DEMO';
}

/** Is this view model backed by the live durable stores? */
export function isLiveBacked(value: { data_source: DataSource }): boolean {
  return value.data_source.kind === 'LIVE';
}

/**
 * The path-safe decomposition of a spine artifact id for rationale
 * deep-links: `sos://<Kind>/<segment>` -> { kind, segment }. Round-trips with
 * {@link composeRationaleSubject}. Throws for a malformed id — deep links are
 * only ever built from validated spine ids.
 */
export function decomposeRationaleSubject(subjectId: string): { kind: string; segment: string } {
  if (!isArtifactId(subjectId)) {
    throw new WebContractError(
      `rationale deep-link subjects must be well-formed spine artifact ids, received: ${JSON.stringify(subjectId)}`,
    );
  }
  const withoutScheme = subjectId.slice('sos://'.length);
  const separator = withoutScheme.lastIndexOf('/');
  return {
    kind: withoutScheme.slice(0, separator),
    segment: withoutScheme.slice(separator + 1),
  };
}

/** Recompose a spine artifact id from its path-safe parts. */
export function composeRationaleSubject(kind: string, segment: string): string {
  return `sos://${kind}/${segment}`;
}

/**
 * Is this a well-formed spine artifact id — i.e. a valid rationale subject?
 * A thin predicate over the spine's own guard (the id vocabulary belongs to
 * @sos-2/semantic-spine; this is only an ergonomic re-export for shells).
 */
export function isWellFormedSubject(value: unknown): value is string {
  return isArtifactId(value);
}
