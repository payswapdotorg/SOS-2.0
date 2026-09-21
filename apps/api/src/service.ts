/**
 * The node:http binding of the live API (Work Order P2).
 *
 * A plain Node process — no vendor framework (the repo-standard ESM + tsc
 * build). Adapts node:http requests onto the transport-agnostic
 * ApiRequest/ApiResponse contract, so the SAME handler can be hosted in a
 * Vercel function or external worker boundary later WITHOUT contract
 * change. Request handling performs ONLY bounded store operations — no
 * long-running work inside the request lifetime.
 *
 * Run: pnpm --filter @sos-2/api dev   (default port 8788, override with
 * API_PORT — the boundary precedent of apps/console's CONSOLE_PORT).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ApiRequest, ApiResponse } from '@sos-2/api-contracts';
import type { Clock, LiveStore } from '@sos-2/live-store';
import { createInMemoryLiveStore } from '@sos-2/live-store';
import { MAX_BODY_BYTES, createApiHandler } from './handler.js';
import { SystemClock } from './system-clock.js';

export const DEFAULT_PORT = 8788;

export interface ApiServiceOptions {
  /** Port to bind (default 8788, or the API_PORT env var at the entry). */
  port?: number;
  /** The live store (default: the deterministic in-memory reference backend). */
  store?: LiveStore;
  /** The injected clock (default: the boundary SystemClock). */
  clock?: Clock;
  /** Bind and listen (default true; false for handler-only usage). */
  listen?: boolean;
}

export interface ApiService {
  /** The requested port (the actual bound port resolves from `ready`). */
  port: number;
  /** Resolves with the actual bound port once the server listens. */
  ready: Promise<number>;
  /** The transport-agnostic handler (hostable on any boundary). */
  handler: (request: ApiRequest) => Promise<ApiResponse>;
  close: () => Promise<void>;
}

function readBody(request: IncomingMessage): Promise<{ ok: true; body: Uint8Array | null } | { ok: false; message: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_BODY_BYTES) {
        request.destroy();
        resolve({ ok: false, message: `request body exceeds ${MAX_BODY_BYTES} bytes` });
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve({ ok: true, body: chunks.length === 0 ? null : new Uint8Array(Buffer.concat(chunks)) }));
    request.on('error', reject);
  });
}

function queryOf(url: URL): Record<string, string | string[] | undefined> {
  const query: Record<string, string | string[] | undefined> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0] : values;
  }
  return query;
}

function headersOf(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') {
      headers[name.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      headers[name.toLowerCase()] = value.join(', ');
    }
  }
  return headers;
}

/** Start the live API service (deterministic reference backend by default). */
export function createApiService(options?: ApiServiceOptions): ApiService {
  // One clock drives both the health report and the reference store's
  // timestamps: the boundary composes real time by default; tests inject a
  // ManualClock for both.
  const clock = options?.clock ?? new SystemClock();
  const store = options?.store ?? createInMemoryLiveStore({ clock });
  const port = options?.port ?? DEFAULT_PORT;
  const handler = createApiHandler({ store, clock });

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://api.local');
      const body = await readBody(request);
      if (!body.ok) {
        respond(response, {
          status: 400,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: {
            error: {
              code: 'INVALID',
              message: body.message,
            },
          },
        });
        return;
      }
      const apiRequest: ApiRequest = {
        method: request.method ?? 'GET',
        path: url.pathname,
        query: queryOf(url),
        headers: headersOf(request),
        body: body.body,
      };
      const result = await handler(apiRequest);
      respond(response, result);
    })().catch((cause: unknown) => {
      // Never an untyped 500: the boundary failure is a typed UNKNOWN.
      respond(response, {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: {
          error: {
            code: 'UNKNOWN',
            message: cause instanceof Error ? cause.message : String(cause),
          },
        },
      });
    });
  });

  function respond(response: ServerResponse, result: ApiResponse): void {
    response.writeHead(result.status, result.headers);
    response.end(result.body === null ? undefined : JSON.stringify(result.body));
  }

  const ready =
    options?.listen === false
      ? Promise.resolve(port)
      : new Promise<number>((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, () => {
            const address = server.address();
            resolve(typeof address === 'object' && address !== null ? address.port : port);
          });
        });

  return { port, ready, handler, close: () => new Promise<void>((resolve, reject) => {
    server.close((cause) => (cause === undefined ? resolve() : reject(cause)));
  }) };
}
