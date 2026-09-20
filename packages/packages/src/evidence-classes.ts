/**
 * Package evidence classification (docs/package-ecology.md evidence classes)
 * over the merged @sos-2/evidence record contract (EvidenceRecordW3, Work
 * Order W3 — consumed, never redefined).
 *
 * The ecology doc names seven evidence classes:
 *   observational success, comparative evidence, intervention evidence,
 *   failure evidence, transfer evidence, composition evidence,
 *   longevity/decay evidence.
 *
 * They are realized here as a frozen classification vocabulary derived from
 * the NORMATIVE fields of an evidence record (never from free-text claims):
 *
 *   FAILURE              availability === 'FAILURE' (retention first —
 *                        failure evidence is always recognized; failures are
 *                        retained, never dropped)
 *   INTERVENTIONAL       evidence_class === 'INTERVENTIONAL' (the W3
 *                        observation/intervention distinction — trusted
 *                        before any kind-string heuristic)
 *   COMPARATIVE          kind matches comparison heuristics (benchmark,
 *                        comparison, evaluation, baseline)
 *   TRANSFER             kind matches transfer heuristics (transfer,
 *                        migration, port)
 *   COMPOSITION          kind matches composition heuristics (composition)
 *   LONGEVITY_DECAY      kind matches longevity heuristics (longevity,
 *                        decay, durability)
 *   OBSERVATIONAL_SUCCESS  otherwise, availability === 'SUCCESS'
 *   UNCLASSIFIED         anything else (UNKNOWN/PARTIAL/UNAVAILABLE/
 *                        UNSUPPORTED non-matching records)
 *
 * The derived class is DETERMINISTIC (a pure function of the record) and
 * documented; callers may always treat UNCLASSIFIED honestly instead of
 * guessing. A second, orthogonal feature summary counts successes/failures
 * by availability regardless of class.
 */

import { isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { PackageError } from './errors.js';

export const PACKAGE_EVIDENCE_CLASSES = [
  'OBSERVATIONAL_SUCCESS',
  'COMPARATIVE',
  'INTERVENTIONAL',
  'FAILURE',
  'TRANSFER',
  'COMPOSITION',
  'LONGEVITY_DECAY',
  'UNCLASSIFIED',
] as const;

export type PackageEvidenceClass = (typeof PACKAGE_EVIDENCE_CLASSES)[number];

const PACKAGE_EVIDENCE_CLASS_SET: ReadonlySet<string> = new Set(PACKAGE_EVIDENCE_CLASSES);

export function isPackageEvidenceClass(value: unknown): value is PackageEvidenceClass {
  return typeof value === 'string' && PACKAGE_EVIDENCE_CLASS_SET.has(value);
}

const COMPARATIVE_PATTERN = /(compar|benchmark|evaluat|baseline|ab[-_. ]?test)/i;
const TRANSFER_PATTERN = /(transfer|migrat|port)/i;
const COMPOSITION_PATTERN = /compos/i;
const LONGEVITY_PATTERN = /(longev|decay|durab)/i;

/**
 * Derive the primary package evidence class of a W3 evidence record.
 * Deterministic, pure, normative-fields-only (see module doc).
 */
export function classifyPackageEvidence(record: EvidenceRecordW3): PackageEvidenceClass {
  if (record.availability === 'FAILURE') {
    return 'FAILURE';
  }
  if (record.evidence_class === 'INTERVENTIONAL') {
    return 'INTERVENTIONAL';
  }
  const kind = typeof record.kind === 'string' ? record.kind : '';
  if (COMPARATIVE_PATTERN.test(kind)) {
    return 'COMPARATIVE';
  }
  if (TRANSFER_PATTERN.test(kind)) {
    return 'TRANSFER';
  }
  if (COMPOSITION_PATTERN.test(kind)) {
    return 'COMPOSITION';
  }
  if (LONGEVITY_PATTERN.test(kind)) {
    return 'LONGEVITY_DECAY';
  }
  if (record.availability === 'SUCCESS') {
    return 'OBSERVATIONAL_SUCCESS';
  }
  return 'UNCLASSIFIED';
}

/** Class counts over a set of evidence records. */
export type EvidenceClassCounts = Readonly<Record<PackageEvidenceClass, number>>;

/** Feature summary of an evidence set (classes + availability counts). */
export interface EvidenceSetSummary {
  /** Total records summarized. */
  total: number;
  /** Records with availability SUCCESS (any class). */
  successes: number;
  /** Records with availability FAILURE (any class). */
  failures: number;
  /** Availability counts across the 6 distinct truth states. */
  availabilityCounts: Readonly<Record<EvidenceTruthState, number>>;
  /** Class counts across the 8 package evidence classes. */
  classCounts: EvidenceClassCounts;
  /** Comparative OR interventional records (the anti-lucky-success signal). */
  comparativeOrInterventional: number;
}

function zeroClassCounts(): Record<PackageEvidenceClass, number> {
  return {
    OBSERVATIONAL_SUCCESS: 0,
    COMPARATIVE: 0,
    INTERVENTIONAL: 0,
    FAILURE: 0,
    TRANSFER: 0,
    COMPOSITION: 0,
    LONGEVITY_DECAY: 0,
    UNCLASSIFIED: 0,
  };
}

function zeroAvailabilityCounts(): Record<EvidenceTruthState, number> {
  return { SUCCESS: 0, FAILURE: 0, UNKNOWN: 0, UNAVAILABLE: 0, UNSUPPORTED: 0, PARTIAL: 0 };
}

/** Summarize a set of evidence records (deterministic; order-independent). */
export function summarizeEvidenceSet(records: readonly EvidenceRecordW3[]): EvidenceSetSummary {
  if (!Array.isArray(records)) {
    throw new PackageError('summarizeEvidenceSet requires an array of evidence records');
  }
  const classCounts = zeroClassCounts();
  const availabilityCounts = zeroAvailabilityCounts();
  let successes = 0;
  let failures = 0;
  for (const record of records) {
    const truthState = record.availability;
    if (!isEvidenceTruthState(truthState)) {
      throw new PackageError(
        `evidence record ${JSON.stringify(record.id)} carries a truth state outside the frozen 6: ${JSON.stringify(truthState)}`,
      );
    }
    availabilityCounts[truthState] += 1;
    if (truthState === 'SUCCESS') {
      successes += 1;
    }
    if (truthState === 'FAILURE') {
      failures += 1;
    }
    classCounts[classifyPackageEvidence(record)] += 1;
  }
  return {
    total: records.length,
    successes,
    failures,
    availabilityCounts,
    classCounts,
    comparativeOrInterventional: classCounts.COMPARATIVE + classCounts.INTERVENTIONAL,
  };
}

/**
 * The one-lucky-success detector (spec/architecture-lock.md forbidden
 * shortcut: "package promoted after one lucky success").
 *
 * One lucky success = EXACTLY ONE record with availability SUCCESS and ZERO
 * comparative-or-interventional records. Replication (>= 2 successes) or a
 * single comparative/interventional study escapes the lucky-success regime.
 */
export function isOneLuckySuccess(summary: EvidenceSetSummary): boolean {
  return summary.successes === 1 && summary.comparativeOrInterventional === 0;
}
