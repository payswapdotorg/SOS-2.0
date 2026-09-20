/**
 * Human-readable reconciliation report generator (Work Order W4;
 * docs/code-to-architecture.md: "The console should explain: what we
 * declared, what we observed, what differs, and why the difference is
 * believed to be detail, variation, drift, unknown or intentional
 * evolution.").
 *
 * DETERMINISM CONTRACT: `generateReconciliationReport` is a pure function of
 * its input — no hidden clocks, no random ordering, no environment access.
 * Identical inputs produce byte-identical reports (pinned by tests, including
 * the negative determinism suite).
 *
 * The report is sectioned exactly along the docs/code-to-architecture.md
 * sentence:
 *
 *   WHAT WE DECLARED    the declared architecture and the observed model
 *                       (with its exact revision) that were compared
 *   WHAT WE OBSERVED    the interpretation labels under comparison (e.g.
 *                       competing recovered hypotheses)
 *   WHAT DIFFERS        every classification finding per section, in the
 *                       spine classifier's canonical order (nodes then edges,
 *                       subjects ascending), each with its deterministic
 *                       reason
 *   WHY                 the frozen per-class belief statement (why the
 *                       difference is believed to be detail, variation,
 *                       refinement, intentional evolution, drift, unknown or
 *                       contradiction)
 *   SUMMARY             zero-filled counts for all 7 frozen conformance
 *                       classes, drift evidence counts and the subjects that
 *                       require human adjudication
 */

import { isArtifactId, isConformanceClass } from '@sos-2/semantic-spine';
import type { ConformanceClass } from '@sos-2/semantic-spine';
import { isDriftEvidenceRecord } from '@sos-2/conformance';
import type { ReconciliationResult } from '@sos-2/conformance';
import { ReconciliationReportError } from './errors.js';
import { isAmbiguityMarker } from './markers.js';
import type { AmbiguityMarker } from './markers.js';
import type { HypothesisComparison } from './compare.js';

export const REPORT_TITLE = 'SOS 2.0 Architecture Reconciliation Report';

/**
 * The frozen per-class belief statements — the "why the difference is
 * believed to be ..." rationale from docs/code-to-architecture.md. All 7
 * frozen classes are always covered.
 */
export const CLASSIFICATION_RATIONALE: Readonly<Record<ConformanceClass, string>> = {
  IMPLEMENTATION_DETAIL:
    'believed to be an implementation detail: the observed subject is not declared and does not assert architectural significance',
  EXPECTED_VARIATION:
    'believed to be an expected variation: the divergence is pre-authorized and within declared variation bounds',
  PRESERVING_REFINEMENT:
    'believed to be a preserving refinement: the declared element is realized by refinement components that preserve its architectural role',
  INTENTIONAL_EVOLUTION:
    'believed to be an intentional evolution: the divergence is pre-authorized as an explicit architecture evolution',
  DRIFT:
    'believed to be drift: the implementation has diverged from the declared architecture without authorization; drift becomes evidence and may trigger remediation, evidence gathering, ASK or incident handling',
  UNKNOWN:
    'correspondence is unknown: the evidence is ambiguous and the difference is retained as unknown — never silently resolved',
  CONTRADICTION:
    'believed to be a contradiction: the observation directly conflicts with a declared critical element of the architecture',
};

const ALL_CLASSES: readonly ConformanceClass[] = [
  'IMPLEMENTATION_DETAIL',
  'EXPECTED_VARIATION',
  'PRESERVING_REFINEMENT',
  'INTENTIONAL_EVOLUTION',
  'DRIFT',
  'UNKNOWN',
  'CONTRADICTION',
];

const ADJUDICATION_CLASSES: readonly ConformanceClass[] = ['DRIFT', 'UNKNOWN', 'CONTRADICTION'];

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** One report section: a labeled reconciliation result. */
export interface ReportSection {
  /** Non-empty section label, e.g. "Hypothesis sos://ArchitectureGraph/… (DIRECT)". */
  label: string;
  /** The reconciliation result being reported (validated). */
  result: ReconciliationResult;
}

export interface ReconciliationReportInput {
  /** Report title override (default: REPORT_TITLE). */
  title?: string;
  /** The observed ImplementationModel artifact id (validated artifact id). */
  observed_model_id: string;
  /** The EXACT observed model revision. */
  observed_model_revision: string;
  /** The declared ArchitectureGraph artifact id (validated artifact id). */
  declared_architecture_id: string;
  /** Labeled reconciliation result sections (reported in input order). */
  sections: readonly ReportSection[];
  /** Optional ambiguity markers retained during recovery (reported verbatim, sorted). */
  ambiguities?: readonly AmbiguityMarker[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function assertValidReconciliationResult(value: unknown, label: string): asserts value is ReconciliationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReconciliationReportError(`section "${label}": result must be a ReconciliationResult (@sos-2/conformance)`);
  }
  const record = value as Record<string, unknown>;
  if (!['records', 'links', 'drift', 'normalizedModel'].every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new ReconciliationReportError(
      `section "${label}": result must carry { records, links, drift, normalizedModel } (the @sos-2/conformance reconcile output)`,
    );
  }
  if (!Array.isArray(record['records'])) {
    throw new ReconciliationReportError(`section "${label}": records must be an array`);
  }
  for (const entry of record['records'] as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      throw new ReconciliationReportError(`section "${label}": every record must be an object`);
    }
    const finding = entry as Record<string, unknown>;
    if (!isConformanceClass(finding['classification'])) {
      throw new ReconciliationReportError(
        `section "${label}": record classification must be one of the 7 frozen classes, received: ${JSON.stringify(finding['classification'])}`,
      );
    }
    if (!isNonEmptyString(finding['subject']) || !isNonEmptyString(finding['reason'])) {
      throw new ReconciliationReportError(`section "${label}": records require non-empty subject and reason`);
    }
  }
  if (!Array.isArray(record['drift']) || !record['drift'].every((entry) => isDriftEvidenceRecord(entry))) {
    throw new ReconciliationReportError(`section "${label}": drift must be an array of drift evidence records`);
  }
}

function validateReportInput(input: ReconciliationReportInput): void {
  if (typeof input !== 'object' || input === null) {
    throw new ReconciliationReportError('report input must be an object');
  }
  if (input.title !== undefined && !isNonEmptyString(input.title)) {
    throw new ReconciliationReportError(`title must be a non-empty string when present, received: ${JSON.stringify(input.title)}`);
  }
  if (!isArtifactId(input.observed_model_id)) {
    throw new ReconciliationReportError(
      `observed_model_id must be a well-formed artifact id, received: ${JSON.stringify(input.observed_model_id)}`,
    );
  }
  if (!isNonEmptyString(input.observed_model_revision)) {
    throw new ReconciliationReportError(
      `observed_model_revision must be a non-empty string, received: ${JSON.stringify(input.observed_model_revision)}`,
    );
  }
  if (!isArtifactId(input.declared_architecture_id)) {
    throw new ReconciliationReportError(
      `declared_architecture_id must be a well-formed artifact id, received: ${JSON.stringify(input.declared_architecture_id)}`,
    );
  }
  if (!Array.isArray(input.sections)) {
    throw new ReconciliationReportError('sections must be an array of { label, result }');
  }
  for (const section of input.sections) {
    if (typeof section !== 'object' || section === null) {
      throw new ReconciliationReportError('every report section must be an object { label, result }');
    }
    if (!isNonEmptyString(section.label)) {
      throw new ReconciliationReportError(`section label must be a non-empty string, received: ${JSON.stringify(section.label)}`);
    }
    assertValidReconciliationResult(section.result, section.label);
  }
  if (input.ambiguities !== undefined) {
    if (!Array.isArray(input.ambiguities) || !input.ambiguities.every(isAmbiguityMarker)) {
      throw new ReconciliationReportError('ambiguities must be an array of ambiguity markers when present');
    }
  }
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function countClassifications(records: readonly { classification: ConformanceClass }[]): Record<ConformanceClass, number> {
  const counts = {
    IMPLEMENTATION_DETAIL: 0,
    EXPECTED_VARIATION: 0,
    PRESERVING_REFINEMENT: 0,
    INTENTIONAL_EVOLUTION: 0,
    DRIFT: 0,
    UNKNOWN: 0,
    CONTRADICTION: 0,
  } as Record<ConformanceClass, number>;
  for (const record of records) {
    counts[record.classification] += 1;
  }
  return counts;
}

/**
 * Generate the deterministic, human-readable reconciliation report.
 * Byte-identical for identical inputs (pure function; no clocks, no
 * randomness, no environment access).
 */
export function generateReconciliationReport(input: ReconciliationReportInput): string {
  validateReportInput(input);
  const title = input.title ?? REPORT_TITLE;
  const lines: string[] = [];

  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push('');

  // WHAT WE DECLARED
  lines.push('WHAT WE DECLARED');
  lines.push(`  declared architecture : ${input.declared_architecture_id}`);
  lines.push(`  observed model        : ${input.observed_model_id}`);
  lines.push(`  observed revision     : ${input.observed_model_revision}`);
  lines.push('');

  // WHAT WE OBSERVED
  lines.push('WHAT WE OBSERVED');
  if (input.sections.length === 0) {
    lines.push('  no interpretation was compared (no reconciliation sections provided)');
  } else {
    lines.push(`  interpretation(s) under comparison: ${input.sections.length}`);
    for (const section of input.sections) {
      lines.push(`  - ${section.label}`);
    }
  }
  lines.push('');

  // WHAT DIFFERS (+ WHY per finding)
  lines.push('WHAT DIFFERS');
  if (input.sections.length === 0) {
    lines.push('  nothing to report');
  }
  for (const section of input.sections) {
    const counts = countClassifications(section.result.records);
    const total = section.result.records.length;
    lines.push(`  ${section.label}`);
    lines.push(`    findings: ${total}`);
    const countParts = ALL_CLASSES.filter((classification) => counts[classification] > 0).map(
      (classification) => `${classification}: ${counts[classification]}`,
    );
    lines.push(`    by classification: ${countParts.length > 0 ? countParts.join(', ') : 'none'}`);
    for (const record of section.result.records) {
      lines.push(`    [${record.classification}] ${record.subject}`);
      lines.push(`      why: ${record.reason}`);
      lines.push(`      ${CLASSIFICATION_RATIONALE[record.classification]}`);
    }
    lines.push(`    drift evidence records: ${section.result.drift.length}`);
  }
  lines.push('');

  // Retained ambiguity (recovery provenance and uncertainty, verbatim)
  if (input.ambiguities !== undefined && input.ambiguities.length > 0) {
    lines.push('RETAINED AMBIGUITY');
    for (const marker of [...input.ambiguities].sort((a, b) =>
      a.kind === b.kind ? (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0) : a.kind < b.kind ? -1 : 1,
    )) {
      const alternatives =
        marker.alternatives !== undefined ? ` (alternatives retained: ${marker.alternatives.join(', ')})` : '';
      lines.push(`  [${marker.kind}] ${marker.subject}`);
      lines.push(`    ${marker.detail}${alternatives}`);
    }
    lines.push('');
  }

  // SUMMARY
  const allRecords = input.sections.flatMap((section) => section.result.records);
  const totalCounts = countClassifications(allRecords);
  lines.push('SUMMARY');
  lines.push(`  sections: ${input.sections.length}`);
  lines.push(`  total findings: ${allRecords.length}`);
  for (const classification of ALL_CLASSES) {
    lines.push(`    ${classification}: ${totalCounts[classification]}`);
  }
  const adjudication = allRecords
    .filter((record) => (ADJUDICATION_CLASSES as readonly string[]).includes(record.classification))
    .map((record) => record.subject);
  const adjudicationSubjects = [...new Set(adjudication)].sort();
  lines.push(`  subjects requiring human adjudication: ${adjudicationSubjects.length}`);
  for (const subject of adjudicationSubjects) {
    lines.push(`    - ${subject}`);
  }
  lines.push(`  drift evidence records: ${input.sections.reduce((sum, section) => sum + section.result.drift.length, 0)}`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Section helpers
// ---------------------------------------------------------------------------

/** Build report sections from hypothesis comparisons (labels carry id, strategy and verdict). */
export function sectionsFromComparisons(comparisons: readonly HypothesisComparison[]): ReportSection[] {
  return comparisons.map((comparison) => ({
    label: `Hypothesis ${comparison.hypothesis_id} (strategy ${comparison.hypothesis_strategy}, verdict ${comparison.verdict})`,
    result: comparison,
  }));
}
