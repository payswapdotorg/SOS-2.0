/**
 * The P17-A redaction corpus — the transcript/evidence secret discipline
 * (the P17-C lane corpus, continued for the persistence/deployment
 * providers this lane actually talks to).
 *
 * SECRETS ARE REFERENCES, NEVER VALUES (the §3 credential rule): every
 * text that can reach a transcript or evidence record passes through
 * redactPersistenceSecrets FIRST. Pattern ids are ALIGNED with the
 * merged corpora (infra/deployment SECRET_SHAPE_PATTERNS and the P17-C
 * observation corpus — same ids for the shared shapes; pinned by the
 * tests/real-persistence alignment suite) plus the P17-A lane additions
 * for the providers this package talks to:
 *
 *   neon-api-key          napi_… (the Neon management API key)
 *   upstash-rest-token    the unprefixed base64-style Upstash REST token
 *                         (a ~64-char base64 blob — caught by shape)
 *   r2-secret-access-key  the 64-hex R2 S3 secret access key shape
 *   vercel-access-token   vcp_… (the Vercel deployments API token)
 *   cf-api-token          cfat_… (the Cloudflare account API token)
 *   aws4-authorization    a full AWS SigV4 Authorization header value
 *   postgres-url-with-credentials — a postgres URL with embedded user:password
 *                         credentials (Neon pooled connection strings
 *                         included: they carry the branch password)
 *   bearer-token-value    any `Bearer <long token>` value (the Upstash
 *                         REST token is an unprefixed blob — the Bearer
 *                         shape is the honest catch for it)
 *
 * Findings carry pattern ids ONLY — never the matched text.
 */

export interface RedactionFinding {
  readonly patternId: string;
  readonly count: number;
}

/** The P17-A lane additions beyond the merged shared corpus (specific shapes BEFORE broad catch-alls, so the reported pattern id is the most specific one). */
export const LANE_ADDITION_PATTERNS = [
  { id: 'neon-api-key', description: 'Neon management API key (napi_…)', pattern: /\bnapi_[A-Za-z0-9]{20,}\b/g },
  { id: 'r2-secret-access-key', description: 'R2 S3 secret access key (64-hex)', pattern: /\b[a-f0-9]{64}\b/g },
  { id: 'vercel-access-token', description: 'Vercel access token (vcp_…)', pattern: /\bvcp_[A-Za-z0-9]{20,}\b/g },
  { id: 'cf-api-token', description: 'Cloudflare account API token (cfat_…)', pattern: /\bcfat_[A-Za-z0-9]{20,}\b/g },
  { id: 'aws4-authorization', description: 'a full AWS SigV4 Authorization header value', pattern: /\bAWS4-HMAC-SHA256 Credential=[^\s"]{20,}/g },
  { id: 'postgres-url-with-credentials', description: 'postgres URL with embedded credentials (Neon pooled strings included)', pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+\b/g },
  { id: 'bearer-token-value', description: 'an Authorization Bearer token value', pattern: /\bBearer\s+[A-Za-z0-9+/=_-]{20,}\b/g },
  { id: 'upstash-rest-token', description: 'Upstash REST token (unprefixed ~64-char base64 blob — the broad catch-all, deliberately LAST; the range starts at 48 so 40-hex GIT SHAS — public exact-revision identities the deployment records must carry — survive)', pattern: /\b[A-Za-z0-9+/]{43}=|\b[A-Za-z0-9+/]{48,64}\b/g },
] as const;

/** The merged corpus shapes this lane carries verbatim (ids aligned; pinned by the alignment test). */
export const PERSISTENCE_REDACTION_PATTERNS = [
  { id: 'github-pat-classic', pattern: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { id: 'github-pat-fine-grained', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: 'github-oauth-app-secret', pattern: /\bgh[sou]_[A-Za-z0-9]{20,}\b/g },
  { id: 'slack-bot-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'private-key-block', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: 'redis-url-with-credentials', pattern: /\brediss?:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+\b/g },
  { id: 'url-with-basic-auth', pattern: /\bhttps:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+\b/g },
  { id: 'generic-secret-assignment', pattern: /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIALS?)[A-Z0-9_]*\s*[:=]\s*['"]?[A-Za-z0-9+/_-]{20,}['"]?/g },
  { id: 'openai-style-api-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  ...LANE_ADDITION_PATTERNS.map((entry) => ({ id: entry.id, pattern: entry.pattern })),
] as const;

const REDACTED = '[REDACTED]';

/**
 * Redact every secret-shaped value in the text; returns the redacted
 * text + pattern-id counts (never the matched text).
 *
 * NOTE on the r2-secret-access-key shape: a bare 64-hex string is also a
 * legitimate content hash; the corpus accepts this conservative
 * over-redaction (a content hash redacted in a transcript costs nothing;
 * a secret leaked costs everything — fail closed).
 */
export function redactPersistenceSecrets(text: string): { redacted: string; findings: readonly RedactionFinding[] } {
  let working = text;
  const findings: RedactionFinding[] = [];
  for (const pattern of PERSISTENCE_REDACTION_PATTERNS) {
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
    const matches = working.match(regex);
    if (matches !== null && matches.length > 0) {
      findings.push({ patternId: pattern.id, count: matches.length });
      working = working.replace(regex, REDACTED);
    }
  }
  return { redacted: working, findings };
}
