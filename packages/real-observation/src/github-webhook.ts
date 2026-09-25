/**
 * The GitHub webhook-shaped receiver (P17-C).
 *
 * Receives GitHub's webhook deliveries (push / pull_request), validates
 * the X-Hub-Signature-256 HMAC against the shared secret, normalizes the
 * payload into EXACTLY the same envelope shapes the REST polling source
 * produces (one contract, two delivery shapes) and ingests each through
 * the merged P7 replay-protected pipeline.
 *
 * Honesty notes (pinned by evidence):
 *  - this receiver is the INBOUND endpoint the deployment topology
 *    mounts (a Vercel function / the P17-A infra surface); it performs
 *    ZERO outbound network — it only normalizes + ingests what GitHub
 *    pushed;
 *  - signature validation is fail-closed: a missing or mismatched
 *    X-Hub-Signature-256 is a typed INVALID_SIGNATURE outcome, never an
 *    ingestion;
 *  - unsupported event types answer typed IGNORED_EVENT_TYPE (honest:
 *    nothing was projected, nothing was lost — GitHub delivered an event
 *    the plane does not map);
 *  - the node:http server adapter below is the package's single
 *    server-shaped boundary (imported only by hosts that bind it; the
 *    apps/* composition-root precedent for impure boundaries). It binds
 *    INBOUND sockets only; all outbound network in this package stays
 *    behind the injected FetchPort.
 *
 * node:crypto (HMAC — pure computation) is the only other node builtin.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { Clock } from '@sos-2/live-store';
import type { EventIngestionPipeline, IngestionOutcome } from '@sos-2/event-ingestion';
import { normalizeExternalEvent } from '@sos-2/event-ingestion';
import type { EventSourceDescription, ExternalEventEnvelope } from '@sos-2/event-ingestion';

/** The receiver's per-delivery typed outcome. */
export type WebhookReceipt =
  | { readonly kind: 'INGESTED'; readonly eventId: string; readonly outcome: IngestionOutcome }
  | { readonly kind: 'INVALID_SIGNATURE'; readonly reason: string }
  | { readonly kind: 'IGNORED_EVENT_TYPE'; readonly eventType: string | null }
  | { readonly kind: 'REJECTED'; readonly reason: string };

export interface GitHubWebhookReceiverDeps {
  /** The webhook secret VALUE (injected at the process boundary from the env name — never read here). */
  readonly secret: string;
  /** The env NAME the secret came from (documentation + transcripts; never the value). */
  readonly secretEnvName: string;
  readonly pipeline: EventIngestionPipeline;
  readonly clock: Clock;
  /** The source description stamped onto every webhook-shaped event (default: the receiver's own). */
  readonly sourceDescription?: EventSourceDescription;
}

export const GITHUB_WEBHOOK_SOURCE_ID = 'github:webhook';

/** A delivery normalized to the plane's payload contract (before the occurredAt stamp). */
export interface NormalizedWebhookDelivery {
  readonly externalId: string;
  readonly kind: 'github.push' | 'github.pull_request';
  readonly payload: Record<string, unknown>;
}

/** Compute the expected X-Hub-Signature-256 for a raw body + secret (pure). */
export function expectedSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

/** Constant-time signature comparison (pure; fail-closed on length mismatch). */
export function signatureMatches(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/** Normalize one validated GitHub webhook delivery (pure; unmapped/unsupported types -> null). */
export function normalizeWebhookDelivery(input: { deliveryId: string; eventType: string; payload: unknown }): NormalizedWebhookDelivery | null {
  if (typeof input.payload !== 'object' || input.payload === null) {
    return null;
  }
  const payload = input.payload as Record<string, unknown>;
  if (input.eventType === 'push') {
    const ref = typeof payload['ref'] === 'string' ? payload['ref'] : null;
    const before = typeof payload['before'] === 'string' ? payload['before'] : null;
    const after = typeof payload['after'] === 'string' ? payload['after'] : null;
    if (ref === null || before === null || after === null) {
      return null;
    }
    return { externalId: input.deliveryId, kind: 'github.push', payload: { ref, before, after } };
  }
  if (input.eventType === 'pull_request') {
    const action = typeof payload['action'] === 'string' ? payload['action'] : null;
    const number = typeof payload['number'] === 'number' ? payload['number'] : null;
    const pullRequest = typeof payload['pull_request'] === 'object' && payload['pull_request'] !== null ? (payload['pull_request'] as Record<string, unknown>) : null;
    const head = pullRequest !== null && typeof (pullRequest['head'] as Record<string, unknown> | undefined)?.['sha'] === 'string' ? ((pullRequest['head'] as Record<string, unknown>)['sha'] as string) : null;
    const base = pullRequest !== null && typeof (pullRequest['base'] as Record<string, unknown> | undefined)?.['ref'] === 'string' ? ((pullRequest['base'] as Record<string, unknown>)['ref'] as string) : null;
    if (action === null || number === null || head === null || base === null) {
      return null;
    }
    if (action !== 'opened' && action !== 'closed' && action !== 'reopened') {
      return null;
    }
    return { externalId: input.deliveryId, kind: 'github.pull_request', payload: { action, number, head, base } };
  }
  return null;
}

/**
 * The receiver: one validated GitHub delivery -> typed receipts through
 * the merged pipeline. occurredAt is stamped by the injected clock at
 * receipt (the projection folds use it as the observation instant; the
 * source revision itself is the payload's before/after shas, carried
 * verbatim).
 */
export class GitHubWebhookReceiver {
  private readonly secret: string;
  private readonly secretEnvName: string;
  private readonly pipeline: EventIngestionPipeline;
  private readonly clock: Clock;
  private readonly description: EventSourceDescription;

  constructor(deps: GitHubWebhookReceiverDeps) {
    this.secret = deps.secret;
    this.secretEnvName = deps.secretEnvName;
    this.pipeline = deps.pipeline;
    this.clock = deps.clock;
    this.description =
      deps.sourceDescription ?? {
        source: GITHUB_WEBHOOK_SOURCE_ID,
        family: 'github',
        connection: 'not-yet-connected',
        description: `real GitHub webhook receiver (secret via env ${this.secretEnvName}); inbound only — zero outbound network`,
      };
  }

  describe(): EventSourceDescription {
    return this.description;
  }

  /** Handle one GitHub delivery (method/headers/body as received). */
  async handleDelivery(input: { method: string; headers: Record<string, string>; body: string }): Promise<readonly WebhookReceipt[]> {
    if (input.method !== 'POST') {
      return [{ kind: 'REJECTED', reason: `webhook deliveries are POST; received ${input.method}` }];
    }
    const signature = input.headers['x-hub-signature-256'] ?? null;
    if (signature === null) {
      return [{ kind: 'INVALID_SIGNATURE', reason: 'missing X-Hub-Signature-256 header (fail-closed)' }];
    }
    const expected = expectedSignature(this.secret, input.body);
    if (!signatureMatches(expected, signature)) {
      return [{ kind: 'INVALID_SIGNATURE', reason: 'X-Hub-Signature-256 does not match the HMAC-SHA256 of the delivered body (fail-closed)' }];
    }
    const deliveryId = input.headers['x-github-delivery'] ?? null;
    const eventType = input.headers['x-github-event'] ?? null;
    if (deliveryId === null) {
      return [{ kind: 'REJECTED', reason: 'missing X-GitHub-Delivery header — no durable replay-protection id' }];
    }
    if (eventType === null) {
      return [{ kind: 'REJECTED', reason: 'missing X-GitHub-Event header' }];
    }
    let payload: unknown;
    try {
      payload = JSON.parse(input.body) as unknown;
    } catch {
      return [{ kind: 'REJECTED', reason: 'webhook body is not valid JSON' }];
    }
    const normalized = normalizeWebhookDelivery({ deliveryId, eventType, payload });
    if (normalized === null) {
      return [{ kind: 'IGNORED_EVENT_TYPE', eventType }];
    }
    const occurredAt = new Date(this.clock.nowEpochMs()).toISOString();
    const envelope: ExternalEventEnvelope = {
      externalId: normalized.externalId,
      kind: normalized.kind,
      occurredAt,
      payload: normalized.payload,
      provenance: [`github-webhook:delivery:${deliveryId}`],
    };
    const input_ = normalizeExternalEvent(this.description, envelope);
    const outcome = await this.pipeline.ingest(input_);
    return [{ kind: 'INGESTED', eventId: input_.id, outcome }];
  }
}

/**
 * The node:http bind adapter — the process-boundary server hosts mount to
 * expose the receiver (inbound only). Resolves with the actual bound port
 * and the stop function.
 */
export function startWebhookServer(options: {
  readonly receiver: GitHubWebhookReceiver;
  readonly port: number;
  readonly path?: string;
  readonly hostname?: string;
}): Promise<{ readonly stop: () => void; readonly port: number }> {
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        headers[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
      }
      const receipts = await options.receiver.handleDelivery({ method: request.method ?? 'GET', headers, body });
      const ok = receipts.every((receipt) => receipt.kind !== 'REJECTED' && receipt.kind !== 'INVALID_SIGNATURE');
      const responsePayload = JSON.stringify({ receipts: receipts.map((receipt) => receipt.kind) });
      response.writeHead(ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' });
      response.end(responsePayload);
    })();
  });
  return new Promise((resolve) => {
    server.listen(options.port, options.hostname ?? '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      resolve({
        stop: () => {
          server.close();
        },
        port,
      });
    });
  });
}
