/**
 * Conformance evidence adoption (Work Order W8: "Integration: conformance
 * evidence (from @sos-2/conformance / @sos-2/runtime-conformance if merged
 * at base) feeds case evidence via spine trace links
 * (VERIFIES/SUPPORTS/CONTRADICTS)").
 *
 * Both conformance producers ARE merged at this base, so their evidence
 * kinds are CONSUMED from them (never re-declared here):
 *
 *   @sos-2/conformance           DRIFT_EVIDENCE_KINDS
 *                                ('architecture-drift',
 *                                 'architecture-contradiction')
 *   @sos-2/runtime-conformance   RUNTIME_CONFORMANCE_EVIDENCE_KIND
 *                                ('runtime-conformance')
 *
 * ADOPTION RULES (frozen; dishonest bindings are rejected loudly):
 *
 *   1. The evidence record must be a valid W3 Evidence record
 *      (@sos-2/evidence validation — the evidence authority).
 *
 *   2. Drift records ('architecture-drift' / 'architecture-contradiction')
 *      document NON-CONFORMANCE: they can ONLY be adopted with the
 *      CONTRADICTS role. A drift record can never support or verify a
 *      claim. (Their own availability is SUCCESS — they successfully
 *      document drift — which is exactly why the role rule is keyed on the
 *      KIND, not on availability.)
 *
 *   3. Every other conformance evidence record is keyed on its truthful
 *      availability:
 *        SUPPORTS / VERIFIES  requires availability SUCCESS;
 *        CONTRADICTS          requires availability FAILURE;
 *        non-conclusive states (UNKNOWN / UNAVAILABLE / UNSUPPORTED /
 *        PARTIAL) can be adopted with NO role — an inconclusive record
 *        neither supports nor contradicts, and binding it as either would
 *        be dishonest (rejected loudly).
 *
 *   4. The claim must exist; the same evidence cannot be bound to the same
 *      claim twice (no SUPPORTS + CONTRADICTS laundering of one record).
 *
 * The adoption produces (a) the NEXT case revision carrying the new
 * evidence reference and (b) a spine trace link
 * evidence.id --role--> new case artifact id, minted through the spine's
 * createTraceLink (well-formed ids, frozen type vocabulary, mandatory
 * provenance).
 */

import { createTraceLink } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { assertValidEvidenceRecord } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { DRIFT_EVIDENCE_KINDS } from '@sos-2/conformance';
import { RUNTIME_CONFORMANCE_EVIDENCE_KIND } from '@sos-2/runtime-conformance';
import { ConformanceAdoptionError } from './errors.js';
import { assertValidAssuranceCase, assertValidCaseRevision } from './case.js';
import type { AssuranceCaseArtifact, EvidenceRef, EvidenceRefRole } from './case.js';
import { buildCaseRevision } from './evolve.js';

/** The evidence kinds produced by the merged conformance packages (consumed, never re-declared). */
export const CONFORMANCE_EVIDENCE_KINDS: readonly string[] = [
  ...DRIFT_EVIDENCE_KINDS,
  RUNTIME_CONFORMANCE_EVIDENCE_KIND,
];

const DRIFT_KIND_SET: ReadonlySet<string> = new Set(DRIFT_EVIDENCE_KINDS);

const NON_CONCLUSIVE_STATES = ['UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const;

export interface AdoptConformanceEvidenceInput {
  /** The conformance evidence record being adopted (validated W3 record). */
  evidence: EvidenceRecordW3;
  /** The role the evidence plays for the claim (SUPPORTS / VERIFIES / CONTRADICTS). */
  role: EvidenceRefRole;
  /** The claim the evidence speaks to. */
  claim_ref: string;
  /** Provenance of the adoption (non-empty entries). */
  provenance: string[];
  /** RFC3339 revision creation timestamp. */
  created_at: string;
}

export interface AdoptedConformanceEvidence {
  /** The next case revision (version + 1) carrying the new evidence reference. */
  case: AssuranceCaseArtifact;
  /** The spine trace link: evidence.id --role--> the new case artifact id. */
  link: TraceLink;
}

/** Which roles may a record of this kind/availability take? (Pure; loud errors explain.) */
export function assertConformanceRoleAllowed(
  evidence: EvidenceRecordW3,
  role: EvidenceRefRole,
): void {
  if (DRIFT_KIND_SET.has(evidence.kind)) {
    if (role !== 'CONTRADICTS') {
      throw new ConformanceAdoptionError(
        `evidence of kind ${JSON.stringify(evidence.kind)} documents NON-CONFORMANCE and can only be adopted with the CONTRADICTS role, received: ${JSON.stringify(role)}`,
      );
    }
    return;
  }
  if (NON_CONCLUSIVE_STATES.includes(evidence.availability as (typeof NON_CONCLUSIVE_STATES)[number])) {
    throw new ConformanceAdoptionError(
      `evidence ${evidence.id} is in the non-conclusive truth state ${evidence.availability} — it neither supports nor contradicts, so it can be adopted under NO role (record it in the Evidence Graph, not as case support)`,
    );
  }
  if (role === 'CONTRADICTS') {
    if (evidence.availability !== 'FAILURE') {
      throw new ConformanceAdoptionError(
        `the CONTRADICTS role requires availability FAILURE, received: ${JSON.stringify(evidence.availability)} (a contradicting record must have truthfully observed the contradiction)`,
      );
    }
    return;
  }
  if (evidence.availability !== 'SUCCESS') {
    throw new ConformanceAdoptionError(
      `the ${role} role requires availability SUCCESS, received: ${JSON.stringify(evidence.availability)} (support must have truthfully succeeded)`,
    );
  }
}

/**
 * Adopt a conformance evidence record into the case: appends the evidence
 * reference to the next case revision and mints the spine trace link
 * evidence.id --role--> the new case artifact id.
 */
export function adoptConformanceEvidence(
  head: AssuranceCaseArtifact,
  input: AdoptConformanceEvidenceInput,
): AdoptedConformanceEvidence {
  assertValidAssuranceCase(head);
  if (typeof input !== 'object' || input === null) {
    throw new ConformanceAdoptionError('adoption input must be an object');
  }
  try {
    assertValidEvidenceRecord(input.evidence);
  } catch (cause) {
    throw new ConformanceAdoptionError(`evidence is not a valid W3 evidence record: ${(cause as Error).message}`);
  }
  if (!CONFORMANCE_EVIDENCE_KINDS.includes(input.evidence.kind)) {
    throw new ConformanceAdoptionError(
      `evidence kind ${JSON.stringify(input.evidence.kind)} is not a conformance evidence kind (expected one of: ${CONFORMANCE_EVIDENCE_KINDS.join(', ')}) — use the case constructor for generic evidence references`,
    );
  }
  assertConformanceRoleAllowed(input.evidence, input.role);
  if (typeof input.claim_ref !== 'string' || input.claim_ref.length === 0) {
    throw new ConformanceAdoptionError(`claim_ref must be a non-empty claim id, received: ${JSON.stringify(input.claim_ref)}`);
  }
  const claim = head.content.claims.find((entry) => entry.id === input.claim_ref);
  if (claim === undefined) {
    throw new ConformanceAdoptionError(
      `claim ${JSON.stringify(input.claim_ref)} does not exist in case ${head.envelope.id} (existing: ${head.content.claims.map((entry) => entry.id).join(', ')})`,
    );
  }
  if (
    head.content.evidence.some(
      (ref) => ref.evidence_id === input.evidence.id && ref.claim_ref === input.claim_ref,
    )
  ) {
    throw new ConformanceAdoptionError(
      `evidence ${input.evidence.id} is already referenced for claim ${JSON.stringify(input.claim_ref)} — the same evidence cannot be bound to the same claim twice`,
    );
  }

  const reference: EvidenceRef = {
    evidence_id: input.evidence.id,
    role: input.role,
    claim_ref: input.claim_ref,
  };
  const content = {
    ...structuredClone(head.content),
    evidence: [...structuredClone(head.content.evidence), reference],
  };
  const revision = buildCaseRevision(head, content, input.provenance, input.created_at);
  const next: AssuranceCaseArtifact = { envelope: revision.envelope, content: revision.content };
  assertValidCaseRevision(head, next);

  const link = createTraceLink({
    source: input.evidence.id,
    target: next.envelope.id,
    type: input.role,
    provenance: [
      ...input.provenance,
      `W8:adopt-conformance-evidence:${input.evidence.id}->${next.envelope.id}`,
    ],
  });

  return { case: next, link };
}
