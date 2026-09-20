/**
 * Transfer evidence records — the distinct TRANSFER evidence class (Work
 * Order W13; docs/package-ecology.md evidence classes: "... transfer evidence
 * ..."; spec/architecture.md §12: "Package/candidate performance is
 * context-conditioned").
 *
 * Applying a package/composition in a NEW context is a distinct evidence
 * class of its own. The machine-checked disciplines:
 *
 *   - CONTEXT-CONDITIONED, SOURCE-NEVER-UPDATED (the locked rule): a
 *     transfer outcome is recorded between a SOURCE context (where the
 *     solution was known) and a TARGET context (the new one; they must
 *     differ — a "transfer" to the same context is not a transfer). The
 *     record's optional applicability estimate — the estimate the transfer
 *     FEEDS — must be conditioned WITHIN the target context; an estimate
 *     conditioned on the source context is REJECTED at construction with a
 *     specific error. There is NO code path that produces a source-context
 *     estimate from a transfer outcome: deriveTargetEstimate only ever
 *     returns target-conditioned estimates (docs/package-ecology.md
 *     "Applicability: Estimate context-conditioned outcome probability. Do
 *     not use a universal score.").
 *
 *   - NUMERIC PROBABILITY ONLY WITH CALIBRATION (§12; spec/meta-model.md):
 *     the estimate field is validated by the W6 applicability authority
 *     (@sos-2/packages assertValidApplicability) — a CALIBRATED numeric
 *     probability without its calibration artifact ref is REJECTED. There is
 *     no raw numeric probability field anywhere on a transfer record.
 *
 *   - CAUSAL CLAIM TERRITORY (spec/architecture.md §18: "Intervention
 *     evidence outranks observational correlation for strong causal claims"):
 *     a transfer record carries a claim_strength (vocabulary imported from
 *     @sos-2/causal — CAUSAL | CORRELATIONAL, default CORRELATIONAL).
 *     Claiming CAUSAL ("deploying this package in the target context causes
 *     the observed outcomes") requires at least one INTERVENTIONAL SUCCESS
 *     evidence record — the check is DELEGATED to @sos-2/evidence
 *     supportsStrongCausalClaim (the merged W3/W5 authority), never
 *     re-implemented. An observational-only causal claim is REJECTED.
 *
 *   - EVIDENCE-BACKED: every record cites a NON-EMPTY set of evidence
 *     records; ids are content-addressed over the canonical content
 *     (citation order never changes identity); snapshots round-trip.
 */

import { fullContentHash, isArtifactId, parseArtifactId, RFC3339_PATTERN } from '@sos-2/semantic-spine';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { supportsStrongCausalClaim } from '@sos-2/evidence';
import { CLAIM_STRENGTHS } from '@sos-2/causal';
import type { ClaimStrength } from '@sos-2/causal';
import { isClaimStrength } from '@sos-2/causal';
import {
  assertValidApplicability,
  assertValidContextCondition,
  matchesCondition,
  sameCondition,
} from '@sos-2/packages';
import type { ApplicabilityEstimate, ContextCondition } from '@sos-2/packages';
import { TransferError } from './errors.js';

/** The typed transfer outcomes. */
export const TRANSFER_OUTCOMES = ['TRANSFER_SUCCESS', 'TRANSFER_FAILURE', 'TRANSFER_INCONCLUSIVE'] as const;

export type TransferOutcome = (typeof TRANSFER_OUTCOMES)[number];

const TRANSFER_OUTCOME_SET: ReadonlySet<string> = new Set(TRANSFER_OUTCOMES);

/** Structural check: one of the three transfer outcomes? */
export function isTransferOutcome(value: unknown): value is TransferOutcome {
  return typeof value === 'string' && TRANSFER_OUTCOME_SET.has(value);
}

/** The artifact kinds a transfer source may be (the reusable population). */
export const TRANSFER_SOURCE_KINDS = ['Package', 'PackageComposition'] as const;

const TRANSFER_SOURCE_KIND_SET: ReadonlySet<string> = new Set(TRANSFER_SOURCE_KINDS);

/** One transfer evidence record (context-conditioned; feeds the target context). */
export interface TransferEvidenceRecord {
  /** Deterministic content-addressed id (64 lowercase hex; NOT a spine artifact id). */
  id: string;
  /** The transferred package/composition (sos://Package/... or sos://PackageComposition/...). */
  source_ref: string;
  /** The context the solution was known in (non-empty; never universal). */
  source_context: ContextCondition;
  /** The NEW context the solution was applied to (non-empty; differs from source_context). */
  target_context: ContextCondition;
  /** TRANSFER_SUCCESS, TRANSFER_FAILURE or TRANSFER_INCONCLUSIVE. */
  outcome: TransferOutcome;
  /** Evidence backing the record (sorted unique sos://Evidence ids). */
  evidence_refs: string[];
  /** The claim strength asserted for the transfer (imported vocabulary; default CORRELATIONAL). */
  claim_strength: ClaimStrength;
  /** Who/what recorded this — non-empty entries. */
  provenance: string[];
  /** RFC3339 recording timestamp (caller-supplied; never a hidden clock). */
  recorded_at: string;
  /** Optional statement, or null. */
  note: string | null;
  /**
   * The applicability estimate this transfer FEEDS — conditioned WITHIN the
   * target context (a source-context estimate is REJECTED); null when the
   * transfer carries no estimate.
   */
  estimate: ApplicabilityEstimate | null;
}

/** Input to a transfer record (id is derived; evidence records REQUIRED). */
export interface RecordTransferInput {
  source_ref: string;
  source_context: ContextCondition;
  target_context: ContextCondition;
  outcome: TransferOutcome;
  /** NON-EMPTY evidence records backing the transfer. */
  evidence: EvidenceRecordW3[];
  /** CORRELATIONAL (default) or CAUSAL (requires interventional SUCCESS evidence). */
  claim_strength?: ClaimStrength;
  /** NON-EMPTY entries. */
  provenance: string[];
  /** RFC3339 recording timestamp. */
  recorded_at: string;
  note?: string | null;
  /** Optional target-context estimate fed by the transfer. */
  estimate?: ApplicabilityEstimate | null;
}

/** The exact value a transfer id is derived from (exported for reproduction). */
export interface TransferContent {
  source_ref: string;
  source_context: ContextCondition;
  target_context: ContextCondition;
  outcome: TransferOutcome;
  evidence_refs: string[];
  claim_strength: ClaimStrength;
  provenance: string[];
  recorded_at: string;
  note: string | null;
  estimate: ApplicabilityEstimate | null;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Validate a record-transfer input (throws TransferError with a specific message). */
export function assertValidRecordTransferInput(value: unknown): asserts value is RecordTransferInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TransferError(`transfer input must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const sourceRef = record['source_ref'];
  if (!isArtifactId(sourceRef)) {
    throw new TransferError(`transfer source_ref must be a well-formed spine artifact id, received: ${JSON.stringify(sourceRef)}`);
  }
  const parsed = parseArtifactId(sourceRef);
  if (!TRANSFER_SOURCE_KIND_SET.has(parsed.kind)) {
    throw new TransferError(
      `transfer source_ref must be a Package or PackageComposition id (transfers move reusable solutions), received: ${JSON.stringify(sourceRef)}`,
    );
  }
  try {
    assertValidContextCondition(record['source_context'], 'transfer source_context');
  } catch (cause) {
    throw new TransferError(`transfer source_context is invalid: ${(cause as Error).message}`);
  }
  try {
    assertValidContextCondition(record['target_context'], 'transfer target_context');
  } catch (cause) {
    throw new TransferError(`transfer target_context is invalid: ${(cause as Error).message}`);
  }
  const sourceContext = record['source_context'] as ContextCondition;
  const targetContext = record['target_context'] as ContextCondition;
  if (sameCondition(sourceContext, targetContext)) {
    throw new TransferError(
      'transfer target_context must differ from source_context — applying a solution in the context it is ' +
        'already known in is not a transfer',
    );
  }
  if (!isTransferOutcome(record['outcome'])) {
    throw new TransferError(
      `transfer outcome must be one of ${TRANSFER_OUTCOMES.join(', ')}, received: ${JSON.stringify(record['outcome'])}`,
    );
  }
  const evidence = record['evidence'];
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new TransferError(
      'transfer evidence must be a NON-EMPTY array of evidence records — a transfer outcome without evidence is rejected',
    );
  }
  for (const entry of evidence) {
    if (typeof entry !== 'object' || entry === null) {
      throw new TransferError(`transfer evidence entries must be evidence records, received: ${JSON.stringify(entry)}`);
    }
  }
  // Causal claim territory (§18): delegated to the merged W3 authority.
  const claimStrength: ClaimStrength = record['claim_strength'] === undefined ? 'CORRELATIONAL' : (record['claim_strength'] as ClaimStrength);
  if (!isClaimStrength(claimStrength)) {
    throw new TransferError(
      `transfer claim_strength must be one of ${CLAIM_STRENGTHS.join(', ')} (imported from @sos-2/causal), received: ${JSON.stringify(record['claim_strength'])}`,
    );
  }
  if (claimStrength === 'CAUSAL') {
    const support = supportsStrongCausalClaim(evidence as EvidenceRecordW3[]);
    if (!support.supported) {
      throw new TransferError(
        `a CAUSAL transfer claim requires intervention evidence — ${support.reason} ` +
          '(spec/architecture.md §18; claim CORRELATIONAL instead, or cite the interventional study)',
      );
    }
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new TransferError('transfer provenance must be a non-empty array of non-empty strings');
  }
  const recordedAt = record['recorded_at'];
  if (typeof recordedAt !== 'string' || !RFC3339_PATTERN.test(recordedAt)) {
    throw new TransferError(`transfer recorded_at must be an RFC3339 timestamp, received: ${JSON.stringify(recordedAt)}`);
  }
  if (record['note'] !== undefined && record['note'] !== null && typeof record['note'] !== 'string') {
    throw new TransferError(`transfer note must be null or a string, received: ${JSON.stringify(record['note'])}`);
  }
  // The estimate the transfer FEEDS — target-context conditioned, never source.
  const estimate = record['estimate'];
  if (estimate !== undefined && estimate !== null) {
    try {
      assertValidApplicability(estimate);
    } catch (cause) {
      throw new TransferError(`transfer estimate is invalid: ${(cause as Error).message}`);
    }
    if (matchesCondition(estimate.context, sourceContext) && !matchesCondition(estimate.context, targetContext)) {
      throw new TransferError(
        'transfer outcomes NEVER update the source package\'s applicability estimate — the estimate fed by a ' +
        `transfer must be conditioned within the TARGET context, received an estimate conditioned on the source context ${JSON.stringify(estimate.context)}`,
      );
    }
    if (!matchesCondition(estimate.context, targetContext)) {
      throw new TransferError(
        `transfer estimate must be conditioned within the target context ${JSON.stringify(targetContext)}, ` +
          `received an estimate conditioned on ${JSON.stringify(estimate.context)}`,
      );
    }
  }
}

/** The exact derivation content of a transfer input. */
export function transferContent(input: RecordTransferInput): TransferContent {
  assertValidRecordTransferInput(input);
  return {
    source_ref: input.source_ref,
    source_context: { ...input.source_context },
    target_context: { ...input.target_context },
    outcome: input.outcome,
    evidence_refs: [...new Set(input.evidence.map((record) => record.id))].sort(compareStrings),
    claim_strength: input.claim_strength ?? 'CORRELATIONAL',
    provenance: [...input.provenance],
    recorded_at: input.recorded_at,
    note: input.note ?? null,
    estimate: input.estimate === undefined || input.estimate === null ? null : structuredClone(input.estimate),
  };
}

/** Deterministic content-addressed transfer id. */
export function transferId(input: RecordTransferInput): string {
  return fullContentHash(transferContent(input));
}

/** Create a validated transfer evidence record (id derived; evidence refs sorted unique). */
export function createTransferRecord(input: RecordTransferInput): TransferEvidenceRecord {
  const content = transferContent(input);
  return { id: fullContentHash(content), ...content };
}

/**
 * The applicability estimate a transfer record FEEDS — always conditioned
 * WITHIN the target context (never the source's):
 *
 *   - the record's declared estimate, when present; otherwise
 *   - for TRANSFER_SUCCESS: a derived QUALITATIVE estimate (uncertainty
 *     class WEAK — a single transfer is weak evidence; sample size = cited
 *     evidence count) conditioned exactly on the target context; otherwise
 *   - null (failures and inconclusive transfers feed no default estimate —
 *     they are retained as negative evidence instead).
 */
export function deriveTargetEstimate(record: TransferEvidenceRecord): ApplicabilityEstimate | null {
  if (record.estimate !== null) {
    return structuredClone(record.estimate);
  }
  if (record.outcome !== 'TRANSFER_SUCCESS') {
    return null;
  }
  return {
    kind: 'QUALITATIVE',
    uncertainty_class: 'WEAK',
    context: { ...record.target_context },
    sample_size: record.evidence_refs.length,
    window: null,
  };
}

/** Full semantic validation of a stored transfer record (throws TransferError). */
export function assertValidTransferRecord(value: unknown): asserts value is TransferEvidenceRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TransferError(`transfer record must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const hasNote = 'note' in record;
  if (Object.keys(record).length !== (hasNote ? 11 : 10) || !('id' in record)) {
    throw new TransferError(
      'transfer record must have the exact field set { id, source_ref, source_context, target_context, outcome, ' +
        'evidence_refs, claim_strength, provenance, recorded_at, note, estimate }',
    );
  }
  if (typeof record['id'] !== 'string' || !/^[0-9a-f]{64}$/.test(record['id'])) {
    throw new TransferError(`transfer record id must be 64 lowercase hex chars, received: ${JSON.stringify(record['id'])}`);
  }
  if (!isArtifactId(record['source_ref']) || !TRANSFER_SOURCE_KIND_SET.has(parseArtifactId(record['source_ref']).kind)) {
    throw new TransferError(
      `transfer record source_ref must be a Package or PackageComposition id, received: ${JSON.stringify(record['source_ref'])}`,
    );
  }
  try {
    assertValidContextCondition(record['source_context'], 'transfer source_context');
    assertValidContextCondition(record['target_context'], 'transfer target_context');
  } catch (cause) {
    throw new TransferError(`transfer record contexts are invalid: ${(cause as Error).message}`);
  }
  if (sameCondition(record['source_context'] as ContextCondition, record['target_context'] as ContextCondition)) {
    throw new TransferError('transfer record target_context must differ from source_context');
  }
  if (!isTransferOutcome(record['outcome'])) {
    throw new TransferError(`transfer record outcome must be one of ${TRANSFER_OUTCOMES.join(', ')}, received: ${JSON.stringify(record['outcome'])}`);
  }
  const evidenceRefs = record['evidence_refs'];
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new TransferError('transfer record evidence_refs must be a NON-EMPTY array');
  }
  for (const ref of evidenceRefs) {
    if (!isArtifactId(ref) || parseArtifactId(ref).kind !== 'Evidence') {
      throw new TransferError(`transfer record evidence_refs entries must be Evidence ids, received: ${JSON.stringify(ref)}`);
    }
  }
  if (!isClaimStrength(record['claim_strength'])) {
    throw new TransferError(`transfer record claim_strength must be one of ${CLAIM_STRENGTHS.join(', ')}, received: ${JSON.stringify(record['claim_strength'])}`);
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new TransferError('transfer record provenance must be a non-empty array of non-empty strings');
  }
  if (typeof record['recorded_at'] !== 'string' || !RFC3339_PATTERN.test(record['recorded_at'])) {
    throw new TransferError(`transfer record recorded_at must be RFC3339, received: ${JSON.stringify(record['recorded_at'])}`);
  }
  const estimate = record['estimate'];
  if (estimate !== null) {
    try {
      assertValidApplicability(estimate);
    } catch (cause) {
      throw new TransferError(`transfer record estimate is invalid: ${(cause as Error).message}`);
    }
    const estimateContext = (estimate as ApplicabilityEstimate).context;
    const sourceContext = record['source_context'] as ContextCondition;
    const targetContext = record['target_context'] as ContextCondition;
    if (matchesCondition(estimateContext, sourceContext) && !matchesCondition(estimateContext, targetContext)) {
      throw new TransferError(
        "transfer record estimate is conditioned on the SOURCE context — transfer outcomes never update the source package's applicability",
      );
    }
    if (!matchesCondition(estimateContext, targetContext)) {
      throw new TransferError('transfer record estimate must be conditioned within the target context');
    }
  }
  // Content-address discipline: the id pins the exact content.
  const content: TransferContent = {
    source_ref: record['source_ref'] as string,
    source_context: record['source_context'] as ContextCondition,
    target_context: record['target_context'] as ContextCondition,
    outcome: record['outcome'] as TransferOutcome,
    evidence_refs: evidenceRefs as string[],
    claim_strength: record['claim_strength'] as ClaimStrength,
    provenance: record['provenance'] as string[],
    recorded_at: record['recorded_at'] as string,
    note: (hasNote ? record['note'] : null) as string | null,
    estimate: estimate as ApplicabilityEstimate | null,
  };
  if (fullContentHash(content) !== record['id']) {
    throw new TransferError(
      `transfer record id does not match its content (content-address discipline): ${JSON.stringify(record['id'])}`,
    );
  }
}
