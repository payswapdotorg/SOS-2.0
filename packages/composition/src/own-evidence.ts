/**
 * Composition OWN-EVIDENCE discipline — the locked invariant, machine-checked
 * (spec/architecture.md §18: "Compositions require their own evidence";
 * spec/architecture-lock.md; R27).
 *
 * COMPOSITION EVIDENCE IS INDEPENDENT OF MEMBER EVIDENCE:
 *   - a composition's supporting evidence is EXACTLY the evidence whose
 *     subject is one of the composition's OWN spine ids (its chain — the
 *     composition id itself plus its superseded revisions);
 *   - evidence about a MEMBER package (subject = the member's id) is NEVER
 *     composition evidence — a ref pointing at member evidence is rejected
 *     with an explicit independence message;
 *   - composition validity does NOT derive from member validity: the
 *     promotion gates evaluate the OWN evidence set only. Members may be
 *     FORMING while the composition is VALIDATED (the composition has
 *     composed-system evidence of its own), and all members being VALIDATED
 *     never makes a composition validated without its own evidence.
 *
 * No circularity (documented): a composition's id is content-addressed over
 * its creation address; evidence ABOUT the composition therefore references
 * either (a) an earlier revision id in the composition's chain (the
 * form-then-promote workflow: create at DISCOVERED/FORMING, then promote
 * with own evidence about the earlier revision), or (b) an explicitly
 * minted id supplied at creation (the spine's sanctioned random-id mode).
 * Both paths are deterministic and reproducible; `chainIds` lets the
 * registry pass the full chain.
 */

import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { summarizeEvidenceSet } from '@sos-2/packages';
import type { EvidenceSetSummary } from '@sos-2/packages';
import { CompositionError } from './errors.js';

/** The verdict of an own-evidence evaluation. */
export interface OwnEvidenceVerdict {
  /** Whether the evidence set is valid own-evidence for the composition. */
  valid: boolean;
  /** Rejection reasons (empty iff valid). */
  reasons: string[];
  /** Summary of the OWN evidence records. */
  summary: EvidenceSetSummary;
  /** Cited refs that did not resolve. */
  unresolved_refs: string[];
  /** Refs rejected as member evidence (or otherwise not about the composition). */
  foreign_refs: string[];
}

/**
 * Evaluate a composition's evidence set against the own-evidence discipline.
 *
 * @param evidence_refs   the composition's cited evidence refs
 * @param evidence        the resolved records available (matched by id)
 * @param compositionId   the composition's own artifact id
 * @param chainIds        the composition's other chain ids (earlier revisions;
 *                        defaults to none — pass them when known, e.g. from
 *                        the registry)
 */
export function evaluateOwnEvidence(
  evidence_refs: readonly string[],
  evidence: readonly EvidenceRecordW3[],
  compositionId: string,
  chainIds: readonly string[] = [],
): OwnEvidenceVerdict {
  if (!Array.isArray(evidence_refs)) {
    throw new CompositionError('evidence_refs must be an array of evidence ids');
  }
  const own = new Set<string>([compositionId, ...chainIds]);
  const byId = new Map<string, EvidenceRecordW3>();
  for (const record of evidence) {
    byId.set(record.id, record);
  }
  const reasons: string[] = [];
  const unresolved: string[] = [];
  const foreign: string[] = [];
  const ownRecords: EvidenceRecordW3[] = [];
  for (const ref of evidence_refs) {
    const record = byId.get(ref);
    if (record === undefined) {
      unresolved.push(ref);
      continue;
    }
    if (!own.has(record.subject_ref)) {
      foreign.push(ref);
      continue;
    }
    ownRecords.push(record);
  }
  if (unresolved.length > 0) {
    reasons.push(
      `dangling evidence refs (every cited ref must resolve): ${unresolved.map((ref) => JSON.stringify(ref)).join(', ')}`,
    );
  }
  if (foreign.length > 0) {
    reasons.push(
      `evidence about OTHER subjects is not composition evidence (independence is a locked invariant — ` +
        `member success never implies composition success): ${foreign.map((ref) => JSON.stringify(ref)).join(', ')}`,
    );
  }
  if (evidence_refs.length === 0) {
    reasons.push('a composition requires its own evidence — an empty evidence set is rejected');
  }
  const summary = summarizeEvidenceSet(ownRecords);
  return { valid: reasons.length === 0, reasons, summary, unresolved_refs: unresolved, foreign_refs: foreign };
}

/** Throwing form of evaluateOwnEvidence. */
export function assertOwnEvidence(
  evidence_refs: readonly string[],
  evidence: readonly EvidenceRecordW3[],
  compositionId: string,
  chainIds: readonly string[] = [],
): OwnEvidenceVerdict {
  const verdict = evaluateOwnEvidence(evidence_refs, evidence, compositionId, chainIds);
  if (!verdict.valid) {
    throw new CompositionError(
      `composition own-evidence validation rejected: ${verdict.reasons.join('; ')}`,
    );
  }
  return verdict;
}
