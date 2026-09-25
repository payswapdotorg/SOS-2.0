/**
 * The P17-A secrets audit — prove no credential VALUE appears in any
 * committed file of the lane's owned paths (names only).
 *
 * TWO pattern sets, deliberately distinct:
 *
 *   - SOURCE_SCAN_PATTERNS — the precise, anchored shapes used to scan
 *     SOURCE files (the infra/deployment scanTextForSecrets
 *     discipline: specific provider prefixes and structural shapes).
 *     The transcript-redaction catch-alls (the broad base64-blob and
 *     bare-64-hex shapes) are deliberately REFINED here: their
 *     redaction breadth is intentional over-redaction for EVIDENCE,
 *     but against source text they would flag ordinary long identifiers
 *     and SigV4 signing CODE (the algorithm's own template strings) —
 *     false positives that would erode the audit's fail-closed
 *     meaning. The refined forms still catch real credential values
 *     (a real Upstash REST token is a ~64-char base64 blob; a real
 *     committed SigV4 authorization carries a concrete credential
 *     scope, not a template placeholder).
 *   - The full lane corpora (imported below) remain the REDACTION
 *     authority for evidence records and transcripts (fail-closed
 *     over-redaction is correct there).
 *
 * Findings carry pattern ids + positions ONLY — never the matched text.
 */

import { PERSISTENCE_REDACTION_PATTERNS } from '@sos-2/real-persistence';
import { DEPLOYMENT_REDACTION_PATTERNS } from '@sos-2/deployment-providers';

/** One audited file (label + text). */
export interface AuditFile {
  readonly label: string;
  readonly text: string;
}

/** One finding (pattern id + position — never the matched text). */
export interface AuditFinding {
  readonly label: string;
  readonly patternId: string;
  readonly line: number;
  readonly column: number;
}

/**
 * The precise source-scan corpus (the merged shared shapes + refined
 * lane shapes). Everything here matches REAL credential values; none
 * of it matches the lane's own signing code or identifiers.
 */
export const SOURCE_SCAN_PATTERNS = [
  { id: 'github-pat-classic', pattern: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { id: 'github-pat-fine-grained', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: 'github-oauth-app-secret', pattern: /\bgh[sou]_[A-Za-z0-9]{20,}\b/g },
  { id: 'slack-bot-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'private-key-block', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: 'postgres-url-with-credentials', pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+\b/g },
  { id: 'redis-url-with-credentials', pattern: /\brediss?:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+\b/g },
  { id: 'url-with-basic-auth', pattern: /\bhttps:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+\b/g },
  { id: 'generic-secret-assignment', pattern: /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIALS?)[A-Z0-9_]*\s*[:=]\s*['"]?[A-Za-z0-9+/_-]{20,}['"]?/g },
  { id: 'openai-style-api-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'neon-api-key', pattern: /\bnapi_[A-Za-z0-9]{20,}\b/g },
  { id: 'vercel-access-token', pattern: /\bvcp_[A-Za-z0-9]{20,}\b/g },
  { id: 'cf-api-token', pattern: /\bcfat_[A-Za-z0-9]{20,}\b/g },
  // Refined for source scanning (the redaction catch-all shapes are for
  // evidence, not source — see the module doc):
  { id: 'r2-secret-access-key', pattern: /\b[a-f0-9]{64}\b/g },
  { id: 'upstash-rest-token', pattern: /\b[A-Za-z0-9+/]{60,}={0,2}\b/g },
  { id: 'aws4-authorization', pattern: /\bAWS4-HMAC-SHA256 Credential=[A-Za-z0-9]{16,}\/\d{8}\/[a-z0-9-]+\/s3\/aws4_request/g },
] as const;

/** The combined lane corpus (persistence + deployment pattern ids — the REDACTION authority for evidence). */
export const LANE_AUDIT_PATTERNS = [
  ...PERSISTENCE_REDACTION_PATTERNS.map((entry) => ({ id: entry.id, pattern: entry.pattern })),
  ...DEPLOYMENT_REDACTION_PATTERNS.map((entry) => ({ id: entry.id, pattern: entry.pattern })),
];

/** Scan one text with the precise source-scan corpus; findings carry ids + positions only. */
export function scanTextWithLaneCorpora(label: string, text: string): readonly AuditFinding[] {
  const findings: AuditFinding[] = [];
  const lines = text.split('\n');
  const seen = new Set<string>();
  for (const pattern of SOURCE_SCAN_PATTERNS) {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]!;
      const regex = new RegExp(
        pattern.pattern.source,
        pattern.pattern.flags.includes('g') ? pattern.pattern.flags : `${pattern.pattern.flags}g`,
      );
      regex.lastIndex = 0;
      let match = regex.exec(line);
      while (match !== null) {
        const key = `${label}:${lineIndex + 1}:${match.index + 1}:${pattern.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({ label, patternId: pattern.id, line: lineIndex + 1, column: match.index + 1 });
        }
        if (regex.lastIndex === match.index) {
          regex.lastIndex += 1;
        }
        match = regex.exec(line);
      }
    }
  }
  return findings;
}

/** Scan every audited file; deterministic order by (label, line, column, patternId). */
export function auditFiles(files: readonly AuditFile[]): readonly AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const file of files) {
    findings.push(...scanTextWithLaneCorpora(file.label, file.text));
  }
  findings.sort(
    (a, b) => a.label.localeCompare(b.label) || a.line - b.line || a.column - b.column || a.patternId.localeCompare(b.patternId),
  );
  return findings;
}
