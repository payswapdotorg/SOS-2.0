/**
 * Secrets isolation (Work Order P14).
 *
 * SECRETS ARE REFERENCES, NEVER VALUES: the typed SecretReference record
 * carries credential NAMES (and an optional scope hint) — values live
 * only inside enforcement closures (the P8 sandbox discipline) and are
 * never present in this module, its records or its findings.
 *
 * PINNED: a body emitting a secret-shaped value into an artifact/log is
 * redacted or denied, with the redaction itself observed — the
 * observation boundary (P7) applies this contract to every artifact and
 * log emission; a REDACT or DENY decision always produces an audit
 * record (see ../audit/audit.ts).
 *
 * The secret-shape pattern corpus is ALIGNED with the merged P3
 * infra/deployment corpus (infra/deployment/src/secrets/policy.ts) — the
 * SAME twelve pattern ids and equivalent detection shapes. The alignment
 * is pinned by the acceptance suite, which imports the merged P3 module
 * directly and compares id sets and detection verdicts over fixtures.
 * Findings carry pattern ids and positions — NEVER the matched text.
 *
 * Determinism: pure text functions; no ambient anything.
 */

import { SecretLeakError } from '../errors.js';

/** A typed secret REFERENCE — a name, never a value. */
export interface SecretReference {
  /** The credential NAME (P8 sandbox policy discipline: names only). */
  readonly name: string;
  /** Where the credential applies, when declared (e.g. "github:push"). */
  readonly scopeHint: string | null;
}

/** One secret-shape pattern of the corpus (ids aligned with P3). */
export interface SecretShapePattern {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

/**
 * The secret-shape pattern corpus — the SAME twelve ids as the merged
 * P3 infra/deployment corpus, ordered deterministically. Patterns are
 * anchored to avoid matching ordinary prose.
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
    description: 'GitHub app/client secret (ghs_…/gho_…/ghu_…/ghr_…)',
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

/** The corpus pattern ids in declaration order (the alignment vocabulary). */
export const SECRET_PATTERN_IDS: readonly string[] = SECRET_SHAPE_PATTERNS.map((pattern) => pattern.id);

/** A finding. Deliberately carries NO matched text — ids and positions only. */
export interface SecretFinding {
  readonly patternId: string;
  readonly line: number;
  readonly column: number;
}

/** Where an emission is heading (the observation boundary surfaces). */
export type EmissionDestination = 'artifact' | 'log';

/** What the boundary does with a secret-shaped emission. */
export const ARTIFACT_SECRET_POLICIES = ['REDACT_AND_PASS', 'DENY'] as const;
export type ArtifactSecretPolicy = (typeof ARTIFACT_SECRET_POLICIES)[number];

/** One emission entering the observation-boundary gate. */
export interface EmissionInspectionInput {
  /** Emission identity (artifact id or log stream id). */
  readonly emissionId: string;
  /** The emitting task, when attributable. */
  readonly taskId: string | null;
  /** The emitting body, when attributable. */
  readonly bodyId: string | null;
  readonly destination: EmissionDestination;
  readonly content: string;
  readonly policy: ArtifactSecretPolicy;
}

/**
 * The typed inspection outcome:
 *   PASSED_CLEAN     no secret-shaped content — pass unchanged;
 *   PASSED_REDACTED  secret-shaped content replaced by pattern-id markers
 *                    (the redaction itself is observed — callers MUST
 *                    append the audit record carried in `audit`);
 *   DENIED_SECRET_LEAK  the emission is blocked (DENY policy) — nothing
 *                    passes, the denial is auditable, and the leaked
 *                    content is NEVER copied into the outcome.
 */
export type EmissionInspectionOutcome =
  | {
      readonly kind: 'PASSED_CLEAN';
      readonly emissionId: string;
      readonly content: string;
    }
  | {
      readonly kind: 'PASSED_REDACTED';
      readonly emissionId: string;
      readonly content: string;
      readonly redactions: readonly SecretFinding[];
      readonly audit: SecretRedactionAuditFact;
    }
  | {
      readonly kind: 'DENIED_SECRET_LEAK';
      readonly emissionId: string;
      readonly patternIds: readonly string[];
      readonly audit: SecretRedactionAuditFact;
    };

/** The observed fact that a redaction/denial happened (audit-bound). */
export interface SecretRedactionAuditFact {
  readonly surface: 'secret-isolation';
  readonly emissionId: string;
  readonly taskId: string | null;
  readonly bodyId: string | null;
  readonly destination: EmissionDestination;
  readonly matchedPatternIds: readonly string[];
}

/**
 * Scan text for secret shapes. Pure; findings are sorted deterministically
 * (line, column, patternId) and never carry matched text.
 */
export function scanForSecretShapes(text: string): readonly SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] as string;
    for (const pattern of SECRET_SHAPE_PATTERNS) {
      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags.includes('g') ? pattern.pattern.flags : `${pattern.pattern.flags}g`);
      let match = regex.exec(line);
      while (match !== null) {
        findings.push({
          patternId: pattern.id,
          line: lineIndex + 1,
          column: match.index + 1,
        });
        if (match.index === regex.lastIndex) regex.lastIndex += 1;
        match = regex.exec(line);
      }
    }
  }
  findings.sort((a, b) => a.line - b.line || a.column - b.column || (a.patternId < b.patternId ? -1 : a.patternId > b.patternId ? 1 : 0));
  return findings;
}

/** Replace every secret-shaped span with its pattern-id marker. */
export function redactSecretShapes(text: string): { redacted: string; redactions: readonly SecretFinding[] } {
  const lines = text.split('\n');
  const redactions: SecretFinding[] = [];
  const outLines: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const original = lines[lineIndex] as string;

    // Collect ALL secret-shaped spans from the ORIGINAL line, in corpus
    // order, so finding positions are consistent with scanForSecretShapes.
    interface Span {
      readonly start: number;
      readonly end: number;
      readonly patternId: string;
    }
    const spans: Span[] = [];
    for (const pattern of SECRET_SHAPE_PATTERNS) {
      const regex = new RegExp(pattern.pattern.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(original)) !== null) {
        spans.push({ start: match.index, end: match.index + match[0].length, patternId: pattern.id });
        if (match.index === regex.lastIndex) regex.lastIndex += 1;
      }
    }
    // Deterministic order: leftmost span first; ties by end, then pattern id.
    spans.sort((a, b) => a.start - b.start || a.end - b.end || (a.patternId < b.patternId ? -1 : 1));

    // Select non-overlapping spans. When two patterns match OVERLAPPING
    // text (a named assignment whose value is itself a provider token,
    // e.g. SLACK_TOKEN=xoxb-…), the SHORTER, more specific span wins:
    // the redaction still removes the whole matched value, the leftover
    // `NAME=` fragment is not secret-shaped, and the emitted marker
    // never re-triggers any pattern (pinned by the double-scan test).
    const selected: Span[] = [];
    for (const span of spans) {
      const last = selected.length > 0 ? selected[selected.length - 1] : undefined;
      if (last === undefined || span.start >= last.end) {
        selected.push(span);
        continue;
      }
      const lastLength = last.end - last.start;
      const spanLength = span.end - span.start;
      if (spanLength < lastLength) {
        selected[selected.length - 1] = span;
      }
    }

    let rebuilt = '';
    let cursor = 0;
    for (const span of selected) {
      rebuilt += `${original.slice(cursor, span.start)}[REDACTED:${span.patternId}]`;
      redactions.push({ patternId: span.patternId, line: lineIndex + 1, column: span.start + 1 });
      cursor = span.end;
    }
    rebuilt += original.slice(cursor);
    outLines.push(rebuilt);
  }

  redactions.sort((a, b) => a.line - b.line || a.column - b.column || (a.patternId < b.patternId ? -1 : a.patternId > b.patternId ? 1 : 0));
  return { redacted: outLines.join('\n'), redactions };
}

/**
 * The observation-boundary gate: inspect one emission (artifact or log)
 * for secret shapes. REDACT_AND_PASS replaces secret-shaped spans with
 * pattern-id markers; DENY blocks the emission entirely. Both outcomes
 * carry the audit fact — the redaction/denial is itself observed.
 */
export function inspectEmission(input: EmissionInspectionInput): EmissionInspectionOutcome {
  assertWellFormed(input);
  const findings = scanForSecretShapes(input.content);
  if (findings.length === 0) {
    return { kind: 'PASSED_CLEAN', emissionId: input.emissionId, content: input.content };
  }
  const matchedPatternIds = [...new Set(findings.map((finding) => finding.patternId))];
  const audit: SecretRedactionAuditFact = {
    surface: 'secret-isolation',
    emissionId: input.emissionId,
    taskId: input.taskId,
    bodyId: input.bodyId,
    destination: input.destination,
    matchedPatternIds,
  };
  if (input.policy === 'DENY') {
    return { kind: 'DENIED_SECRET_LEAK', emissionId: input.emissionId, patternIds: matchedPatternIds, audit };
  }
  const { redacted, redactions } = redactSecretShapes(input.content);
  return { kind: 'PASSED_REDACTED', emissionId: input.emissionId, content: redacted, redactions, audit };
}

/** The throwing seam: DENY-policy emission with secret shapes raises the typed error. */
export function assertNoSecretLeak(input: EmissionInspectionInput): void {
  const outcome = inspectEmission(input);
  if (outcome.kind === 'DENIED_SECRET_LEAK') {
    throw new SecretLeakError(
      `emission ${input.emissionId} (${input.destination}) carries secret-shaped content (patterns: ${outcome.patternIds.join(', ')}) — blocked by the secrets isolation policy`,
    );
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function assertWellFormed(input: EmissionInspectionInput): void {
  const problems: string[] = [];
  if (!isNonEmptyString(input.emissionId)) problems.push('emissionId');
  if (input.taskId !== null && !isNonEmptyString(input.taskId)) problems.push('taskId');
  if (input.bodyId !== null && !isNonEmptyString(input.bodyId)) problems.push('bodyId');
  if (input.destination !== 'artifact' && input.destination !== 'log') problems.push('destination');
  if (typeof input.content !== 'string') problems.push('content');
  if (!(ARTIFACT_SECRET_POLICIES as readonly string[]).includes(input.policy)) problems.push('policy');
  if (problems.length > 0) {
    throw new SecretLeakError(`malformed emission inspection input (fields: ${problems.join(', ')}) — malformed is never passed`);
  }
}
