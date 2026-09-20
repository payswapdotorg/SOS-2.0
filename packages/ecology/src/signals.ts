/**
 * Decay/obsolescence signals and the maturity REVIEW queue (Work Order W13;
 * docs/package-ecology.md lifecycle: "... -> SUPERSEDED/RETIRED"; the
 * longevity/decay evidence class).
 *
 * DESIGN (the no-auto-demotion discipline, machine-checked structurally):
 *   - Signals are TYPED records over a frozen four-kind vocabulary: USAGE_DECAY,
 *     FAILURE_RATE_GROWTH, DEPENDENCY_DEPRECATION, SUPERSESSION_AGE. The
 *     vocabulary is closed — an invented "demote" or "retire" signal kind is
 *     REJECTED (there is no signal that demotes).
 *   - Signals are EVIDENCE-SHAPED INPUT ONLY: every signal MUST carry a
 *     non-empty set of well-formed sos://Evidence refs. An evidence-free
 *     decay signal is REJECTED — decay claims are claims about system
 *     reality (spec/architecture.md §18).
 *   - Signals feed a maturity REVIEW QUEUE — a read-only view for the
 *     governed review process. Signals NEVER auto-demote: the queue has NO
 *     API that changes package maturity (demotion, retirement and
 *     supersession stay governed decisions of the W6 maturity lifecycle —
 *     spec/architecture-lock.md places Package maturity outside ordinary
 *     redefinition, and AGENTS.md §7 forbids silent autonomy). This is
 *     enforced structurally (no mutation path exists) and asserted by tests.
 *   - DETERMINISM: ids are content-addressed; queue order is canonical
 *     (package id, then observed_at, then id); snapshots round-trip.
 */

import { fullContentHash, isArtifactId, parseArtifactId, RFC3339_PATTERN } from '@sos-2/semantic-spine';
import { EcologyError } from './errors.js';

/** The frozen decay/obsolescence signal kinds (a closed vocabulary). */
export const DECAY_SIGNAL_KINDS = [
  /** Observed usage of the package is decaying (usage telemetry declining). */
  'USAGE_DECAY',
  /** The package's observed failure rate is growing (incident/telemetry trend). */
  'FAILURE_RATE_GROWTH',
  /** A dependency of the package has been deprecated upstream. */
  'DEPENDENCY_DEPRECATION',
  /** The package has been functionally surpassed for longer than a threshold (supersession age). */
  'SUPERSESSION_AGE',
] as const;

export type DecaySignalKind = (typeof DECAY_SIGNAL_KINDS)[number];

const DECAY_SIGNAL_KIND_SET: ReadonlySet<string> = new Set(DECAY_SIGNAL_KINDS);

/** Structural check: one of the four decay signal kinds? */
export function isDecaySignalKind(value: unknown): value is DecaySignalKind {
  return typeof value === 'string' && DECAY_SIGNAL_KIND_SET.has(value);
}

/** One typed decay/obsolescence signal about a package (evidence-shaped input). */
export interface DecaySignal {
  /** Deterministic content-addressed id (64 lowercase hex; NOT a spine artifact id). */
  id: string;
  /** The package the signal is about (sos://Package/<32 hex>). */
  package_id: string;
  /** One of the four frozen signal kinds. */
  kind: DecaySignalKind;
  /** RFC3339 observation timestamp (caller-supplied; never a hidden clock). */
  observed_at: string;
  /** NON-EMPTY, well-formed sos://Evidence ids — signals are Evidence-shaped input only. */
  evidence_refs: string[];
  /** Who/what recorded the signal — non-empty entries. */
  provenance: string[];
  /** Optional statement, or null. */
  note: string | null;
}

/** Input to a decay signal (id is derived). */
export interface DecaySignalInput {
  package_id: string;
  kind: DecaySignalKind;
  observed_at: string;
  /** NON-EMPTY; each entry a well-formed sos://Evidence id. */
  evidence_refs: string[];
  /** NON-EMPTY entries. */
  provenance: string[];
  note?: string | null;
}

/** The exact value a signal id is derived from (exported for reproduction). */
export interface DecaySignalContent {
  package_id: string;
  kind: DecaySignalKind;
  observed_at: string;
  evidence_refs: string[];
  provenance: string[];
  note: string | null;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a decay signal input (throws EcologyError with a specific message). */
export function assertValidDecaySignalInput(value: unknown): asserts value is DecaySignalInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EcologyError(`decay signal input must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const packageId = record['package_id'];
  if (!isArtifactId(packageId)) {
    throw new EcologyError(`decay signal package_id must be a well-formed spine artifact id, received: ${JSON.stringify(packageId)}`);
  }
  if (parseArtifactId(packageId).kind !== 'Package') {
    throw new EcologyError(
      `decay signal package_id must be a Package id (sos://Package/...), received: ${JSON.stringify(packageId)}`,
    );
  }
  if (!isDecaySignalKind(record['kind'])) {
    throw new EcologyError(
      `decay signal kind must be one of ${DECAY_SIGNAL_KINDS.join(', ')} (frozen vocabulary — there is no signal ` +
        `kind that demotes; demotion stays a governed decision), received: ${JSON.stringify(record['kind'])}`,
    );
  }
  const observedAt = record['observed_at'];
  if (typeof observedAt !== 'string' || !RFC3339_PATTERN.test(observedAt)) {
    throw new EcologyError(`decay signal observed_at must be an RFC3339 timestamp, received: ${JSON.stringify(observedAt)}`);
  }
  const evidenceRefs = record['evidence_refs'];
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new EcologyError(
      'decay signal evidence_refs must be a NON-EMPTY array — signals are Evidence-shaped input only; ' +
        'an evidence-free decay signal is REJECTED (spec/architecture.md §18)',
    );
  }
  for (const ref of evidenceRefs) {
    if (!isArtifactId(ref)) {
      throw new EcologyError(`decay signal evidence_refs entries must be well-formed spine ids, received: ${JSON.stringify(ref)}`);
    }
    if (parseArtifactId(ref).kind !== 'Evidence') {
      throw new EcologyError(
        `decay signal evidence_refs entries must be Evidence ids (sos://Evidence/...), received: ${JSON.stringify(ref)}`,
      );
    }
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new EcologyError('decay signal provenance must be a non-empty array of non-empty strings');
  }
  if (record['note'] !== undefined && record['note'] !== null && typeof record['note'] !== 'string') {
    throw new EcologyError(`decay signal note must be null or a string, received: ${JSON.stringify(record['note'])}`);
  }
}

/** The exact derivation content of a decay signal input (canonical evidence order). */
export function decaySignalContent(input: DecaySignalInput): DecaySignalContent {
  assertValidDecaySignalInput(input);
  return {
    package_id: input.package_id,
    kind: input.kind,
    observed_at: input.observed_at,
    evidence_refs: [...new Set(input.evidence_refs)].sort(compareStrings),
    provenance: [...input.provenance],
    note: input.note ?? null,
  };
}

/** Deterministic content-addressed decay signal id. */
export function decaySignalId(input: DecaySignalInput): string {
  return fullContentHash(decaySignalContent(input));
}

/** Create a validated decay signal (id derived; evidence canonically sorted unique). */
export function createDecaySignal(input: DecaySignalInput): DecaySignal {
  const content = decaySignalContent(input);
  return { id: fullContentHash(content), ...content };
}

/** Full semantic validation of a stored decay signal (throws EcologyError). */
export function assertValidDecaySignal(value: unknown): asserts value is DecaySignal {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EcologyError(`decay signal must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const hasNote = 'note' in record;
  if (Object.keys(record).length !== (hasNote ? 7 : 6) || !('id' in record)) {
    throw new EcologyError(
      'decay signal must have the exact field set { id, package_id, kind, observed_at, evidence_refs, provenance, note }',
    );
  }
  if (typeof record['id'] !== 'string' || !/^[0-9a-f]{64}$/.test(record['id'])) {
    throw new EcologyError(`decay signal id must be 64 lowercase hex chars, received: ${JSON.stringify(record['id'])}`);
  }
  // Re-validate everything through the input validator, then the content address.
  assertValidDecaySignalInput({
    package_id: record['package_id'],
    kind: record['kind'],
    observed_at: record['observed_at'],
    evidence_refs: record['evidence_refs'],
    provenance: record['provenance'],
    note: hasNote ? (record['note'] as string | null) : null,
  });
  const content: DecaySignalContent = {
    package_id: record['package_id'] as string,
    kind: record['kind'] as DecaySignalKind,
    observed_at: record['observed_at'] as string,
    evidence_refs: record['evidence_refs'] as string[],
    provenance: record['provenance'] as string[],
    note: (hasNote ? record['note'] : null) as string | null,
  };
  if (fullContentHash(content) !== record['id']) {
    throw new EcologyError(
      `decay signal id does not match its content (content-address discipline): ${JSON.stringify(record['id'])}`,
    );
  }
}

/** One package's maturity review queue item (read-only governed-review input). */
export interface MaturityReviewItem {
  /** The package under review. */
  package_id: string;
  /** All signals for the package, sorted by (observed_at, id). */
  signals: DecaySignal[];
  /** Counts per signal kind (all four kinds always present). */
  signal_counts: Record<DecaySignalKind, number>;
}

/** A serializable review queue snapshot (round-trips through restore). */
export interface MaturityReviewQueueSnapshot {
  /** All signals, canonically sorted by id. */
  signals: DecaySignal[];
}

/**
 * The maturity REVIEW queue.
 *
 * Signals accumulate here as Evidence-shaped INPUT for the governed review
 * process. The queue NEVER demotes a package: there is no API that changes
 * package maturity (no demote, no retire, no supersede, no promote) —
 * demotion stays a governed decision of the W6 maturity lifecycle, made by
 * the authority through the registry's evidence-gated paths, never by a
 * signal (AGENTS.md §7 "No silent autonomy").
 */
export class MaturityReviewQueue {
  private readonly signals = new Map<string, DecaySignal>();

  /**
   * Record a decay/obsolescence signal. Validates the typed signal (frozen
   * kind vocabulary, non-empty evidence refs); idempotent by content.
   */
  recordSignal(input: DecaySignalInput): DecaySignal {
    const signal = createDecaySignal(input);
    const existing = this.signals.get(signal.id);
    if (existing !== undefined) {
      return structuredClone(existing);
    }
    const stored = structuredClone(signal);
    this.signals.set(stored.id, stored);
    return structuredClone(stored);
  }

  /** All signals about one package, sorted by (observed_at, id). */
  signalsFor(packageId: string): DecaySignal[] {
    return [...this.signals.values()]
      .filter((signal) => signal.package_id === packageId)
      .sort((a, b) => compareStrings(`${a.observed_at}\u0000${a.id}`, `${b.observed_at}\u0000${b.id}`))
      .map((signal) => structuredClone(signal));
  }

  /** The review item for one package, or null when the package has no signals. */
  reviewQueueFor(packageId: string): MaturityReviewItem | null {
    const signals = this.signalsFor(packageId);
    if (signals.length === 0) {
      return null;
    }
    return { package_id: packageId, signals, signal_counts: countKinds(signals) };
  }

  /**
   * The full review queue: one item per signaled package, sorted by package
   * id (deterministic, canonical). This is the READ-ONLY governed-review
   * surface — consuming it changes nothing.
   */
  reviewQueue(): MaturityReviewItem[] {
    const packages = [...new Set([...this.signals.values()].map((signal) => signal.package_id))].sort(compareStrings);
    return packages
      .map((packageId) => this.reviewQueueFor(packageId)!)
      .map((item) => structuredClone(item));
  }

  /** All signals, canonically sorted by id. */
  allSignals(): DecaySignal[] {
    return [...this.signals.values()]
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((signal) => structuredClone(signal));
  }

  get size(): number {
    return this.signals.size;
  }

  /** A serializable snapshot (signals canonically sorted by id). */
  snapshot(): MaturityReviewQueueSnapshot {
    return { signals: this.allSignals() };
  }

  /** Rebuild a queue from a snapshot (validated; canonical round trip). */
  static restore(snapshot: MaturityReviewQueueSnapshot): MaturityReviewQueue {
    if (!isPlainObject(snapshot)) {
      throw new EcologyError(`review queue snapshot must be an object { signals }, received: ${JSON.stringify(snapshot)}`);
    }
    const record = snapshot;
    if (Object.keys(record).length !== 1 || !('signals' in record)) {
      throw new EcologyError('review queue snapshot must have the exact field set { signals }');
    }
    if (!Array.isArray(record['signals'])) {
      throw new EcologyError('review queue snapshot signals must be an array');
    }
    const queue = new MaturityReviewQueue();
    for (const value of record['signals']) {
      assertValidDecaySignal(value);
      const stored = structuredClone(value as DecaySignal);
      const existing = queue.signals.get(stored.id);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(stored)) {
          throw new EcologyError(`review queue snapshot contains conflicting signals with id ${stored.id}`);
        }
        continue;
      }
      queue.signals.set(stored.id, stored);
    }
    return queue;
  }
}

function countKinds(signals: readonly DecaySignal[]): Record<DecaySignalKind, number> {
  const counts: Record<DecaySignalKind, number> = {
    USAGE_DECAY: 0,
    FAILURE_RATE_GROWTH: 0,
    DEPENDENCY_DEPRECATION: 0,
    SUPERSESSION_AGE: 0,
  };
  for (const signal of signals) {
    counts[signal.kind] += 1;
  }
  return counts;
}
