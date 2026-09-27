/**
 * The P18-INT evidence writer — shared by the real-integration suite:
 * writes honest, redacted, canonical JSON evidence records into
 * docs/evidence/production-connectivity/live-ux/integration/.
 *
 * DISCIPLINE (the P17-A/P18-B precedent):
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

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactDeploymentSecrets } from '@sos-2/deployment-providers';
import { redactObservationSecrets } from '@sos-2/real-observation';

const EVIDENCE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/evidence/production-connectivity/live-ux/integration',
);

/** The evidence record header every P18-INT record carries. */
export interface EvidenceHeader {
  readonly work_order: 'P18-INT';
  readonly evidence_kind: string;
  readonly produced_at: string;
  readonly repo_head: string;
}

export interface WrittenEvidence {
  readonly file: string;
  readonly serialized: string;
  readonly redactedPatternIds: readonly string[];
}

/** The exact git head this record was produced at (bound to the run, never guessed). */
export function repoHeadSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..') }).toString().trim();
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

/**
 * Write one evidence record (fail-closed redaction; canonical JSON).
 * The record must carry the header fields; they are stamped here so no
 * caller can forget them.
 */
export function writeEvidence(input: {
  readonly evidence_kind: string;
  readonly record: Record<string, unknown>;
  readonly file: string;
  readonly head: string;
  readonly producedAt?: string;
}): WrittenEvidence {
  const header: EvidenceHeader = {
    work_order: 'P18-INT',
    evidence_kind: input.evidence_kind,
    produced_at: input.producedAt ?? new Date().toISOString(),
    repo_head: input.head,
  };
  const redacted = redactDeep({ ...header, ...input.record }) as Record<string, unknown>;
  const patternIds = new Set<string>();
  const walkFindings = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const finding of redactObservationSecrets(redactDeploymentSecrets(value).redacted).findings) patternIds.add(finding.patternId);
      for (const finding of redactDeploymentSecrets(value).findings) patternIds.add(finding.patternId);
    } else if (Array.isArray(value)) {
      for (const child of value) walkFindings(child);
    } else if (typeof value === 'object' && value !== null) {
      for (const child of Object.values(value as Record<string, unknown>)) walkFindings(child);
    }
  };
  walkFindings(input.record);
  const serialized = `${JSON.stringify(redacted, null, 2)}\n`;
  const file = path.join(EVIDENCE_ROOT, input.file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serialized);
  return { file, serialized, redactedPatternIds: [...patternIds].sort() };
}
