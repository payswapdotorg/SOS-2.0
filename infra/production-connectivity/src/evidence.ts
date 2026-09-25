/**
 * The P17-A evidence builders — machine-readable evidence records for
 * the persistence-deployment lane. Every record:
 *
 *   - carries the exact schema id, work order, produced-at instant
 *     (injected clock) and credential env NAMES (never values);
 *   - is serialized through BOTH lane redaction corpora (the
 *     persistence corpus + the deployment corpus) BEFORE it can reach
 *     a file — a credential value that leaked into any field is
 *     redacted first, and the redaction itself is reported (pattern
 *     ids, never matched text);
 *   - validates redacted-clean: `assertEvidenceIsRedacted` fails
 *     closed on any residual secret-shaped finding.
 */

import { redactPersistenceSecrets } from '@sos-2/real-persistence';
import { redactDeploymentSecrets } from '@sos-2/deployment-providers';

/** The evidence schema prefix of this lane. */
export const PERSISTENCE_DEPLOYMENT_EVIDENCE_SCHEMA_PREFIX = 'sos-2/p17a';

export interface EvidenceRecordInput {
  /** The record schema (e.g. 'sos-2/p17a/neon-integration'). */
  readonly schema: string;
  /** The work order ('P17-A'). */
  readonly workOrder: string;
  /** RFC3339 production instant (injected clock). */
  readonly producedAt: string;
  /** The record body (any JSON). */
  readonly body: unknown;
}

/** One redacted evidence record + the redaction findings (pattern ids only). */
export interface EvidenceRecord {
  readonly schema: string;
  readonly work_order: string;
  readonly produced_at: string;
  readonly body: unknown;
  /** Pattern ids redacted from the serialized record (ids only — never matched text). */
  readonly redactedPatternIds: readonly string[];
}

/** Build one redacted evidence record (deterministic; pure). */
export function buildEvidenceRecord(input: EvidenceRecordInput): EvidenceRecord {
  if (!input.schema.startsWith(PERSISTENCE_DEPLOYMENT_EVIDENCE_SCHEMA_PREFIX)) {
    throw new Error(`evidence record schema must start with '${PERSISTENCE_DEPLOYMENT_EVIDENCE_SCHEMA_PREFIX}' (got '${input.schema}')`);
  }
  if (typeof input.workOrder !== 'string' || input.workOrder.length === 0) {
    throw new Error('evidence record workOrder must be a non-empty string');
  }
  const envelope = {
    schema: input.schema,
    work_order: input.workOrder,
    produced_at: input.producedAt,
    body: input.body,
  };
  const first = redactPersistenceSecrets(JSON.stringify(envelope, null, 2));
  const second = redactDeploymentSecrets(first.redacted);
  const redactedIds = new Set<string>();
  for (const finding of [...first.findings, ...second.findings]) {
    redactedIds.add(finding.patternId);
  }
  const record = JSON.parse(second.redacted) as { schema: string; work_order: string; produced_at: string; body: unknown };
  return {
    schema: record.schema,
    work_order: record.work_order,
    produced_at: record.produced_at,
    body: record.body,
    redactedPatternIds: [...redactedIds].sort(),
  };
}

/** Serialize one evidence record to its canonical file form (pretty JSON + newline). */
export function serializeEvidenceRecord(record: EvidenceRecord): string {
  return `${JSON.stringify(
    {
      schema: record.schema,
      work_order: record.work_order,
      produced_at: record.produced_at,
      ...redactBodyFields(record.body),
      redacted_pattern_ids: [...record.redactedPatternIds],
    },
    null,
    2,
  )}\n`;
}

function redactBodyFields(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { body };
  }
  return body as Record<string, unknown>;
}

/**
 * Fail-closed redaction check: scan a serialized evidence JSON with
 * BOTH lane corpora and throw naming the pattern ids (never matched
 * text) when any secret-shaped value remains.
 */
export function assertEvidenceIsRedacted(serializedJson: string): void {
  const first = redactPersistenceSecrets(serializedJson);
  const second = redactDeploymentSecrets(first.redacted);
  const ids = new Set<string>();
  for (const finding of [...first.findings, ...second.findings]) {
    ids.add(finding.patternId);
  }
  if (ids.size > 0) {
    throw new Error(
      `evidence record carries secret-shaped material (pattern ids only, values suppressed): ${[...ids].sort().join(', ')} — redact before persisting`,
    );
  }
}
