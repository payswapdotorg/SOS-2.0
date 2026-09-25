/**
 * The P17-C evidence writer (Work Order P17-C) — shared by the
 * real-provider integration suite: writes honest, redacted,
 * canonical-JSON evidence records into
 * docs/evidence/production-connectivity/observation-ux/.
 *
 * DISCIPLINE:
 *  - every record passes through the P17-C redaction corpus BEFORE it is
 *    serialized (secrets are references/env NAMES, never values);
 *  - every record carries the exact git head it was produced at and the
 *    endpoint/API revision it observed;
 *  - failures are recorded as HONEST outcomes (state UNAVAILABLE with
 *    the real reason) — never retried into fake success;
 *  - records are canonical JSON (sorted keys, no ambient time — the
 *    caller supplies every instant).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactObservationSecrets } from '@sos-2/real-observation';

const EVIDENCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/evidence/production-connectivity/observation-ux');

/** The evidence record header every file carries. */
export interface EvidenceHeader {
  readonly work_order: 'P17-C';
  readonly evidence_kind: string;
  readonly produced_at: string;
  readonly repo_head: string;
}

function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactObservationSecrets(value).redacted;
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(entry);
    }
    return out;
  }
  return value;
}

function canonicalStringify(value: unknown): string {
  const redacted = redactDeep(value);
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
  return serialize(redacted);
}

/** Write one evidence record (canonical JSON, redacted, pretty-free). Returns the written path. */
export function writeEvidence(relativePath: string, record: unknown): string {
  const target = path.join(EVIDENCE_ROOT, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${canonicalStringify(record)}\n`, 'utf8');
  return target;
}

/** Read one evidence record back (test helper). */
export function readEvidence(relativePath: string): unknown {
  const target = path.join(EVIDENCE_ROOT, relativePath);
  if (!existsSync(target)) {
    throw new Error(`missing evidence file: ${relativePath}`);
  }
  return JSON.parse(readFileSync(target, 'utf8')) as unknown;
}

/** Assert a string carries no secret VALUES (defense in depth for the writer). */
export function assertNoSecretValues(text: string): void {
  const { findings } = redactObservationSecrets(text);
  if (findings.length > 0) {
    throw new Error(`secret-shaped value found in evidence text (pattern ids: ${findings.map((f) => f.patternId).join(', ')}) — refusing to write`);
  }
}
