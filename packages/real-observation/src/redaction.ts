/**
 * The P17-C redaction corpus — the transcript/evidence secret discipline.
 *
 * SECRETS ARE REFERENCES, NEVER VALUES (the merged @sos-2/security
 * discipline + the §3 credential rule): every text that can reach a
 * transcript or evidence record passes through redactObservationSecrets
 * FIRST. Pattern ids are ALIGNED with the merged
 * @sos-2/security SECRET_SHAPE_PATTERNS corpus (same ids for the twelve
 * shared shapes; pinned by the tests/real-observation alignment suite
 * which imports the merged corpus source through tsconfig paths — the
 * tests/accessibility precedent, because the merged security package is
 * a zero-build source-consumed package and is not importable as a
 * compiled dependency) plus two P17-C lane additions for the providers
 * this package actually talks to:
 *
 *   vercel-access-token  vcp_… (the Vercel deployments API token)
 *   bearer-token-value   any `Bearer <long token>` value (the Upstash
 *                        REST token is an unprefixed base64 blob — the
 *                        Bearer shape is the honest catch for it)
 *
 * Findings carry pattern ids ONLY — never the matched text.
 */

export interface RedactionFinding {
  readonly patternId: string;
  readonly count: number;
}

/** The P17-C lane additions beyond the merged twelve-pattern corpus. */
export const LANE_ADDITION_PATTERNS = [
  { id: 'vercel-access-token', description: 'Vercel access token (vcp_…)', pattern: /\bvcp_[A-Za-z0-9]{20,}\b/g },
  { id: 'bearer-token-value', description: 'an Authorization Bearer token value', pattern: /\bBearer\s+[A-Za-z0-9+/=_-]{20,}\b/g },
] as const;

/** The merged corpus shapes this lane carries verbatim (ids aligned; pinned by the alignment test). */
export const OBSERVATION_REDACTION_PATTERNS = [
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
  ...LANE_ADDITION_PATTERNS.map((entry) => ({ id: entry.id, pattern: entry.pattern })),
] as const;

const REDACTED = '[REDACTED]';

/** Redact every secret-shaped value in the text; returns the redacted text + pattern-id counts (never the matched text). */
export function redactObservationSecrets(text: string): { redacted: string; findings: readonly RedactionFinding[] } {
  let working = text;
  const findings: RedactionFinding[] = [];
  for (const pattern of OBSERVATION_REDACTION_PATTERNS) {
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
    const matches = working.match(regex);
    if (matches !== null && matches.length > 0) {
      findings.push({ patternId: pattern.id, count: matches.length });
      working = working.replace(regex, REDACTED);
    }
  }
  return { redacted: working, findings };
}
