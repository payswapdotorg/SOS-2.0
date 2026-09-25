/**
 * Connectivity transcripts — the real-evidence recorder for the P17-A
 * lane (the P17-C transcript discipline, continued). Every REAL HTTP
 * round-trip performed by a real-persistence adapter is recorded as a
 * transcript entry: the exact endpoint, method, redacted request
 * headers, response status, selected response headers, the response
 * body's content hash and a bounded, REDACTED snippet.
 *
 * SECRET DISCIPLINE (the §3 rule): secrets are references, never
 * values. Credential-bearing headers (authorization, x-amz-*, neon-*)
 * are replaced by references to the env NAME the credential came from
 * (e.g. 'env:UPSTASH_REDIS_REST_TOKEN'), and every body/snippet passes
 * through the lane redaction corpus so a credential that leaked into a
 * body is redacted BEFORE it can be persisted — the redaction itself is
 * recorded (pattern ids, never matched text). Transcripts are in-memory
 * runtime records consumed by the evidence writers
 * (infra/production-connectivity + tests/real-persistence); they never
 * auto-persist anywhere.
 */

import { contentHash } from '@sos-2/semantic-spine';
import { redactPersistenceSecrets } from './redaction.js';
import { responseText } from './http.js';
import type { HttpRequest, HttpResponse } from './http.js';

/** Maximum snippet length persisted per response (bounded evidence). */
export const PERSISTENCE_TRANSCRIPT_SNIPPET_MAX = 2_000;

/** Header names whose VALUES are always credential references, never values. */
const SECRET_HEADERS = [
  'authorization',
  'x-amz-security-token',
  'neon-connection-string',
  'neon-query-token',
] as const;

/** One redacted real round-trip record. */
export interface PersistenceTranscriptEntry {
  /** RFC3339 (injected clock). */
  readonly at: string;
  /** The provider performing the request ('neon' | 'upstash' | 'r2'). */
  readonly provider: string;
  readonly request: {
    readonly method: string;
    readonly url: string;
    /** Redacted request headers (credential headers -> env name references). */
    readonly headers: Readonly<Record<string, string>>;
  };
  readonly response: {
    readonly status: number | null;
    /** Selected response headers (api revision, request ids, rate limits). */
    readonly headers: Readonly<Record<string, string>>;
    /** SHA-256-class content hash of the RAW body (evidence binding). */
    readonly bodyHash: string | null;
    readonly bodyLength: number | null;
    /** Bounded redacted snippet (never secret values). */
    readonly snippet: string | null;
  };
  /** Pattern ids that were redacted from this round-trip (ids only). */
  readonly redactedPatternIds: readonly string[];
}

export interface PersistenceTranscriptRecorderDeps {
  /** (provider, headerName) -> env NAME reference for credential headers, or null to drop the value. */
  readonly credentialReference?: (provider: string) => string | null;
  /** The response headers retained as evidence (lowercase). */
  readonly retainedResponseHeaders?: readonly string[];
}

const DEFAULT_RETAINED = [
  'content-type',
  'content-length',
  'x-request-id',
  'x-ratelimit-limit-requests',
  'x-ratelimit-limit-duration',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests',
  'x-vercel-id',
  'x-amz-request-id',
  'x-amz-id-2',
  'cf-ray',
  'server',
  'date',
] as const;

export class PersistenceTranscriptRecorder {
  private readonly entries: PersistenceTranscriptEntry[] = [];
  private readonly credentialReference: (provider: string) => string | null;
  private readonly retained: readonly string[];

  constructor(deps: PersistenceTranscriptRecorderDeps = {}) {
    this.credentialReference = deps.credentialReference ?? (() => null);
    this.retained = deps.retainedResponseHeaders ?? DEFAULT_RETAINED;
  }

  /** Record one real round-trip (redacted). Never throws. */
  record(input: {
    at: string;
    provider: string;
    request: HttpRequest;
    response: HttpResponse | null;
    transportError: string | null;
  }): void {
    const requestHeaders: Record<string, string> = {};
    const redactedIds = new Set<string>();
    for (const [key, value] of Object.entries(input.request.headers)) {
      const lower = key.toLowerCase();
      if (SECRET_HEADERS.includes(lower as (typeof SECRET_HEADERS)[number])) {
        // Credential-bearing headers (the SigV4 Authorization header, the
        // Neon connection-string header, bearer tokens) are replaced by an
        // env-name reference — the whole value is one secret unit.
        const reference = this.credentialReference(input.provider);
        requestHeaders[key] = reference === null ? '[REDACTED:secret-reference-dropped]' : `[REDACTED:env-name:${reference}]`;
        redactedIds.add('authorization-header');
        continue;
      }
      const redaction = redactPersistenceSecrets(value);
      requestHeaders[key] = redaction.redacted;
      for (const finding of redaction.findings) {
        redactedIds.add(finding.patternId);
      }
    }
    if (input.response === null) {
      this.entries.push({
        at: input.at,
        provider: input.provider,
        request: { method: input.request.method, url: input.request.url, headers: requestHeaders },
        response: {
          status: null,
          headers: { 'transport-error': input.transportError ?? 'unspecified transport failure' },
          bodyHash: null,
          bodyLength: null,
          snippet: null,
        },
        redactedPatternIds: [...redactedIds].sort(),
      });
      return;
    }
    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.response.headers)) {
      if (this.retained.includes(key.toLowerCase())) {
        responseHeaders[key.toLowerCase()] = value;
      }
    }
    const bodyText = responseText(input.response);
    const snippetRedaction = redactPersistenceSecrets(bodyText.slice(0, PERSISTENCE_TRANSCRIPT_SNIPPET_MAX));
    for (const finding of snippetRedaction.findings) {
      redactedIds.add(finding.patternId);
    }
    this.entries.push({
      at: input.at,
      provider: input.provider,
      request: { method: input.request.method, url: input.request.url, headers: requestHeaders },
      response: {
        status: input.response.status,
        headers: responseHeaders,
        bodyHash: contentHash(bodyText),
        bodyLength: input.response.bytes.byteLength,
        snippet: snippetRedaction.redacted,
      },
      redactedPatternIds: [...redactedIds].sort(),
    });
  }

  /** All entries (defensive copy), chronological. */
  all(): readonly PersistenceTranscriptEntry[] {
    return [...this.entries];
  }

  /** Entries of one provider, chronological. */
  byProvider(provider: string): readonly PersistenceTranscriptEntry[] {
    return this.entries.filter((entry) => entry.provider === provider);
  }

  /** Serializable evidence form (canonical-JSON safe). */
  toJSON(): string {
    return JSON.stringify(this.entries.map((entry) => ({ ...entry, redactedPatternIds: [...entry.redactedPatternIds] })));
  }
}
