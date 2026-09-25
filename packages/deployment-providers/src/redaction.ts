/**
 * The P17-A deployment-lane redaction corpus — the transcript/evidence
 * secret discipline (the P17-C/P17-A corpus pattern, continued for the
 * Vercel provider this lane talks to).
 *
 * SECRETS ARE REFERENCES, NEVER VALUES: every text that can reach a
 * transcript or evidence record passes through redactDeploymentSecrets
 * FIRST. Findings carry pattern ids ONLY — never the matched text.
 */

export interface RedactionFinding {
  readonly patternId: string;
  readonly count: number;
}

/** The deployment-lane corpus (merged shared shapes + the lane additions). */
export const DEPLOYMENT_REDACTION_PATTERNS = [
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
  { id: 'vercel-access-token', pattern: /\bvcp_[A-Za-z0-9]{20,}\b/g },
  { id: 'bearer-token-value', pattern: /\bBearer\s+[A-Za-z0-9+/=_-]{20,}\b/g },
] as const;

const REDACTED = '[REDACTED]';

/** Redact every secret-shaped value in the text; returns the redacted text + pattern-id counts (never the matched text). */
export function redactDeploymentSecrets(text: string): { redacted: string; findings: readonly RedactionFinding[] } {
  let working = text;
  const findings: RedactionFinding[] = [];
  for (const pattern of DEPLOYMENT_REDACTION_PATTERNS) {
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
    const matches = working.match(regex);
    if (matches !== null && matches.length > 0) {
      findings.push({ patternId: pattern.id, count: matches.length });
      working = working.replace(regex, REDACTED);
    }
  }
  return { redacted: working, findings };
}
