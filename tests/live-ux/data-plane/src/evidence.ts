/**
 * The P18-A evidence writer (Work Order P18-A, live data lane) — shared
 * by the deterministic reference-mode suite (the reference run record)
 * and the env-gated real-provider integration suite: writes honest,
 * redacted, canonical-JSON evidence records into
 * docs/evidence/production-connectivity/live-ux/data-plane/.
 *
 * DISCIPLINE (the P17-C writer + the P17-A fail-closed redaction
 * combined):
 *  - every record passes through ALL THREE lane redaction corpora (the
 *    persistence corpus, the deployment corpus, the observation corpus)
 *    BEFORE it is serialized — a credential VALUE that leaked into any
 *    field is redacted first, and the fail-closed check throws on any
 *    residual secret-shaped finding (pattern ids only, never matched
 *    text);
 *  - every record carries the work order, the produced-at instant and
 *    the exact git head it was produced at;
 *  - failures are recorded as HONEST outcomes (state UNAVAILABLE with
 *    the real reason) — never retried into fake success;
 *  - records are canonical JSON (sorted keys).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactObservationSecrets } from '@sos-2/real-observation';
import { assertEvidenceIsRedacted } from '@sos-2/infra-production-connectivity';

const EVIDENCE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/evidence/production-connectivity/live-ux/data-plane',
);

/** The evidence record header every file carries. */
export interface EvidenceHeader {
  readonly work_order: 'P18-A';
  readonly evidence_kind: string;
  readonly produced_at: string;
  readonly repo_head: string;
}

/** The repo head sha (40-hex) of the current checkout — the exact-head binding source. */
export function repoHeadSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..') })
    .toString()
    .trim();
}

/** Deep-redact a value through the observation corpus (strings only; structure preserved). */
function redactObservationDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactObservationSecrets(value).redacted;
  }
  if (Array.isArray(value)) {
    return value.map(redactObservationDeep);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactObservationDeep(entry);
    }
    return out;
  }
  return value;
}

function canonicalStringify(value: unknown): string {
  const serialize = (input: unknown): string => {
    if (input === null || typeof input !== 'object') {
      return JSON.stringify(input) ?? 'null';
    }
    if (Array.isArray(input)) {
      return `[${input.map(serialize).join(',')}]`;
    }
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(',')}}`;
  };
  return serialize(value);
}

/**
 * Write one evidence record (canonical JSON, redacted through all three
 * corpora, fail-closed on residual secret-shaped material). Returns the
 * written path.
 */
export function writeEvidence(relativePath: string, record: unknown): string {
  const redacted = redactObservationDeep(record);
  const serialized = canonicalStringify(redacted);
  // fail-closed: the P17-A dual corpus check (persistence + deployment)
  assertEvidenceIsRedacted(serialized);
  // fail-closed: the observation corpus leaves no secret-shaped residue either
  const observationPass = redactObservationSecrets(serialized);
  if (observationPass.findings.length > 0) {
    throw new Error(
      `evidence record carries secret-shaped material (pattern ids only, values suppressed): ${observationPass.findings.map((finding) => finding.patternId).sort().join(', ')} — redact before persisting`,
    );
  }
  const target = path.join(EVIDENCE_ROOT, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${serialized}\n`, 'utf8');
  return target;
}
