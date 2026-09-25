/**
 * Connectivity transcripts — the real-evidence recorder for the P17-A
 * deployment lane (the P17-C transcript discipline, continued). Every
 * REAL HTTP round-trip performed by the Vercel REST client is recorded
 * as a transcript entry: the exact endpoint, method, redacted request
 * headers (the Authorization header becomes the VERCEL_TOKEN env NAME
 * reference), response status, selected response headers, the response
 * body's content hash and a bounded, REDACTED snippet.
 */

import { contentHash } from '@sos-2/semantic-spine';
import { redactDeploymentSecrets } from './redaction.js';
import { responseText } from './http.js';
import type { HttpRequest, HttpResponse } from './http.js';

/** Maximum snippet length persisted per response (bounded evidence). */
export const DEPLOYMENT_TRANSCRIPT_SNIPPET_MAX = 2_000;

/** One redacted real round-trip record. */
export interface DeploymentTranscriptEntry {
  /** RFC3339 (injected clock). */
  readonly at: string;
  readonly request: {
    readonly method: string;
    readonly url: string;
    /** Redacted request headers (Authorization -> env name reference). */
    readonly headers: Readonly<Record<string, string>>;
  };
  readonly response: {
    readonly status: number | null;
    readonly headers: Readonly<Record<string, string>>;
    readonly bodyHash: string | null;
    readonly bodyLength: number | null;
    readonly snippet: string | null;
  };
  readonly redactedPatternIds: readonly string[];
}

export interface DeploymentTranscriptRecorderDeps {
  /** The env NAME reference for the Authorization header (e.g. VERCEL_TOKEN). */
  readonly credentialReference?: string | null;
  /** The response headers retained as evidence (lowercase). */
  readonly retainedResponseHeaders?: readonly string[];
}

const DEFAULT_RETAINED = [
  'content-type',
  'content-length',
  'x-vercel-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'server',
  'date',
] as const;

export class DeploymentTranscriptRecorder {
  private readonly entries: DeploymentTranscriptEntry[] = [];
  private readonly credentialReference: string | null;
  private readonly retained: readonly string[];

  constructor(deps: DeploymentTranscriptRecorderDeps = {}) {
    this.credentialReference = deps.credentialReference ?? null;
    this.retained = deps.retainedResponseHeaders ?? DEFAULT_RETAINED;
  }

  /** Record one real round-trip (redacted). Never throws. */
  record(input: { at: string; request: HttpRequest; response: HttpResponse | null; transportError: string | null }): void {
    const requestHeaders: Record<string, string> = {};
    const redactedIds = new Set<string>();
    for (const [key, value] of Object.entries(input.request.headers)) {
      if (key.toLowerCase() === 'authorization') {
        requestHeaders[key] =
          this.credentialReference === null
            ? '[REDACTED:secret-reference-dropped]'
            : `[REDACTED:env-name:${this.credentialReference}]`;
        redactedIds.add('authorization-header');
        continue;
      }
      const redaction = redactDeploymentSecrets(value);
      requestHeaders[key] = redaction.redacted;
      for (const finding of redaction.findings) {
        redactedIds.add(finding.patternId);
      }
    }
    if (input.response === null) {
      this.entries.push({
        at: input.at,
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
    const snippetRedaction = redactDeploymentSecrets(bodyText.slice(0, DEPLOYMENT_TRANSCRIPT_SNIPPET_MAX));
    for (const finding of snippetRedaction.findings) {
      redactedIds.add(finding.patternId);
    }
    this.entries.push({
      at: input.at,
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
  all(): readonly DeploymentTranscriptEntry[] {
    return [...this.entries];
  }

  /** Serializable evidence form (canonical-JSON safe). */
  toJSON(): string {
    return JSON.stringify(this.entries.map((entry) => ({ ...entry, redactedPatternIds: [...entry.redactedPatternIds] })));
  }
}
