/**
 * Runtime conformance evaluation (Work Order W4; spec/architecture.md §7
 * "runtime conformance monitors", §18 truth-state discipline, R8/R21/R23/R30).
 *
 * Evaluates DECLARED executable invariants at an EXACT SystemState revision
 * against the OBSERVED runtime. The invariant DSL and its checker are the
 * merged W2 authorities (@sos-2/conformance `checkInvariant` over
 * @sos-2/architecture graph shapes — never reimplemented here); the runtime
 * observation records are @sos-2/telemetry `RawObservation`s projected by a
 * `RuntimeViewAdapter` (adapter.ts); the evidence records are minted by the
 * merged W3 evidence authority (@sos-2/evidence `createEvidence` — kind
 * "Evidence", deterministic spine ids, OBSERVATIONAL class, explicit method
 * provenance).
 *
 * ---------------------------------------------------------------------------
 * RUNTIME SEMANTICS (frozen; the core honesty model of this package)
 * ---------------------------------------------------------------------------
 * The runtime view ASSERTS observed structure within the observation
 * windows. Two disciplines follow:
 *
 * 1. WITNESS DISCIPLINE — a verdict of FAIL requires a POSITIVELY WITNESSED
 *    violation. Absence of observation is never treated as observation of
 *    absence (the spec/architecture-lock.md forbidden-shortcut family):
 *      - FORBIDDEN_DEPENDENCY / LAYERING: any static FAIL is edge-presence
 *        (a forbidden/upward edge was observed occurring) -> witnessed.
 *      - DATA_OWNERSHIP: witnessed iff at least one violating store has
 *        >= 2 observed Owns edges (multi-ownership positively observed);
 *        zero-owner violations are absence-based.
 *      - REQUIRED_INTERFACE: static FAIL is always absence-based under the
 *        structural adapter (an unobserved Provides edge proves nothing),
 *        so it never yields a runtime FAIL here — it yields UNKNOWN.
 *
 * 2. COVERAGE DISCIPLINE — PASS requires COMPLETE coverage of the
 *    invariant's DECLARED subject universe (every declared subject the
 *    invariant consults was sighted at runtime). Coverage buckets keep all
 *    observation truth states distinct:
 *      SIGHTED      usable observations exist (SUCCESS/FAILURE/UNKNOWN/
 *                   PARTIAL — an UNKNOWN outcome still proves the subject
 *                   existed) or the node was indirectly sighted via an edge
 *      UNSUPPORTED  only UNSUPPORTED observations (the source cannot serve
 *                   the subject)
 *      GAP          only UNAVAILABLE observations (no data exists — never
 *                   read as zero or as absence-of-failure)
 *      UNOBSERVED   no observation named the subject at all
 *
 * VERDICT / AVAILABILITY TABLE (frozen; PASS/FAIL/UNKNOWN never conflated
 * with each other or with the 6 evidence truth states):
 *
 *   check      coverage        verdict    availability
 *   FAIL       witnessed       FAIL       FAILURE
 *   FAIL       absence-based   UNKNOWN    UNKNOWN
 *   PASS       EMPTY           UNKNOWN    UNSUPPORTED (no declared subjects — vacuous)
 *   PASS       COMPLETE        PASS       SUCCESS
 *   PASS       PARTIAL         UNKNOWN    PARTIAL
 *   PASS       UNSUPPORTED     UNKNOWN    UNSUPPORTED
 *   PASS       GAP | NONE      UNKNOWN    UNAVAILABLE
 *   N/A        EMPTY           UNKNOWN    UNSUPPORTED
 *   N/A        COMPLETE        UNKNOWN    UNKNOWN (subjects sighted but the premises do not hold — correspondence ambiguous)
 *   N/A        PARTIAL         UNKNOWN    PARTIAL
 *   N/A        UNSUPPORTED     UNKNOWN    UNSUPPORTED
 *   N/A        GAP | NONE      UNKNOWN    UNAVAILABLE
 *
 * ---------------------------------------------------------------------------
 * EXACT-REVISION BINDING
 * ---------------------------------------------------------------------------
 * The input SystemState must declare (architecture_ref) the EXACT declared
 * ArchitectureGraph artifact id and envelope version being evaluated — the
 * binding is validated loudly. The REVERSE reference (the graph's
 * projects_system_state pointing back at the SystemState id) is NOT
 * required: both artifacts are content-addressed, so a mutually-referencing
 * pair is a hash fixed point and is unconstructible by design (the same
 * reason W2's own tests anchor graphs at fixed SystemState ids). Every
 * emitted evidence record carries the SystemState id, its envelope version,
 * the implementation git-sha revisions and the deployment revisions in
 * provenance, plus OBSERVES (evidence -> SystemState) and VERIFIES
 * (evidence -> declared ArchitectureGraph) trace links.
 */

import { contentHash, createTraceLink, isArtifactId } from '@sos-2/semantic-spine';
import type { EvidenceTruthState, TraceLink } from '@sos-2/semantic-spine';
import { assertValidArchitectureGraphArtifact } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact, GraphShape } from '@sos-2/architecture';
import { assertValidInvariant, checkInvariant, isInvariantCheckResult } from '@sos-2/conformance';
import type { Invariant, InvariantCheckResult } from '@sos-2/conformance';
import { assertValidSystemStateArtifact } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import {
  assertConfidenceAllowedForProducer,
  assertValidConfidence,
  createEvidence,
  unquantifiedConfidence,
  validateEvidenceRecord,
} from '@sos-2/evidence';
import type { Confidence, EvidenceRecordW3 } from '@sos-2/evidence';
import { assertValidProducer, isLlmProducer, isRfc3339, rfc3339ToEpochMs } from '@sos-2/provenance';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import type { RawObservation } from '@sos-2/telemetry';
import { RuntimeConformanceError } from './errors.js';
import { isRuntimeViewAdapter } from './adapter.js';
import type { RuntimeView, RuntimeViewAdapter } from './adapter.js';

// ---------------------------------------------------------------------------
// Public vocabulary
// ---------------------------------------------------------------------------

/** The evidence kind minted by runtime conformance evaluation. */
export const RUNTIME_CONFORMANCE_EVIDENCE_KIND = 'runtime-conformance';

/** The ONE explicit truth-state assignment method of this evaluation path. */
export const RUNTIME_CONFORMANCE_METHOD = 'runtime-conformance:invariant-check';

export const RUNTIME_VERDICTS = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type RuntimeVerdict = (typeof RUNTIME_VERDICTS)[number];

export const COVERAGE_BUCKETS = ['SIGHTED', 'UNSUPPORTED', 'GAP', 'UNOBSERVED'] as const;
export type CoverageBucket = (typeof COVERAGE_BUCKETS)[number];

export const COVERAGE_SUMMARIES = ['COMPLETE', 'PARTIAL', 'UNSUPPORTED', 'GAP', 'NONE', 'EMPTY'] as const;
export type CoverageSummary = (typeof COVERAGE_SUMMARIES)[number];

/**
 * The frozen verdict -> allowed availability mapping (the anti-conflation
 * guard backing): PASS is only ever SUCCESS, FAIL is only ever FAILURE, and
 * UNKNOWN is one of the four honest not-conforming-verdict states.
 */
export const VERDICT_AVAILABILITY: Readonly<Record<RuntimeVerdict, readonly EvidenceTruthState[]>> = {
  PASS: ['SUCCESS'],
  FAIL: ['FAILURE'],
  UNKNOWN: ['UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'],
};

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface RuntimeConformanceInput {
  /** The EXACT SystemState revision being evaluated. */
  system_state: SystemStateArtifact;
  /**
   * The declared architecture the SystemState is observed against. MUST
   * match system_state.content.architecture_ref (artifact id + version) —
   * validated loudly.
   */
  declared_architecture: ArchitectureGraphArtifact;
  /** Declared executable invariants to evaluate at runtime (unique, validated). */
  invariants: readonly Invariant[];
  /** Runtime observation records (telemetry-shaped; validated by the adapter). */
  observations: readonly RawObservation[];
  /** The adapter projecting observations onto the runtime view. */
  adapter: RuntimeViewAdapter;
  /** WHO/WHAT produced this evaluation (provenance; LLM producers allowed but never authoritative). */
  producer: Producer;
  /** RFC3339 evaluation instant, caller-supplied (no hidden clocks). */
  evaluated_at: string;
  /** Confidence mark; defaults to qualitative UNQUANTIFIED. */
  confidence?: Confidence;
}

export interface SubjectCoverageEntry {
  /** A declared subject the invariant consults (node id). */
  subject: string;
  /** The observation coverage bucket for this subject. */
  bucket: CoverageBucket;
}

export interface InvariantCoverage {
  /** The declared subject universe (sorted). */
  subjects: SubjectCoverageEntry[];
  /** The coverage summary over the universe. */
  summary: CoverageSummary;
  /** How many subjects are sighted (context for reasons). */
  sighted: number;
}

export interface RuntimeConformanceRecord {
  /** The minted evidence record (kind "runtime-conformance", OBSERVATIONAL). */
  evidence: EvidenceRecordW3;
  /** The runtime conformance verdict (PASS/FAIL/UNKNOWN — never conflated). */
  verdict: RuntimeVerdict;
  /** The declared invariant that was evaluated (echoed for binding). */
  invariant: Invariant;
  /** The static check result over the observed runtime graph (echoed). */
  check: InvariantCheckResult;
  /** Declared-subject coverage for this invariant. */
  coverage: InvariantCoverage;
  /** Deterministic human-readable explanation. */
  reason: string;
  /** OBSERVES (evidence -> SystemState) and VERIFIES (evidence -> declared architecture). */
  links: TraceLink[];
}

export interface RuntimeConformanceResult {
  /** One record per declared invariant, in input order. */
  records: RuntimeConformanceRecord[];
  /** The runtime view the adapter produced (auditability). */
  view: RuntimeView;
  /** All trace links across records (OBSERVES and VERIFIES, record order). */
  links: TraceLink[];
  /** The exact SystemState artifact id evaluated. */
  system_state_id: string;
  /** The exact SystemState envelope version evaluated. */
  system_state_version: number;
  /** The declared ArchitectureGraph artifact id the evaluation verified against. */
  declared_architecture_id: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateInput(input: RuntimeConformanceInput): void {
  if (typeof input !== 'object' || input === null) {
    throw new RuntimeConformanceError('runtime conformance input must be an object');
  }
  try {
    assertValidSystemStateArtifact(input.system_state);
  } catch (cause) {
    throw new RuntimeConformanceError(`system_state is invalid: ${(cause as Error).message}`);
  }
  try {
    assertValidArchitectureGraphArtifact(input.declared_architecture);
  } catch (cause) {
    throw new RuntimeConformanceError(`declared_architecture is invalid: ${(cause as Error).message}`);
  }
  const reference = input.system_state.content.architecture_ref;
  if (reference.artifact_id !== input.declared_architecture.envelope.id) {
    throw new RuntimeConformanceError(
      `system_state.content.architecture_ref.artifact_id ${reference.artifact_id} does not match the declared architecture id ${input.declared_architecture.envelope.id} (exact-revision binding)`,
    );
  }
  if (reference.version !== input.declared_architecture.envelope.version) {
    throw new RuntimeConformanceError(
      `system_state.content.architecture_ref.version ${reference.version} does not match the declared architecture envelope version ${input.declared_architecture.envelope.version} (exact-revision binding)`,
    );
  }
  if (!Array.isArray(input.invariants)) {
    throw new RuntimeConformanceError('invariants must be an array of declared invariants');
  }
  const seenInvariantHashes = new Set<string>();
  for (const invariant of input.invariants) {
    try {
      assertValidInvariant(invariant);
    } catch (cause) {
      throw new RuntimeConformanceError(`invariant is invalid: ${(cause as Error).message}`);
    }
    const hash = contentHash(invariant);
    if (seenInvariantHashes.has(hash)) {
      throw new RuntimeConformanceError(
        'duplicate invariant in the input list (evaluate each declared invariant exactly once — content-hash duplicates are rejected)',
      );
    }
    seenInvariantHashes.add(hash);
  }
  if (!Array.isArray(input.observations)) {
    throw new RuntimeConformanceError('observations must be an array of RawObservation records');
  }
  if (!isRuntimeViewAdapter(input.adapter)) {
    throw new RuntimeConformanceError(
      'adapter must be a RuntimeViewAdapter { id, project(observations) } (see adapter.ts)',
    );
  }
  try {
    assertValidProducer(input.producer);
  } catch (cause) {
    throw new RuntimeConformanceError(`producer is invalid: ${(cause as Error).message}`);
  }
  if (!isRfc3339(input.evaluated_at)) {
    throw new RuntimeConformanceError(
      `evaluated_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.evaluated_at)}`,
    );
  }
  if (input.confidence !== undefined) {
    try {
      assertValidConfidence(input.confidence);
    } catch (cause) {
      throw new RuntimeConformanceError(`confidence is invalid: ${(cause as Error).message}`);
    }
    // LLM self-reported confidence is never calibrated truth (W3 discipline).
    assertConfidenceAllowedForProducer(input.confidence, isLlmProducer(input.producer));
  }
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

function bucketFor(subject: string, view: RuntimeView): CoverageBucket {
  const tally = view.subjectCoverage.find((entry) => entry.subject === subject);
  const usable =
    tally !== undefined &&
    (tally.counts.SUCCESS > 0 ||
      tally.counts.FAILURE > 0 ||
      tally.counts.UNKNOWN > 0 ||
      tally.counts.PARTIAL > 0);
  const sighted = view.sightedNodes.some((node) => node.id === subject);
  if (usable || sighted) {
    return 'SIGHTED';
  }
  if (tally !== undefined && tally.counts.UNSUPPORTED > 0) {
    return 'UNSUPPORTED';
  }
  if (tally !== undefined && tally.counts.UNAVAILABLE > 0) {
    return 'GAP';
  }
  return 'UNOBSERVED';
}

function coverageSummaryFor(buckets: readonly CoverageBucket[]): CoverageSummary {
  if (buckets.length === 0) {
    return 'EMPTY';
  }
  const sighted = buckets.filter((bucket) => bucket === 'SIGHTED').length;
  if (sighted === buckets.length) {
    return 'COMPLETE';
  }
  if (sighted > 0) {
    return 'PARTIAL';
  }
  if (buckets.includes('UNSUPPORTED')) {
    return 'UNSUPPORTED';
  }
  if (buckets.includes('GAP')) {
    return 'GAP';
  }
  return 'NONE';
}

/** The declared subject universe an invariant consults (from the declared graph). */
export function declaredSubjectUniverse(invariant: Invariant, declared: ArchitectureGraphArtifact): string[] {
  const nodes = declared.content.nodes;
  switch (invariant.kind) {
    case 'REQUIRED_INTERFACE': {
      const subjects = nodes.filter((node) => node.kind === invariant.componentKind).map((node) => node.id);
      if (nodes.some((node) => node.id === invariant.interfaceId)) {
        subjects.push(invariant.interfaceId);
      }
      return [...new Set(subjects)].sort();
    }
    case 'FORBIDDEN_DEPENDENCY': {
      const subjects = nodes
        .filter((node) => node.kind === invariant.fromKind || node.kind === invariant.toKind)
        .map((node) => node.id);
      return [...new Set(subjects)].sort();
    }
    case 'LAYERING': {
      const layers = new Set(invariant.layers);
      const subjects = nodes.filter((node) => layers.has(node.kind)).map((node) => node.id);
      return [...new Set(subjects)].sort();
    }
    case 'DATA_OWNERSHIP': {
      return [...new Set(nodes.filter((node) => node.kind === 'DataStore').map((node) => node.id))].sort();
    }
  }
}

// ---------------------------------------------------------------------------
// Witness discipline
// ---------------------------------------------------------------------------

/**
 * Whether a static FAIL over the runtime graph is a POSITIVELY WITNESSED
 * violation (see the module doc: absence of observation is never treated as
 * observation of absence).
 */
export function witnessedViolation(invariant: Invariant, check: InvariantCheckResult, graph: GraphShape): boolean {
  if (check.status !== 'FAIL') {
    return false;
  }
  switch (invariant.kind) {
    case 'FORBIDDEN_DEPENDENCY':
      // Any FAIL lists forbidden edges that were observed occurring.
      return true;
    case 'LAYERING':
      // Any FAIL lists upward dependency edges that were observed occurring.
      return true;
    case 'DATA_OWNERSHIP':
      // Witnessed iff at least one violating store has >= 2 observed Owns edges.
      return check.evidence.some((storeId) =>
        graph.edges.filter((edge) => edge.kind === 'Owns' && edge.target === storeId).length >= 2,
      );
    case 'REQUIRED_INTERFACE':
      // Static FAIL is absence-based under the structural adapter: an
      // unobserved Provides edge proves nothing about non-exposure.
      return false;
  }
}

/**
 * The frozen verdict/availability decision (table in the module doc).
 * Deterministic and total on valid inputs; exported for tests and consumers.
 */
export function verdictAndAvailability(
  invariant: Invariant,
  check: InvariantCheckResult,
  coverage: InvariantCoverage,
  graph: GraphShape,
): { verdict: RuntimeVerdict; availability: EvidenceTruthState; reason: string } {
  const coverageNote = `declared-subject coverage: ${coverage.summary} (${coverage.sighted}/${coverage.subjects.length} sighted)`;
  if (check.status === 'FAIL') {
    if (witnessedViolation(invariant, check, graph)) {
      return {
        verdict: 'FAIL',
        availability: 'FAILURE',
        reason: `runtime violation positively observed: ${check.reason}; ${coverageNote}`,
      };
    }
    return {
      verdict: 'UNKNOWN',
      availability: 'UNKNOWN',
      reason: `the runtime check reported a violation, but it is absence-based (no positive witness in the runtime observations): ${check.reason}; ${coverageNote}; absence of observation is not observation of absence`,
    };
  }
  if (coverage.summary === 'EMPTY') {
    return {
      verdict: 'UNKNOWN',
      availability: 'UNSUPPORTED',
      reason: `the invariant has no declared subjects in this architecture, so runtime evaluation is vacuous: ${check.reason}`,
    };
  }
  if (check.status === 'PASS') {
    switch (coverage.summary) {
      case 'COMPLETE':
        return {
          verdict: 'PASS',
          availability: 'SUCCESS',
          reason: `no violation observed within the evaluated windows and every declared subject is covered: ${check.reason}; ${coverageNote}`,
        };
      case 'PARTIAL':
        return {
          verdict: 'UNKNOWN',
          availability: 'PARTIAL',
          reason: `no violation observed over covered runtime subjects, but coverage is partial: ${check.reason}; ${coverageNote}`,
        };
      case 'UNSUPPORTED':
        return {
          verdict: 'UNKNOWN',
          availability: 'UNSUPPORTED',
          reason: `the observation source cannot serve the declared subjects: ${check.reason}; ${coverageNote}`,
        };
      default:
        return {
          verdict: 'UNKNOWN',
          availability: 'UNAVAILABLE',
          reason: `no runtime data exists for the declared subjects (a gap is data about missing data — never read as zero or as absence-of-violation): ${check.reason}; ${coverageNote}`,
        };
    }
  }
  // check.status === 'NOT_APPLICABLE'
  switch (coverage.summary) {
    case 'COMPLETE':
      return {
        verdict: 'UNKNOWN',
        availability: 'UNKNOWN',
        reason: `every declared subject is sighted but the runtime premises do not hold (runtime node kinds may differ from the declared kinds — correspondence ambiguous): ${check.reason}; ${coverageNote}`,
      };
    case 'PARTIAL':
      return {
        verdict: 'UNKNOWN',
        availability: 'PARTIAL',
        reason: `the runtime check was not applicable and coverage is partial: ${check.reason}; ${coverageNote}`,
      };
    case 'UNSUPPORTED':
      return {
        verdict: 'UNKNOWN',
        availability: 'UNSUPPORTED',
        reason: `the runtime check was not applicable and the observation source cannot serve the declared subjects: ${check.reason}; ${coverageNote}`,
      };
    default:
      return {
        verdict: 'UNKNOWN',
        availability: 'UNAVAILABLE',
        reason: `the runtime check was not applicable and no runtime data exists for the declared subjects: ${check.reason}; ${coverageNote}`,
      };
  }
}

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

/** The deterministic subject-revision token for a SystemState revision. */
export function systemStateRevisionToken(id: string, version: number): string {
  if (!isArtifactId(id)) {
    throw new RuntimeConformanceError(`system state id must be a well-formed artifact id, received: ${JSON.stringify(id)}`);
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new RuntimeConformanceError(`system state version must be an integer >= 1, received: ${String(version)}`);
  }
  return `${id}@v${version}`;
}

function enclosingWindow(observations: readonly RawObservation[]): TimeWindow | null {
  if (observations.length === 0) {
    return null;
  }
  let earliest: string | null = null;
  let latest: string | null = null;
  let earliestEpoch = Number.POSITIVE_INFINITY;
  let latestEpoch = Number.NEGATIVE_INFINITY;
  for (const observation of observations) {
    const start = rfc3339ToEpochMs(observation.window.start);
    const end = rfc3339ToEpochMs(observation.window.end);
    if (start < earliestEpoch) {
      earliestEpoch = start;
      earliest = observation.window.start;
    }
    if (end > latestEpoch) {
      latestEpoch = end;
      latest = observation.window.end;
    }
  }
  return { start: earliest!, end: latest! };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the declared executable invariants at the exact SystemState
 * revision against the observed runtime. Deterministic and total on valid
 * inputs: identical inputs produce byte-identical results (content-addressed
 * evidence ids, fixed record order).
 */
export function evaluateRuntimeConformance(input: RuntimeConformanceInput): RuntimeConformanceResult {
  validateInput(input);
  const systemState = input.system_state;
  const declared = input.declared_architecture;
  const ssId = systemState.envelope.id;
  const ssVersion = systemState.envelope.version;
  const archId = declared.envelope.id;
  const archVersion = declared.envelope.version;
  const subjectRevision = systemStateRevisionToken(ssId, ssVersion);

  const view = input.adapter.project(input.observations);

  const implementation = systemState.content.implementation;
  const deployment = systemState.content.deployment;
  const sourceRevision = implementation.length === 1 ? implementation[0]!.revision.value : null;
  const deploymentRevision = deployment.length === 1 ? deployment[0]!.revision.value : null;
  const window = enclosingWindow(input.observations);
  const observationsHash = contentHash(input.observations);
  const confidence = input.confidence === undefined ? unquantifiedConfidence() : input.confidence;

  const records: RuntimeConformanceRecord[] = [];
  const links: TraceLink[] = [];
  for (const invariant of input.invariants) {
    const check = checkInvariant(invariant, view.graph);
    const universe = declaredSubjectUniverse(invariant, declared);
    const entries: SubjectCoverageEntry[] = universe.map((subject) => ({
      subject,
      bucket: bucketFor(subject, view),
    }));
    const coverage: InvariantCoverage = {
      subjects: entries,
      summary: coverageSummaryFor(entries.map((entry) => entry.bucket)),
      sighted: entries.filter((entry) => entry.bucket === 'SIGHTED').length,
    };
    const decision = verdictAndAvailability(invariant, check, coverage, view.graph);

    const provenance = [
      `runtime-conformance:${ssId}@v${ssVersion}`,
      `architecture:${archId}@v${archVersion}`,
      ...implementation.flatMap((reference) => [
        `implementation-model:${reference.artifact_id}`,
        `implementation-revision:${reference.revision.value}`,
      ]),
      ...deployment.flatMap((reference) => [
        `deployment:${reference.deployment_id}`,
        `deployment-revision:${reference.revision.value}`,
      ]),
      `adapter:${input.adapter.id}`,
      `invariant:sha256:${contentHash(invariant)}`,
      `observations:sha256:${observationsHash}`,
      `evaluated-at:${input.evaluated_at}`,
    ];

    const evidence = createEvidence({
      kind: RUNTIME_CONFORMANCE_EVIDENCE_KIND,
      subject_ref: ssId,
      availability: decision.availability,
      evidence_class: 'OBSERVATIONAL',
      method: RUNTIME_CONFORMANCE_METHOD,
      provenance,
      source_revision: sourceRevision,
      deployment_revision: deploymentRevision,
      window,
      subject_revision: subjectRevision,
      confidence,
      producer: input.producer,
    });

    const recordLinks: TraceLink[] = [
      createTraceLink({
        source: evidence.id,
        target: ssId,
        type: 'OBSERVES',
        provenance: [`W4:runtime-conformance:${evidence.id}`, `system-state:${subjectRevision}`],
      }),
      createTraceLink({
        source: evidence.id,
        target: archId,
        type: 'VERIFIES',
        provenance: [`W4:runtime-conformance:${evidence.id}`, `architecture:${archId}@v${archVersion}`],
      }),
    ];

    records.push({
      evidence,
      verdict: decision.verdict,
      invariant,
      check,
      coverage,
      reason: decision.reason,
      links: recordLinks,
    });
    links.push(...recordLinks);
  }

  return {
    records,
    view,
    links,
    system_state_id: ssId,
    system_state_version: ssVersion,
    declared_architecture_id: archId,
  };
}

// ---------------------------------------------------------------------------
// Guards (anti-conflation)
// ---------------------------------------------------------------------------

/**
 * Structural guard for runtime conformance records. Enforces the frozen
 * verdict/availability consistency (PASS only SUCCESS, FAIL only FAILURE,
 * UNKNOWN only the four honest non-verdict states) — conflated records are
 * REJECTED, never normalized.
 */
export function isRuntimeConformanceRecord(value: unknown): value is RuntimeConformanceRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 7) return false;
  for (const key of ['evidence', 'verdict', 'invariant', 'check', 'coverage', 'reason', 'links']) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return false;
  }
  if (!validateEvidenceRecord(record['evidence'])) return false;
  const evidence = record['evidence'] as EvidenceRecordW3;
  if (evidence.kind !== RUNTIME_CONFORMANCE_EVIDENCE_KIND) return false;
  if (evidence.method !== RUNTIME_CONFORMANCE_METHOD) return false;
  if (evidence.evidence_class !== 'OBSERVATIONAL') return false;
  if (!isNonEmptyString(record['reason'])) return false;
  const verdict = record['verdict'];
  if (typeof verdict !== 'string' || !RUNTIME_VERDICTS.includes(verdict as RuntimeVerdict)) return false;
  const allowed = VERDICT_AVAILABILITY[verdict as RuntimeVerdict];
  if (!allowed.includes(evidence.availability)) return false;
  if (!isInvariantCheckResult(record['check'])) return false;
  try {
    assertValidInvariant(record['invariant']);
  } catch {
    return false;
  }
  const coverage = record['coverage'];
  if (typeof coverage !== 'object' || coverage === null) return false;
  const coverageRecord = coverage as Record<string, unknown>;
  if (!COVERAGE_SUMMARIES.includes(coverageRecord['summary'] as CoverageSummary)) return false;
  if (!Array.isArray(coverageRecord['subjects'])) return false;
  for (const entry of coverageRecord['subjects'] as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return false;
    const entryRecord = entry as Record<string, unknown>;
    if (!isNonEmptyString(entryRecord['subject'])) return false;
    if (!COVERAGE_BUCKETS.includes(entryRecord['bucket'] as CoverageBucket)) return false;
  }
  if (!Array.isArray(record['links']) || record['links'].length !== 2) return false;
  const observes = (record['links'] as unknown[]).some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>)['type'] === 'OBSERVES' &&
      (entry as Record<string, unknown>)['source'] === evidence.id,
  );
  const verifies = (record['links'] as unknown[]).some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>)['type'] === 'VERIFIES' &&
      (entry as Record<string, unknown>)['source'] === evidence.id,
  );
  return observes && verifies;
}

/** Structural guard for evaluation results. */
export function isRuntimeConformanceResult(value: unknown): value is RuntimeConformanceResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 6) return false;
  if (!['records', 'view', 'links', 'system_state_id', 'system_state_version', 'declared_architecture_id'].every((key) =>
    Object.prototype.hasOwnProperty.call(record, key),
  )) {
    return false;
  }
  if (!Array.isArray(record['records']) || !record['records'].every(isRuntimeConformanceRecord)) return false;
  if (!Array.isArray(record['links'])) return false;
  if (!isArtifactId(record['system_state_id'])) return false;
  if (!isArtifactId(record['declared_architecture_id'])) return false;
  return typeof record['system_state_version'] === 'number' && Number.isInteger(record['system_state_version']);
}
