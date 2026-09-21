/**
 * Secret policy (Work Order P3): detection, redaction, presence validation.
 *
 * Rules encoded here:
 *
 *   - secret-shaped values must not appear in files/records where they
 *     have no business being (scanFilesForSecrets is the CI-wired form);
 *   - required secrets per environment must be PRESENT — validated
 *     WITHOUT ever printing them (names only, always);
 *   - redaction: any serialization path that could carry a secret value
 *     must go through redact() — matched material is replaced by a marker
 *     that carries the pattern id, never any portion of the value.
 *
 * Detection is deterministic: pure patterns, no entropy randomness, no
 * network, no clock. Findings carry labels/pattern ids/positions — never
 * the matched text.
 */

import { SecretPolicyError } from '../core/types.ts';
import { isSecretVariableName, requiredVariablesFor } from '../environment/schema.ts';
import type { EnvironmentTier, RawEnvironmentSource } from '../core/types.ts';

/** One secret-shape pattern of the policy. */
export interface SecretShapePattern {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

/**
 * The secret-shape pattern corpus. Ordered (deterministic reporting).
 * Patterns are anchored to avoid matching ordinary prose.
 */
export const SECRET_SHAPE_PATTERNS: readonly SecretShapePattern[] = [
  {
    id: 'github-pat-classic',
    description: 'classic GitHub personal access token (ghp_…)',
    pattern: /\bghp_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: 'github-pat-fine-grained',
    description: 'fine-grained GitHub token (github_pat_…)',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    id: 'github-oauth-app-secret',
    description: 'GitHub app/client secret (ghs_…/gho_…/ghu_…/ghs_…)',
    pattern: /\bgh[sou]_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: 'slack-bot-token',
    description: 'Slack bot token (xoxb-…)',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access key id (AKIA…)',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: 'private-key-block',
    description: 'private key block (BEGIN … PRIVATE KEY)',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    id: 'jwt',
    description: 'JSON web token (eyJ…, three segments)',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: 'postgres-url-with-credentials',
    description: 'postgres URL with embedded credentials',
    pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+\b/g,
  },
  {
    id: 'redis-url-with-credentials',
    description: 'redis/rediss URL with embedded credentials',
    pattern: /\brediss?:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+\b/g,
  },
  {
    id: 'url-with-basic-auth',
    description: 'https URL with embedded basic-auth credentials',
    pattern: /\bhttps:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+\b/g,
  },
  {
    id: 'generic-secret-assignment',
    description: 'generic assignment of a long secret-shaped value (SECRET/TOKEN/KEY/PASSWORD=…)',
    pattern: /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIALS?)[A-Z0-9_]*\s*[:=]\s*['"]?[A-Za-z0-9+/_-]{20,}['"]?/g,
  },
  {
    id: 'openai-style-api-key',
    description: 'provider API key (sk-…)',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
] as const;

/** A finding. Deliberately carries NO matched text — labels and positions only. */
export interface SecretFinding {
  readonly label: string;
  readonly patternId: string;
  readonly line: number;
  readonly column: number;
}

/** Scans one text (labelled) and returns findings in deterministic order. */
export function scanTextForSecrets(label: string, text: string): readonly SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split('\n');
  for (const pattern of SECRET_SHAPE_PATTERNS) {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] as string;
      pattern.pattern.lastIndex = 0;
      let match: RegExpExecArray | null = pattern.pattern.exec(line);
      while (match !== null) {
        findings.push({
          label,
          patternId: pattern.id,
          line: lineIndex + 1,
          column: match.index + 1,
        });
        match = pattern.pattern.exec(line);
      }
    }
  }
  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.patternId.localeCompare(b.patternId));
  return findings;
}

/**
 * Redacts secret-shaped material from a text. The replacement marker
 * carries the pattern id only — never any portion of the matched value.
 */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_SHAPE_PATTERNS) {
    redacted = redacted.replace(pattern.pattern, (matched) => {
      const id = pattern.id;
      const marker = `[REDACTED:${id}]`;
      return matched.length > 0 ? marker : matched;
    });
  }
  return redacted;
}

/**
 * Scans a set of named texts (files or records) and throws a typed
 * SecretPolicyError listing labels + pattern ids + positions when any
 * secret-shaped value is found where it must not appear. The matched
 * values are NEVER part of the message.
 */
export function assertNoSecretsInTexts(texts: Readonly<Record<string, string>>): void {
  const findings: SecretFinding[] = [];
  for (const [label, text] of Object.entries(texts)) {
    findings.push(...scanTextForSecrets(label, text));
  }
  if (findings.length > 0) {
    const summary = findings
      .map((f) => `${f.label}:${f.line}:${f.column} (${f.patternId})`)
      .sort()
      .join('; ');
    throw new SecretPolicyError(
      `secret-shaped values found where they must not appear (values suppressed; positions and pattern ids only): ${summary}`,
    );
  }
}

/**
 * Validates that all REQUIRED secrets for a tier are present in an
 * injected raw source — by NAME, without ever returning or echoing the
 * values. Absence fails closed; presence says nothing about the value.
 */
export function assertRequiredSecretsPresent(tier: EnvironmentTier, source: RawEnvironmentSource): void {
  const missing = requiredVariablesFor(tier)
    .filter((spec) => spec.secret && (source[spec.name] === undefined || source[spec.name] === ''))
    .map((spec) => spec.name);
  if (missing.length > 0) {
    throw new SecretPolicyError(
      `tier '${tier}' is missing required SECRET variables (names only; values are never read, echoed or logged here): ${missing.join(', ')}`,
    );
  }
}

/**
 * Produces a log-safe view of a raw source record: secret-classified
 * values (registry classification + conservative name-shape fallback) are
 * replaced by [REDACTED]; public values pass through.
 */
export function redactRawSource(source: RawEnvironmentSource): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    const isSecret = isSecretClassified(name);
    out[name] = isSecret ? '[REDACTED]' : redactSecrets(value);
  }
  return out;
}

/** Registry classification with the conservative name-shape fallback. */
export function isSecretClassified(name: string): boolean {
  return isSecretVariableName(name);
}
