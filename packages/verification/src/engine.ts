/**
 * The runtime monitor engine CONTRACT (Work Order W8: "an interface for
 * pluggable runtime verification engines (monitors)"; spec/architecture.md
 * section 17: "Platforms and vendors are adapters or contexts. They do not
 * redefine SOS semantics.").
 *
 * ADAPTERS ARE NOT AUTHORITY. The contract — not the engine — decides what
 * a truthful result looks like:
 *
 *   1. The verdict vocabulary is SATISFIED / VIOLATED / INCONCLUSIVE
 *      (never conflated).
 *
 *   2. The verdict-to-availability mapping is FROZEN:
 *
 *        SATISFIED     -> SUCCESS        (exactly)
 *        VIOLATED      -> FAILURE        (exactly)
 *        INCONCLUSIVE  -> UNKNOWN | UNAVAILABLE | UNSUPPORTED | PARTIAL
 *                        (whichever sub-cause is truthful — all four honest
 *                        not-conclusive states stay distinct)
 *
 *      assertValidMonitorEvaluationResult REJECTS any engine output that
 *      violates the mapping (a monitor claiming VIOLATED with availability
 *      SUCCESS is a lying adapter and is refused).
 *
 *   3. Evidence is minted through the merged W3 authority
 *      (@sos-2/evidence createEvidence — kind "runtime-monitor", spine
 *      content-addressed ids, explicit method provenance
 *      `runtime-verification:<engine-id>`), and every result binds to the
 *      EXACT SystemState/implementation revisions declared in the
 *      evaluation context (subject_ref = system_state_id; subject_revision
 *      = the exact revision token; source_revision = the implementation
 *      revision; deployment_revision preserved, never defaulted).
 *
 * evaluateMonitor(engine, monitor, events, context) is the SANCTIONED entry
 * point: it validates all inputs, delegates to the engine, then validates
 * the engine's output against the contract (mapping + evidence validity +
 * revision binding + OBSERVES link). Engines whose outputs fail the guard
 * are refused loudly — calling engine.evaluate directly is the adapter's
 * own business, not a sanctioned path.
 */

import { createTraceLink, isArtifactId } from '@sos-2/semantic-spine';
import type { EvidenceTruthState, TraceLink } from '@sos-2/semantic-spine';
import { contentHash } from '@sos-2/semantic-spine';
import { assertValidEvidenceRecord, createEvidence, unquantifiedConfidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { assertValidProducer, isRfc3339 } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { MonitorEngineError } from './errors.js';
import { assertValidMonitorDefinition, assertValidMonitorEvents } from './monitor.js';
import type { MonitorDefinition, MonitorEvent } from './monitor.js';

// ---------------------------------------------------------------------------
// Public vocabulary
// ---------------------------------------------------------------------------

/** The evidence kind minted by runtime monitor evaluation. */
export const RUNTIME_MONITOR_EVIDENCE_KIND = 'runtime-monitor';

export const MONITOR_VERDICTS = ['SATISFIED', 'VIOLATED', 'INCONCLUSIVE'] as const;

export type MonitorVerdict = (typeof MONITOR_VERDICTS)[number];

/**
 * The frozen verdict -> allowed availability mapping (the anti-conflation
 * guard backing): SATISFIED is only ever SUCCESS, VIOLATED is only ever
 * FAILURE, and INCONCLUSIVE is one of the four honest not-conclusive truth
 * states — each chosen for its truthful sub-cause, never folded together.
 */
export const MONITOR_VERDICT_AVAILABILITY: Readonly<Record<MonitorVerdict, readonly EvidenceTruthState[]>> = {
  SATISFIED: ['SUCCESS'],
  VIOLATED: ['FAILURE'],
  INCONCLUSIVE: ['UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'],
};

export function availabilityAllowedForVerdict(verdict: MonitorVerdict, availability: EvidenceTruthState): boolean {
  return MONITOR_VERDICT_AVAILABILITY[verdict].includes(availability);
}

// ---------------------------------------------------------------------------
// Evaluation context and result
// ---------------------------------------------------------------------------

/**
 * The exact revision binding of a monitor evaluation. Every field is
 * caller-supplied (no hidden clocks, no ambient state).
 */
export interface MonitorEvaluationContext {
  /** RFC3339 evaluation instant. */
  now: string;
  /** The EXACT SystemState artifact id being monitored. */
  system_state_id: string;
  /** The EXACT SystemState envelope version being monitored (integer >= 1). */
  system_state_version: number;
  /** The exact subject revision token (e.g. "<system-state-id>@v<version>"). */
  subject_revision: string;
  /** Exact implementation revision, or null (preserved, never defaulted). */
  implementation_revision: string | null;
  /** Exact deployment revision, or null (preserved, never defaulted). */
  deployment_revision: string | null;
  /** WHO/WHAT produced this evaluation (provenance; LLM producers allowed but never authoritative). */
  producer: Producer;
}

/** The result an engine must produce for one monitor over one event list. */
export interface MonitorEvaluationResult {
  /** Echo of the evaluated monitor id. */
  monitor_id: string;
  /** SATISFIED / VIOLATED / INCONCLUSIVE. */
  verdict: MonitorVerdict;
  /** Truthful availability under the frozen mapping. */
  availability: EvidenceTruthState;
  /** Deterministic human-readable explanation. */
  reason: string;
  /** The minted evidence record (kind "runtime-monitor"). */
  evidence: EvidenceRecordW3;
  /** OBSERVES (evidence -> SystemState) trace links. */
  links: TraceLink[];
}

/**
 * The pluggable runtime verification engine contract. Real engines
 * (external monitors, LTL checkers, metric engines) are ADAPTERS behind
 * this interface; they never redefine the semantics above.
 */
export interface RuntimeMonitorEngine {
  /** Engine identifier (non-empty, e.g. "runtime-verification:in-memory-reference"). */
  id: string;
  /** The monitor property kinds this engine declares support for. */
  supportedProperties: readonly MonitorPropertyKindOfEngine[];
  /** Evaluate one monitor over one event list at one exact revision binding. */
  evaluate(
    monitor: MonitorDefinition,
    events: readonly MonitorEvent[],
    context: MonitorEvaluationContext,
  ): MonitorEvaluationResult;
}

/** Local alias to keep the engine interface self-contained (kind strings). */
type MonitorPropertyKindOfEngine = 'ALWAYS' | 'RESPONSE' | 'CUSTOM';

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate an evaluation context (throws MonitorEngineError). */
export function assertValidMonitorEvaluationContext(value: unknown): asserts value is MonitorEvaluationContext {
  if (!isPlainObject(value)) {
    throw new MonitorEngineError('monitor evaluation context must be an object');
  }
  const actual = Object.keys(value);
  const expected = [
    'now',
    'system_state_id',
    'system_state_version',
    'subject_revision',
    'implementation_revision',
    'deployment_revision',
    'producer',
  ];
  if (actual.length !== expected.length || !expected.every((key) => actual.includes(key))) {
    throw new MonitorEngineError(
      `monitor evaluation context must have the exact field set { ${expected.join(', ')} }`,
    );
  }
  if (typeof value['now'] !== 'string' || !isRfc3339(value['now'])) {
    throw new MonitorEngineError(`context now must be an RFC3339 timestamp, received: ${JSON.stringify(value['now'])}`);
  }
  if (!isArtifactId(value['system_state_id'])) {
    throw new MonitorEngineError(
      `context system_state_id must be a well-formed spine artifact id, received: ${JSON.stringify(value['system_state_id'])}`,
    );
  }
  if (typeof value['system_state_version'] !== 'number' || !Number.isInteger(value['system_state_version']) || value['system_state_version'] < 1) {
    throw new MonitorEngineError(
      `context system_state_version must be an integer >= 1, received: ${JSON.stringify(value['system_state_version'])}`,
    );
  }
  if (!isNonEmptyString(value['subject_revision'])) {
    throw new MonitorEngineError(`context subject_revision must be a non-empty revision token, received: ${JSON.stringify(value['subject_revision'])}`);
  }
  if (value['implementation_revision'] !== null && !isNonEmptyString(value['implementation_revision'])) {
    throw new MonitorEngineError(
      `context implementation_revision must be null or a non-empty string, received: ${JSON.stringify(value['implementation_revision'])}`,
    );
  }
  if (value['deployment_revision'] !== null && !isNonEmptyString(value['deployment_revision'])) {
    throw new MonitorEngineError(
      `context deployment_revision must be null or a non-empty string, received: ${JSON.stringify(value['deployment_revision'])}`,
    );
  }
  try {
    assertValidProducer(value['producer']);
  } catch (cause) {
    throw new MonitorEngineError(`context producer is invalid: ${(cause as Error).message}`);
  }
}

/** Structural guard: is this a RuntimeMonitorEngine? */
export function isRuntimeMonitorEngine(value: unknown): value is RuntimeMonitorEngine {
  if (!isPlainObject(value)) {
    return false;
  }
  if (!isNonEmptyString(value['id'])) {
    return false;
  }
  if (
    !Array.isArray(value['supportedProperties']) ||
    !value['supportedProperties'].every(
      (kind) => typeof kind === 'string' && ['ALWAYS', 'RESPONSE', 'CUSTOM'].includes(kind),
    )
  ) {
    return false;
  }
  return typeof value['evaluate'] === 'function';
}

// ---------------------------------------------------------------------------
// Evidence minting (shared helper for engines)
// ---------------------------------------------------------------------------

export interface MintMonitorEvidenceInput {
  /** The engine minting the record (method provenance `runtime-verification:<engine-id>`). */
  engineId: string;
  monitor: MonitorDefinition;
  events: readonly MonitorEvent[];
  context: MonitorEvaluationContext;
  verdict: MonitorVerdict;
  availability: EvidenceTruthState;
  reason: string;
}

/**
 * Mint the monitor evaluation evidence record through the merged W3
 * authority. Deterministic: identical inputs reproduce the identical
 * content-addressed evidence id (R30 — reproducible from exact revisions).
 */
export function mintMonitorEvidence(input: MintMonitorEvidenceInput): EvidenceRecordW3 {
  const { context } = input;
  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  for (const event of input.events) {
    if (windowStart === null || Date.parse(event.at) < Date.parse(windowStart)) {
      windowStart = event.at;
    }
    if (windowEnd === null || Date.parse(event.at) > Date.parse(windowEnd)) {
      windowEnd = event.at;
    }
  }
  return createEvidence({
    kind: RUNTIME_MONITOR_EVIDENCE_KIND,
    subject_ref: context.system_state_id,
    availability: input.availability,
    evidence_class: 'OBSERVATIONAL',
    method: `runtime-verification:${input.engineId}`,
    provenance: [
      `runtime-monitor:${input.monitor.id}`,
      `property:sha256:${contentHash(input.monitor.property)}`,
      `events:sha256:${contentHash(input.events)}(${input.events.length})`,
      `system-state:${context.system_state_id}@v${context.system_state_version}`,
      `subject-revision:${context.subject_revision}`,
      `implementation-revision:${context.implementation_revision ?? 'null'}`,
      `deployment-revision:${context.deployment_revision ?? 'null'}`,
      `verdict:${input.verdict}`,
      `evaluated-at:${context.now}`,
    ],
    source_revision: context.implementation_revision,
    deployment_revision: context.deployment_revision,
    window: windowStart === null || windowEnd === null ? null : { start: windowStart, end: windowEnd },
    subject_revision: context.subject_revision,
    confidence: unquantifiedConfidence(),
    producer: context.producer,
  });
}

/** Build the OBSERVES link (evidence -> SystemState) for a monitor result. */
export function monitorObservesLink(evidence: EvidenceRecordW3, context: MonitorEvaluationContext): TraceLink {
  return createTraceLink({
    source: evidence.id,
    target: context.system_state_id,
    type: 'OBSERVES',
    provenance: [
      `W8:runtime-verification:${evidence.id}`,
      `system-state:${context.system_state_id}@v${context.system_state_version}`,
    ],
  });
}

// ---------------------------------------------------------------------------
// Output guards (adapters are not authority)
// ---------------------------------------------------------------------------

/**
 * Full contract validation of a monitor evaluation result (throws
 * MonitorEngineError):
 *   - exact field set; monitor_id echo; verdict/availability from the
 *     frozen vocabularies AND the frozen mapping;
 *   - evidence is a valid W3 record of kind "runtime-monitor" whose
 *     subject_ref / subject_revision / source_revision / deployment_revision
 *     match the context binding (exact-revision binding cannot be forged by
 *     an adapter);
 *   - links are valid OBSERVES links to the monitored SystemState.
 */
export function assertValidMonitorEvaluationResult(
  value: unknown,
  monitor: MonitorDefinition,
  context: MonitorEvaluationContext,
): asserts value is MonitorEvaluationResult {
  if (!isPlainObject(value)) {
    throw new MonitorEngineError('monitor evaluation result must be an object');
  }
  const actual = Object.keys(value);
  const expected = ['monitor_id', 'verdict', 'availability', 'reason', 'evidence', 'links'];
  if (actual.length !== expected.length || !expected.every((key) => actual.includes(key))) {
    throw new MonitorEngineError(
      `monitor evaluation result must have the exact field set { ${expected.join(', ')} }`,
    );
  }
  if (value['monitor_id'] !== monitor.id) {
    throw new MonitorEngineError(
      `result monitor_id must echo the evaluated monitor ${JSON.stringify(monitor.id)}, received: ${JSON.stringify(value['monitor_id'])}`,
    );
  }
  if (value['verdict'] !== 'SATISFIED' && value['verdict'] !== 'VIOLATED' && value['verdict'] !== 'INCONCLUSIVE') {
    throw new MonitorEngineError(
      `result verdict must be SATISFIED, VIOLATED or INCONCLUSIVE, received: ${JSON.stringify(value['verdict'])}`,
    );
  }
  if (typeof value['availability'] !== 'string' || !['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'].includes(value['availability'])) {
    throw new MonitorEngineError(
      `result availability must be one of the 6 distinct evidence truth states, received: ${JSON.stringify(value['availability'])}`,
    );
  }
  const verdict = value['verdict'] as MonitorVerdict;
  const availability = value['availability'] as EvidenceTruthState;
  if (!availabilityAllowedForVerdict(verdict, availability)) {
    throw new MonitorEngineError(
      `dishonest monitor result: verdict ${verdict} can never carry availability ${availability} (frozen mapping: SATISFIED->SUCCESS, VIOLATED->FAILURE, INCONCLUSIVE->UNKNOWN|UNAVAILABLE|UNSUPPORTED|PARTIAL) — adapters are not the authority`,
    );
  }
  if (typeof value['reason'] !== 'string' || (value['reason'] as string).length === 0) {
    throw new MonitorEngineError('result reason must be a non-empty string');
  }
  const evidence = value['evidence'];
  if (!isPlainObject(evidence)) {
    throw new MonitorEngineError('result evidence must be a W3 evidence record');
  }
  // The evidence record's own full validation is the W3 authority's
  // (assertValidEvidenceRecord); this guard additionally binds it to the
  // exact evaluation context.
  try {
    assertValidEvidenceRecord(evidence);
  } catch (cause) {
    throw new MonitorEngineError(`result evidence is not a valid W3 record: ${(cause as Error).message}`);
  }
  const record = evidence as EvidenceRecordW3;
  if (record.kind !== RUNTIME_MONITOR_EVIDENCE_KIND) {
    throw new MonitorEngineError(
      `result evidence kind must be "${RUNTIME_MONITOR_EVIDENCE_KIND}", received: ${JSON.stringify(record.kind)}`,
    );
  }
  if (record.subject_ref !== context.system_state_id) {
    throw new MonitorEngineError(
      `result evidence subject_ref ${JSON.stringify(record.subject_ref)} does not bind to the monitored SystemState ${context.system_state_id} (exact-revision binding cannot be forged by an adapter)`,
    );
  }
  if (record.subject_revision !== context.subject_revision) {
    throw new MonitorEngineError(
      `result evidence subject_revision ${JSON.stringify(record.subject_revision)} does not match the context subject revision ${JSON.stringify(context.subject_revision)} (exact-revision binding cannot be forged by an adapter)`,
    );
  }
  if (record.source_revision !== context.implementation_revision) {
    throw new MonitorEngineError(
      `result evidence source_revision ${JSON.stringify(record.source_revision)} does not match the context implementation revision ${JSON.stringify(context.implementation_revision)}`,
    );
  }
  if (record.deployment_revision !== context.deployment_revision) {
    throw new MonitorEngineError(
      `result evidence deployment_revision ${JSON.stringify(record.deployment_revision)} does not match the context deployment revision ${JSON.stringify(context.deployment_revision)}`,
    );
  }
  if (!Array.isArray(value['links']) || value['links'].length === 0) {
    throw new MonitorEngineError('result links must be a non-empty array of trace links');
  }
  for (const link of value['links']) {
    if (!isPlainObject(link)) {
      throw new MonitorEngineError('result links must be trace link objects');
    }
    if (link['type'] !== 'OBSERVES' || link['source'] !== record.id || link['target'] !== context.system_state_id) {
      throw new MonitorEngineError(
        `result links must OBSERVE the monitored SystemState from the minted evidence (${record.id} -> ${context.system_state_id}), received: ${JSON.stringify(link)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The sanctioned entry point
// ---------------------------------------------------------------------------

/**
 * Evaluate a monitor with a pluggable engine under the contract: validates
 * the engine, monitor, events and context; delegates to the engine; then
 * validates the engine's output against the frozen mapping, the W3 evidence
 * contract and the exact-revision binding. Engines whose outputs fail the
 * guard are refused loudly — ADAPTERS ARE NOT AUTHORITY.
 */
export function evaluateMonitor(
  engine: RuntimeMonitorEngine,
  monitor: MonitorDefinition,
  events: readonly MonitorEvent[],
  context: MonitorEvaluationContext,
): MonitorEvaluationResult {
  if (!isRuntimeMonitorEngine(engine)) {
    throw new MonitorEngineError(
      'engine must be a RuntimeMonitorEngine { id, supportedProperties, evaluate(monitor, events, context) } (see engine.ts)',
    );
  }
  assertValidMonitorDefinition(monitor);
  assertValidMonitorEvents(events);
  assertValidMonitorEvaluationContext(context);

  const result = engine.evaluate(monitor, events, context);
  assertValidMonitorEvaluationResult(result, monitor, context);
  return result;
}
