/**
 * Monitor definitions and monitor events — the typed vocabulary of the W8
 * runtime verification adapter contract (Work Order W8: "typed monitor
 * definitions"; spec/architecture.md section 13 "runtime verification",
 * section 17 platform neutrality).
 *
 * A MonitorDefinition is a TYPED VALUE (exactly like @sos-2/conformance's
 * Invariant — deliberately NOT an artifact): monitors are declarations
 * evaluated at specific revisions, and their RESULTS are the consequential
 * artifacts (Evidence records, minted through the merged W3 authority).
 *
 * The property DSL is intentionally small and typed:
 *
 *   ALWAYS     an invariant predicate: every observed event for the
 *              predicate must witness it holding. Absence of observation is
 *              never treated as observation of absence.
 *
 *   RESPONSE   a response property: every observed trigger event must be
 *              followed by a response event, optionally within a time
 *              bound. Vacuous traces (no trigger ever observed) are never
 *              reported as satisfied.
 *
 *   CUSTOM     an engine-specific property payload. The reference engine
 *              cannot evaluate these and truthfully reports UNSUPPORTED —
 *              real engines are adapters, and the open kind is how external
 *              verification engines (LTL/MTL monitors, metric aggregators,
 *              ...) plug in without this package redefining their semantics.
 *
 * MonitorEvent is the minimal honest observation shape: a named predicate,
 * whether it was witnessed to HOLD at an instant, and when. Events carry no
 * truth-state assignment of their own — truth states are assigned only when
 * evidence records are minted, under explicit method provenance (W3
 * discipline: telemetry is input, not semantic truth).
 */

import { RFC3339_PATTERN, canonicalSerialize } from '@sos-2/semantic-spine';
import { MonitorError } from './errors.js';

// ---------------------------------------------------------------------------
// Monitor properties
// ---------------------------------------------------------------------------

export const MONITOR_PROPERTY_KINDS = ['ALWAYS', 'RESPONSE', 'CUSTOM'] as const;

export type MonitorPropertyKind = (typeof MONITOR_PROPERTY_KINDS)[number];

const MONITOR_PROPERTY_KIND_SET: ReadonlySet<string> = new Set(MONITOR_PROPERTY_KINDS);

export function isMonitorPropertyKind(value: unknown): value is MonitorPropertyKind {
  return typeof value === 'string' && MONITOR_PROPERTY_KIND_SET.has(value);
}

/** An invariant property: `predicate` must hold at every observed point. */
export interface AlwaysProperty {
  kind: 'ALWAYS';
  /** The named predicate being monitored (non-empty). */
  predicate: string;
  /** Human-readable statement of the property (non-empty). */
  description: string;
}

/** A response property: every observed `trigger` must be followed by `response`. */
export interface ResponseProperty {
  kind: 'RESPONSE';
  /** The named trigger predicate (non-empty). */
  trigger: string;
  /** The named response predicate (non-empty, distinct from the trigger). */
  response: string;
  /** Response deadline in milliseconds, or null for an unbounded eventual response. */
  within_ms: number | null;
  /** Human-readable statement of the property (non-empty). */
  description: string;
}

/** An engine-specific property payload (platform neutrality escape hatch). */
export interface CustomProperty {
  kind: 'CUSTOM';
  /** The engine this property is written for (non-empty). */
  engine: string;
  /** The engine-specific property payload (any canonical-serializable JSON value). */
  payload: unknown;
  /** Human-readable statement of the property (non-empty). */
  description: string;
}

export type MonitorProperty = AlwaysProperty | ResponseProperty | CustomProperty;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

/** Validate an ALWAYS property (throws MonitorError). */
export function assertValidAlwaysProperty(value: unknown): asserts value is AlwaysProperty {
  if (!isPlainObject(value) || !hasExactKeys(value, ['kind', 'predicate', 'description'])) {
    throw new MonitorError('ALWAYS property must be an object with exact fields { kind, predicate, description }');
  }
  if (!isNonEmptyString(value['predicate'])) {
    throw new MonitorError(`ALWAYS property predicate must be a non-empty string, received: ${JSON.stringify(value['predicate'])}`);
  }
  if (!isNonEmptyString(value['description'])) {
    throw new MonitorError(`ALWAYS property description must be a non-empty string, received: ${JSON.stringify(value['description'])}`);
  }
}

/** Validate a RESPONSE property (throws MonitorError). */
export function assertValidResponseProperty(value: unknown): asserts value is ResponseProperty {
  if (!isPlainObject(value) || !hasExactKeys(value, ['kind', 'trigger', 'response', 'within_ms', 'description'])) {
    throw new MonitorError(
      'RESPONSE property must be an object with exact fields { kind, trigger, response, within_ms, description }',
    );
  }
  if (!isNonEmptyString(value['trigger'])) {
    throw new MonitorError(`RESPONSE property trigger must be a non-empty string, received: ${JSON.stringify(value['trigger'])}`);
  }
  if (!isNonEmptyString(value['response'])) {
    throw new MonitorError(`RESPONSE property response must be a non-empty string, received: ${JSON.stringify(value['response'])}`);
  }
  if (value['trigger'] === value['response']) {
    throw new MonitorError(
      `RESPONSE property trigger and response must be distinct predicates, received: ${JSON.stringify(value['trigger'])}`,
    );
  }
  const within = value['within_ms'];
  if (within !== null && (typeof within !== 'number' || !Number.isInteger(within) || within <= 0)) {
    throw new MonitorError(
      `RESPONSE property within_ms must be null or a positive integer (milliseconds), received: ${JSON.stringify(within)}`,
    );
  }
  if (!isNonEmptyString(value['description'])) {
    throw new MonitorError(`RESPONSE property description must be a non-empty string, received: ${JSON.stringify(value['description'])}`);
  }
}

/** Validate a CUSTOM property (throws MonitorError). */
export function assertValidCustomProperty(value: unknown): asserts value is CustomProperty {
  if (!isPlainObject(value) || !hasExactKeys(value, ['kind', 'engine', 'payload', 'description'])) {
    throw new MonitorError('CUSTOM property must be an object with exact fields { kind, engine, payload, description }');
  }
  if (!isNonEmptyString(value['engine'])) {
    throw new MonitorError(`CUSTOM property engine must be a non-empty string, received: ${JSON.stringify(value['engine'])}`);
  }
  if (!isNonEmptyString(value['description'])) {
    throw new MonitorError(`CUSTOM property description must be a non-empty string, received: ${JSON.stringify(value['description'])}`);
  }
  try {
    canonicalSerialize(value['payload']);
  } catch (cause) {
    throw new MonitorError(`CUSTOM property payload must be a canonical-serializable JSON value: ${(cause as Error).message}`);
  }
}

/**
 * Validate a monitor property (throws MonitorError). The kind discriminates
 * the exact field set; unknown kinds are rejected loudly.
 */
export function assertValidMonitorProperty(value: unknown): asserts value is MonitorProperty {
  if (!isPlainObject(value)) {
    throw new MonitorError('monitor property must be an object');
  }
  switch (value['kind']) {
    case 'ALWAYS':
      assertValidAlwaysProperty(value);
      return;
    case 'RESPONSE':
      assertValidResponseProperty(value);
      return;
    case 'CUSTOM':
      assertValidCustomProperty(value);
      return;
    default:
      throw new MonitorError(
        `monitor property kind must be one of ALWAYS / RESPONSE / CUSTOM, received: ${JSON.stringify(value['kind'])}`,
      );
  }
}

/** Predicate form of assertValidMonitorProperty. */
export function validateMonitorProperty(value: unknown): value is MonitorProperty {
  try {
    assertValidMonitorProperty(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Monitor definitions
// ---------------------------------------------------------------------------

/** A typed monitor definition: an id plus the property it monitors. */
export interface MonitorDefinition {
  /** Monitor id (non-empty, e.g. "monitor:payments-slo"). */
  id: string;
  /** The monitored property. */
  property: MonitorProperty;
}

/** Validate a monitor definition (throws MonitorError). */
export function assertValidMonitorDefinition(value: unknown): asserts value is MonitorDefinition {
  if (!isPlainObject(value) || !hasExactKeys(value, ['id', 'property'])) {
    throw new MonitorError('monitor definition must be an object with exact fields { id, property }');
  }
  if (!isNonEmptyString(value['id'])) {
    throw new MonitorError(`monitor id must be a non-empty string, received: ${JSON.stringify(value['id'])}`);
  }
  assertValidMonitorProperty(value['property']);
}

/** Predicate form of assertValidMonitorDefinition. */
export function validateMonitorDefinition(value: unknown): value is MonitorDefinition {
  try {
    assertValidMonitorDefinition(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Monitor events
// ---------------------------------------------------------------------------

/**
 * One observed point: the named predicate was witnessed to hold (true) or
 * NOT to hold (false) at an instant. Events are INPUT (telemetry-shaped
 * observations), never semantic truth — truth states are assigned only in
 * the minted evidence, under explicit method provenance.
 */
export interface MonitorEvent {
  /** The named predicate this event speaks about (non-empty). */
  predicate: string;
  /** Whether the predicate was witnessed to hold at this point. */
  holds: boolean;
  /** RFC3339 instant of the observed point. */
  at: string;
}

/** Validate a monitor event (throws MonitorError). */
export function assertValidMonitorEvent(value: unknown): asserts value is MonitorEvent {
  if (!isPlainObject(value) || !hasExactKeys(value, ['predicate', 'holds', 'at'])) {
    throw new MonitorError('monitor event must be an object with exact fields { predicate, holds, at }');
  }
  if (!isNonEmptyString(value['predicate'])) {
    throw new MonitorError(`monitor event predicate must be a non-empty string, received: ${JSON.stringify(value['predicate'])}`);
  }
  if (typeof value['holds'] !== 'boolean') {
    throw new MonitorError(`monitor event holds must be a boolean, received: ${JSON.stringify(value['holds'])}`);
  }
  if (typeof value['at'] !== 'string' || !RFC3339_PATTERN.test(value['at'])) {
    throw new MonitorError(`monitor event at must be an RFC3339 timestamp, received: ${JSON.stringify(value['at'])}`);
  }
}

/** Validate a list of monitor events (throws MonitorError). */
export function assertValidMonitorEvents(value: unknown): asserts value is MonitorEvent[] {
  if (!Array.isArray(value)) {
    throw new MonitorError('monitor events must be an array of { predicate, holds, at } records');
  }
  for (const event of value) {
    assertValidMonitorEvent(event);
  }
}
