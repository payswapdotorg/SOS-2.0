/**
 * The P19 evidence writer — shared by the real-dogfood suites: writes
 * honest, redacted, canonical JSON evidence records into
 * docs/evidence/production-connectivity/dogfood/ (the P18-INT
 * writeEvidence pattern).
 *
 * DISCIPLINE (the P17-A/P18-B/P18-INT precedent):
 *  - every record passes through BOTH merged redaction corpora (the
 *    deployment corpus + the observation corpus) BEFORE it is serialized
 *    — a credential value that leaked into any field is redacted first,
 *    and the redaction itself is reported (pattern ids, never matched
 *    text);
 *  - every record carries the exact git head it was produced at, the
 *    work order and the evidence kind;
 *  - failures are recorded as HONEST outcomes (real error text, honest
 *    provider states) — never retried into fake success;
 *  - credentials are referenced by environment-variable NAMES only.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactDeploymentSecrets } from '@sos-2/deployment-providers';
import { redactObservationSecrets } from '@sos-2/real-observation';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs', 'evidence', 'production-connectivity', 'dogfood');

/** The evidence record header every P19 record carries. */
export interface DogfoodEvidenceHeader {
  readonly work_order: 'P19';
  readonly evidence_kind: string;
  readonly produced_at: string;
  readonly repo_head: string;
}

export interface WrittenDogfoodEvidence {
  readonly file: string;
  readonly serialized: string;
  readonly redactedPatternIds: readonly string[];
}

/** The exact git head this record was produced at (bound to the run, never guessed). */
export function repoHeadSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
}

/** Redact a record deeply (strings in place; arrays/objects walked) — BOTH corpora, fail-closed. */
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

/** Collect the redaction pattern ids of a record (ids only, never matched text). */
function walkFindings(value: unknown, sink: Set<string>): void {
  if (typeof value === 'string') {
    for (const finding of redactDeploymentSecrets(value).findings) sink.add(finding.patternId);
    for (const finding of redactObservationSecrets(value).findings) sink.add(finding.patternId);
  } else if (Array.isArray(value)) {
    for (const child of value) walkFindings(child, sink);
  } else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) walkFindings(child, sink);
  }
}

/**
 * Write one P19 evidence record (fail-closed dual redaction; canonical
 * JSON; the header fields are stamped here so no caller can forget them).
 * The output directory defaults to the committed evidence root; the
 * deterministic suites redirect it to a temp directory (the committed
 * records are the REAL runs' products).
 */
export function writeDogfoodEvidence(input: {
  readonly evidence_kind: string;
  readonly record: Record<string, unknown>;
  readonly file: string;
  readonly head: string;
  readonly producedAt?: string;
  readonly outputRoot?: string;
}): WrittenDogfoodEvidence {
  const header: DogfoodEvidenceHeader = {
    work_order: 'P19',
    evidence_kind: input.evidence_kind,
    produced_at: input.producedAt ?? new Date().toISOString(),
    repo_head: input.head,
  };
  const redacted = redactDeep({ ...header, ...input.record }) as Record<string, unknown>;
  const patternIds = new Set<string>();
  walkFindings(input.record, patternIds);
  const serialized = `${JSON.stringify(redacted, null, 2)}\n`;
  const file = path.join(input.outputRoot ?? EVIDENCE_ROOT, input.file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serialized);
  return { file, serialized, redactedPatternIds: [...patternIds].sort() };
}

/**
 * The P19 secrets audit over the owned paths: scans every committed file
 * of the lane through BOTH merged corpora — findings carry pattern ids +
 * file + line ONLY (never the matched text). 0 findings is the committed
 * invariant.
 */
export function auditDogfoodSecrets(root: string = REPO_ROOT): {
  readonly scannedFiles: number;
  readonly findings: readonly { readonly patternId: string; readonly file: string; readonly line: number }[];
} {
  const ownedDirs = ['packages/dogfood-live', 'tests/real-dogfood', 'docs/evidence/production-connectivity/dogfood'];
  const findings: { patternId: string; file: string; line: number }[] = [];
  let scannedFiles = 0;
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }
        walk(full);
      } else {
        scannedFiles += 1;
        const text = readFileSync(full, 'utf8');
        const lines = text.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? '';
          for (const finding of redactDeploymentSecrets(line).findings) {
            findings.push({ patternId: finding.patternId, file: path.relative(root, full), line: index + 1 });
          }
          for (const finding of redactObservationSecrets(line).findings) {
            findings.push({ patternId: finding.patternId, file: path.relative(root, full), line: index + 1 });
          }
        }
      }
    }
  };
  for (const dir of ownedDirs) {
    walk(path.join(root, dir));
  }
  return { scannedFiles, findings };
}
