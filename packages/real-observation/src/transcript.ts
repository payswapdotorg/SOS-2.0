/**
 * Connectivity transcripts — the real-evidence recorder for the P17-C
 * lane. Every REAL HTTP round-trip performed by a real-observation
 * adapter is recorded as a transcript entry: the exact endpoint, method,
 * redacted request headers, response status, the API revision header
 * and a bounded, REDACTED response snippet.
 *
 * SECRET DISCIPLINE (the §3 rule + @sos-2/security): secrets are
 * references, never values. The Authorization header is replaced by a
 * reference to the env NAME the token came from (e.g. 'env:PAYSWAP_GITHUB_TOKEN'),
 * and every body/snippet passes through the merged secret-shape corpus
 * (redactSecretShapes) so a token that leaked into a response body is
 * redacted BEFORE it can be persisted — the redaction itself is recorded
 * (pattern ids, never matched text). Transcripts are in-memory runtime
 * records consumed by the evidence writers (tests/real-observation);
 * they never auto-persist anywhere.
 */

import { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
import { redactObservationSecrets } from './redaction.js';
import type { HttpRequest, HttpResponse } from './http.js';

/** Maximum snippet length persisted per response (bounded evidence). */
export const TRANSCRIPT_SNIPPET_MAX = 2_000;

/** One redacted real round-trip record. */
export interface TranscriptEntry {
  /** RFC3339 (injected clock). */
  readonly at: string;
  /** The source id performing the request. */
  readonly source: string;
  readonly request: {
    readonly method: string;
    readonly url: string;
    /** Redacted request headers (Authorization -> env name reference). */
    readonly headers: Readonly<Record<string, string>>;
  };
  readonly response: {
    readonly status: number | null;
    /** Selected response headers (api revision, rate limit, request id). */
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

export interface TranscriptRecorderDeps {
  /** (source, headerName) -> env NAME reference for the Authorization header, or null to drop it. */
  readonly authorizationReference?: (source: string) => string | null;
  /** The response headers retained as evidence (lowercase). */
  readonly retainedResponseHeaders?: readonly string[];
}

const DEFAULT_RETAINED = [
  'x-github-media-type',
  'x-github-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-vercel-id',
  'content-type',
] as const;

export class TranscriptRecorder {
  private readonly entries: TranscriptEntry[] = [];
  private readonly authorizationReference: (source: string) => string | null;
  private readonly retained: readonly string[];

  constructor(deps: TranscriptRecorderDeps = {}) {
    this.authorizationReference = deps.authorizationReference ?? (() => null);
    this.retained = deps.retainedResponseHeaders ?? DEFAULT_RETAINED;
  }

  /** Record one real round-trip (redacted). Never throws. */
  record(input: { at: string; source: string; request: HttpRequest; response: HttpResponse | null; transportError: string | null }): void {
    const requestHeaders: Record<string, string> = {};
    const redactedIds = new Set<string>();
    for (const [key, value] of Object.entries(input.request.headers)) {
      if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'x-vercel-access-token') {
        const reference = this.authorizationReference(input.source);
        requestHeaders[key] = reference === null ? '[REDACTED:secret-reference-dropped]' : `[REDACTED:env-name:${reference}]`;
        redactedIds.add('authorization-header');
        continue;
      }
      const redaction = redactObservationSecrets(value);
      requestHeaders[key] = redaction.redacted;
      for (const finding of redaction.findings) {
        redactedIds.add(finding.patternId);
      }
    }
    if (input.response === null) {
      this.entries.push({
        at: input.at,
        source: input.source,
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
    const snippetRedaction = redactObservationSecrets(input.response.body.slice(0, TRANSCRIPT_SNIPPET_MAX));
    for (const finding of snippetRedaction.findings) {
      redactedIds.add(finding.patternId);
    }
    this.entries.push({
      at: input.at,
      source: input.source,
      request: { method: input.request.method, url: input.request.url, headers: requestHeaders },
      response: {
        status: input.response.status,
        headers: responseHeaders,
        bodyHash: contentHash(input.response.body),
        bodyLength: input.response.body.length,
        snippet: snippetRedaction.redacted,
      },
      redactedPatternIds: [...redactedIds].sort(),
    });
  }

  /** All entries (defensive copy), chronological. */
  all(): readonly TranscriptEntry[] {
    return [...this.entries];
  }

  /** Entries of one source, chronological. */
  bySource(source: string): readonly TranscriptEntry[] {
    return this.entries.filter((entry) => entry.source === source);
  }

  /** Serializable evidence form (canonical-JSON safe). */
  toJSON(): string {
    return canonicalSerialize(this.entries.map((entry) => ({ ...entry, redactedPatternIds: [...entry.redactedPatternIds] })));
  }
}
