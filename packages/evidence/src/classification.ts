/**
 * Evidence classes — the OBSERVATION/INTERVENTION distinction (Work Order W3;
 * spec/architecture.md §18: "Intervention evidence outranks observational
 * correlation for strong causal claims").
 *
 * The two classes are SEMANTICALLY DISTINCT and never conflated:
 *
 *   OBSERVATIONAL   the evidence arises from observing the system without
 *                   intervening (telemetry ingestion, incident reports,
 *                   passive monitoring). EVERY record ingested from telemetry
 *                   is observational — the system was watched, not perturbed.
 *   INTERVENTIONAL  the evidence arises from an intervention (an experiment,
 *                   an A/B deployment, a fault injection). Only explicit
 *                   intervention creates interventional evidence.
 *
 * The normative EvidenceRecord (spec/contracts/evidence.schema.json) carries
 * the two booleans `observational` and `intervention`; this module enforces
 * that EXACTLY ONE of them is true — never both, never neither. They are
 * derived from the declared class so a record can never claim to be both, or
 * silently claim to be neither.
 */

import { EvidenceError } from './errors.js';

export const EVIDENCE_CLASSES = ['OBSERVATIONAL', 'INTERVENTIONAL'] as const;

export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

const EVIDENCE_CLASS_SET: ReadonlySet<string> = new Set(EVIDENCE_CLASSES);

/** Structural check: is this one of the two evidence classes? */
export function isEvidenceClass(value: unknown): value is EvidenceClass {
  return typeof value === 'string' && EVIDENCE_CLASS_SET.has(value);
}

/** Validation with a specific error message (throws EvidenceError). */
export function assertValidEvidenceClass(value: unknown): asserts value is EvidenceClass {
  if (!isEvidenceClass(value)) {
    throw new EvidenceError(
      `evidence class must be OBSERVATIONAL or INTERVENTIONAL, received: ${JSON.stringify(value)} ` +
        '(the observation/intervention distinction is never conflated and never left undeclared)',
    );
  }
}

/** The normative boolean flags implied by a declared evidence class. */
export function evidenceClassFlags(evidenceClass: EvidenceClass): {
  observational: boolean;
  intervention: boolean;
} {
  assertValidEvidenceClass(evidenceClass);
  return {
    observational: evidenceClass === 'OBSERVATIONAL',
    intervention: evidenceClass === 'INTERVENTIONAL',
  };
}

/**
 * The evidence class implied by the normative boolean flags. Throws on any
 * conflation: both flags true (claims to be both) or neither true (claims to
 * be neither) are rejected loudly.
 */
export function flagsToEvidenceClass(observational: boolean, intervention: boolean): EvidenceClass {
  if (observational && intervention) {
    throw new EvidenceError(
      'evidence conflation rejected: observational and intervention are both true ' +
        '(a single piece of evidence is exactly one of the two classes)',
    );
  }
  if (!observational && !intervention) {
    throw new EvidenceError(
      'evidence class undeclared rejected: observational and intervention are both false ' +
        '(evidence must declare exactly one class)',
    );
  }
  return observational ? 'OBSERVATIONAL' : 'INTERVENTIONAL';
}

/** True iff the record is observational (never intervened). */
export function isObservationalEvidence(record: { evidence_class: EvidenceClass }): boolean {
  return record.evidence_class === 'OBSERVATIONAL';
}

/** True iff the record arises from an intervention. */
export function isInterventionalEvidence(record: { evidence_class: EvidenceClass }): boolean {
  return record.evidence_class === 'INTERVENTIONAL';
}

export interface CausalSupport {
  /** True iff the evidence set supports a STRONG causal claim. */
  supported: boolean;
  /** How many interventional SUCCESS records back the claim. */
  interventionalSupport: number;
  /** How many observational records were considered (correlation only). */
  observationalRecords: number;
  reason: string;
}

/**
 * Whether a set of evidence records supports a STRONG causal claim.
 *
 * Locked rule (spec/architecture.md §18): intervention evidence outranks
 * observational correlation for strong causal claims. A claim is strongly
 * supported ONLY by at least one INTERVENTIONAL record whose availability is
 * SUCCESS. Observational records — however many — never elevate a claim past
 * correlation, and interventional FAILURE/UNKNOWN/UNAVAILABLE/PARTIAL records
 * do not support the claim.
 */
export function supportsStrongCausalClaim(
  evidence: readonly { evidence_class: EvidenceClass; availability: string }[],
): CausalSupport {
  if (!Array.isArray(evidence)) {
    throw new EvidenceError('supportsStrongCausalClaim requires an array of evidence records');
  }
  let interventionalSupport = 0;
  let observationalRecords = 0;
  for (const record of evidence) {
    if (record.evidence_class === 'INTERVENTIONAL') {
      if (record.availability === 'SUCCESS') {
        interventionalSupport += 1;
      }
    } else {
      observationalRecords += 1;
    }
  }
  if (interventionalSupport > 0) {
    return {
      supported: true,
      interventionalSupport,
      observationalRecords,
      reason: `${interventionalSupport} interventional SUCCESS record(s) support the claim`,
    };
  }
  if (observationalRecords > 0) {
    return {
      supported: false,
      interventionalSupport,
      observationalRecords,
      reason:
        `${observationalRecords} observational record(s) establish correlation only — ` +
        'a strong causal claim requires intervention evidence (spec/architecture.md §18)',
    };
  }
  return {
    supported: false,
    interventionalSupport,
    observationalRecords,
    reason: 'no evidence records were provided',
  };
}
