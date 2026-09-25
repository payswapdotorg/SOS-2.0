/**
 * THE REAL OPENROUTER CLIENT (Work Order P17-B) — the HostedModelPort
 * realization over the REAL OpenRouter chat-completions API.
 *
 * This file is the package's DOCUMENTED NETWORK BOUNDARY (the one place
 * network happens — the same discipline @sos-2/real-github applies to
 * its fetch transport):
 *
 *   - the API key is INJECTED at the composition boundary (the caller
 *     resolves the environment; the client never reads ambient state);
 *   - the fetch implementation is injectable — the deterministic suites
 *     never attach the global fetch (they use the scripted model port
 *     instead); only the env-gated integration suite (RUN_REAL=1) does;
 *   - failures map to the typed honest error vocabulary (NETWORK /
 *     AUTH / RATE_LIMIT / PROVIDER / PARSE) — never a fabricated
 *     success, never a thrown crash;
 *   - the API key never appears in requests' audit records, errors, or
 *     evidence — env NAMES only.
 */

import type { HostedModelCall, HostedModelPort, HostedModelRequest, HostedModelResponse } from './model-port.js';

/** The real OpenRouter chat-completions endpoint. */
export const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** The env variable names this client understands (names only — never values). */
export const OPENROUTER_ENVIRONMENT_VARIABLES = {
  apiKey: 'OPENROUTER_API_KEY',
} as const;

/** Options for the real OpenRouter client. */
export interface OpenRouterModelClientOptions {
  /** The API key VALUE (injected at the composition boundary — never ambient). */
  readonly apiKey: string | null;
  /** The injectable fetch implementation (defaults to the global fetch — the documented network boundary). */
  readonly fetchImpl?: typeof fetch;
  /** The base URL (default: the real OpenRouter API). */
  readonly baseUrl?: string;
  /** Per-request timeout in milliseconds (default 120_000 — model generation can be slow). */
  readonly timeoutMs?: number;
  /** Optional attribution headers (OpenRouter recommends app attribution). */
  readonly referer?: string;
  readonly title?: string;
}

interface OpenRouterChoice {
  readonly message?: { readonly content?: unknown };
  readonly finish_reason?: unknown;
}

interface OpenRouterResponseBody {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly choices?: readonly OpenRouterChoice[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
  };
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** The REAL OpenRouter HostedModelPort. */
export class OpenRouterModelClient implements HostedModelPort {
  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly referer: string | undefined;
  private readonly title: string | undefined;

  constructor(options: OpenRouterModelClientOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('OpenRouterModelClient requires an options object');
    }
    if (options.apiKey !== null && (typeof options.apiKey !== 'string' || options.apiKey.length === 0)) {
      throw new Error('OpenRouterModelClient apiKey must be a non-empty string or null (fail closed)');
    }
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? OPENROUTER_CHAT_COMPLETIONS_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.referer = options.referer;
    this.title = options.title;
  }

  async complete(request: HostedModelRequest): Promise<HostedModelCall> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey !== null) {
      // The key is used here and ONLY here — never logged, never echoed.
      headers['authorization'] = `Bearer ${this.apiKey}`;
    }
    if (this.referer !== undefined) {
      headers['http-referer'] = this.referer;
    }
    if (this.title !== undefined) {
      headers['x-title'] = this.title;
    }
    const body: Record<string, unknown> = {
      model: request.model,
      messages: [
        { role: 'system', content: request.instructions },
        { role: 'user', content: request.prompt },
      ],
    };
    if (request.max_tokens !== null) {
      body['max_tokens'] = request.max_tokens;
    }
    if (request.temperature !== null) {
      body['temperature'] = request.temperature;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let status = 0;
    let text = '';
    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'network failure';
      return {
        ok: false,
        error: { status: 0, kind: 'NETWORK', message: `the model provider could not be reached: ${reason}` },
      };
    } finally {
      clearTimeout(timer);
    }
    if (status === 401 || status === 403) {
      return { ok: false, error: { status, kind: 'AUTH', message: `the model provider rejected the credential (HTTP ${status})` } };
    }
    if (status === 402 || status === 429) {
      return { ok: false, error: { status, kind: 'RATE_LIMIT', message: `the model provider limited the call (HTTP ${status} — quota or rate)` } };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, error: { status, kind: 'PROVIDER', message: `the model provider answered HTTP ${status}` } };
    }
    let parsed: OpenRouterResponseBody;
    try {
      parsed = JSON.parse(text) as OpenRouterResponseBody;
    } catch {
      return { ok: false, error: { status, kind: 'PARSE', message: 'the model provider response was not valid JSON' } };
    }
    const choice = parsed.choices?.[0];
    const content = choice?.message?.content;
    const id = parsed.id;
    const model = parsed.model;
    if (typeof content !== 'string' || typeof id !== 'string' || typeof model !== 'string') {
      return { ok: false, error: { status, kind: 'PARSE', message: 'the model provider response lacked the expected shape (id/model/choices[0].message.content)' } };
    }
    const usage = parsed.usage;
    const response: HostedModelResponse = {
      id,
      model,
      content,
      finish_reason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
      usage:
        usage === undefined
          ? null
          : {
              prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
              completion_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
              total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
            },
    };
    return { ok: true, response };
  }
}

/** Construct the real OpenRouter model client. */
export function createOpenRouterModelClient(options: OpenRouterModelClientOptions): OpenRouterModelClient {
  return new OpenRouterModelClient(options);
}
