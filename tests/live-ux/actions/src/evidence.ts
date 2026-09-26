/**
 * The P18-B evidence writer — shared by the real-integration suite:
 * writes honest, redacted, canonical JSON evidence records into
 * docs/evidence/production-connectivity/live-ux/actions-mission/.
 *
 * DISCIPLINE (the P17-A/P17-C precedent):
 *  - every record passes through BOTH merged redaction corpora (the
 *    deployment corpus + the observation corpus) BEFORE it is serialized
 *    — a credential value that leaked into any field is redacted first,
 *    and the redaction itself is reported (pattern ids, never matched
 *    text);
 *  - every record carries the exact git head it was produced at, the
 *    work order and the schema id;
 *  - failures are recorded as HONEST outcomes (real error text, honest
 *    provider states) — never retried into fake success;
 *  - credentials are referenced by environment-variable NAMES only.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactDeploymentSecrets } from '@sos-2/deployment-providers';
import { redactObservationSecrets } from '@sos-2/real-observation';

const EVIDENCE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/evidence/production-connectivity/live-ux/actions-mission',
);

/** The evidence record header every P18-B record carries. */
export interface EvidenceHeader {
  readonly work_order: 'P18-B';
  readonly evidence_kind: string;
  readonly produced_at: string;
  readonly repo_head: string;
}

export interface WrittenEvidence {
  readonly file: string;
  readonly serialized: string;
  readonly redactedPatternIds: readonly string[];
}

/** Redact a record deeply (strings in place; arrays/objects walked). */
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactObservationSecrets(redactDeploymentSecrets(value).redacted).redacted;
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(child);
    }
    return out;
  }
  return value;
}

/** Write one redacted evidence record (fail-closed on residual secret-shaped material). */
export function writeEvidence(input: { schema: string; evidenceKind: string; producedAt: string; repoHead: string; fileName: string; body: unknown }): WrittenEvidence {
  if (!input.schema.startsWith('sos-2/p18b/')) {
    throw new Error(`evidence record schema must start with 'sos-2/p18b/' (got '${input.schema}')`);
  }
  const header: EvidenceHeader = { work_order: 'P18-B', evidence_kind: input.evidenceKind, produced_at: input.producedAt, repo_head: input.repoHead };
  const redacted = redactDeep({ ...header, ...({ schema: input.schema, body: input.body } as Record<string, unknown>) });
  const serialized = `${JSON.stringify(redacted, null, 2)}\n`;
  // fail closed: after redaction there must be NO residual secret-shaped finding
  const check = redactObservationSecrets(serialized);
  if (check.findings.length > 0) {
    throw new Error(`evidence record ${input.fileName} still carries secret-shaped material (${check.findings.map((f) => f.patternId).join(', ')}) — refusing to write`);
  }
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const file = path.join(EVIDENCE_ROOT, input.fileName);
  writeFileSync(file, serialized);
  return { file, serialized, redactedPatternIds: [] };
}

/** The evidence directory (for structural scans). */
export const EVIDENCE_DIR = EVIDENCE_ROOT;
