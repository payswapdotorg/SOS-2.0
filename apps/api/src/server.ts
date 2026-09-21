/**
 * The API HTTP server (Work Order P2) — a plain node:http wrapper around
 * the framework-independent router. Every request is ONE bounded store
 * operation (no long-running work inside request lifetimes); JSON bodies
 * are parsed once and malformed bodies answer a typed INVALID envelope.
 *
 * Run: pnpm --filter @sos-2/api start   (default port 8686, override with
 * API_PORT — read only in the CLI composition root main.ts; tests inject
 * port 0 + deterministic clocks).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createApiRouter, type ApiRouter } from './router.js';
import type { ApiResponse } from './router.js';
import type { Clock, LiveStore } from '@sos-2/live-store';

export const DEFAULT_API_PORT = 8686;

export interface ApiServerOptions {
  /** Port to listen on (0 = ephemeral; injected in tests). */
  port?: number;
  /** The live store (injected — the reference implementation for now; provider adapters attach later without contract change). */
  store: LiveStore;
  /** Injected clock (deterministic in tests; the CLI root supplies the real clock). */
  clock: Clock;
  /** Whether to start listening immediately (default true). */
  listen?: boolean;
}

export interface ApiServer {
  /** The requested port (the actual bound port resolves from `ready`). */
  port: number;
  /** Resolves with the actual bound port once the server listens. */
  ready: Promise<number>;
  close(): Promise<void>;
  /** The underlying router (framework-independent; reusable for hosting without contract change). */
  router: ApiRouter;
}

const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Sentinel: the body could not be read (the typed envelope was already answered). */
const READ_BODY_FAILED = Symbol('read-body-failed');

export function startApiServer(options: ApiServerOptions): ApiServer {
  const router = createApiRouter({ store: options.store, clock: options.clock });
  const port = options.port ?? DEFAULT_API_PORT;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void handle(request, response, router).catch((cause: unknown) => {
      writeJson(response, 500, {
        error: 'UNKNOWN',
        code: 'INTERNAL_ERROR',
        message: `unexpected internal error: ${cause instanceof Error ? cause.message : String(cause)}`,
        details: null,
      });
    });
  });

  const ready =
    options.listen === false
      ? Promise.resolve(port)
      : new Promise<number>((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, '127.0.0.1', () => {
            server.removeListener('error', reject);
            const address = server.address();
            resolve(typeof address === 'object' && address !== null ? address.port : port);
          });
        });

  return {
    port,
    ready,
    router,
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function handle(request: IncomingMessage, response: ServerResponse, router: ApiRouter): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://api.local');
  const method = (request.method ?? 'GET').toUpperCase();
  const hasBody = method === 'PUT' || method === 'POST';
  let body: unknown;
  if (hasBody) {
    body = await readJsonBody(request, response);
    if (body === READ_BODY_FAILED) {
      // readJsonBody already answered the typed INVALID envelope.
      return;
    }
  }
  const result: ApiResponse = await router.route({
    method,
    pathname: url.pathname,
    query: url.searchParams,
    body,
  });
  writeJson(response, result.status, result.body, result.headers);
}

async function readJsonBody(request: IncomingMessage, response: ServerResponse): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      writeJson(response, 413, {
        error: 'INVALID',
        code: 'BODY_TOO_LARGE',
        message: `request body exceeds ${MAX_BODY_BYTES} bytes`,
        details: null,
      });
      return READ_BODY_FAILED;
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    // An empty stream is a bodyless request — the ROUTER decides whether a
    // body is required (it owns the route contract); bodyless requests to
    // bodyless routes (e.g. POST /api/health) must still route.
    return undefined;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    writeJson(response, 400, {
      error: 'INVALID',
      code: 'BODY_NOT_JSON',
      message: 'the request body is not valid JSON',
      details: null,
    });
    return READ_BODY_FAILED;
  }
}

function writeJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}
