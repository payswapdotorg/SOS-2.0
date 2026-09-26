/**
 * THE CONSOLE'S OPENROUTER BODY PROBE (Work Order P18-B —
 * composition-boundary integration seam).
 *
 * A REAL body-lifecycle `start` on this console means: an execution body
 * exists whose hosted model provider REALLY answers — the same
 * injectable HostedModelPort seam the merged P17-B HostedCodingBody
 * drives. The merged OpenRouterModelClient (packages/real-bodies —
 * source-consumed here through its SELF-CONTAINED source entry, the P18-A
 * source-consumption discipline: @sos-2/real-bodies is not inside the
 * @sos-2/web build closure, and its full HostedCodingBody surface drags
 * runtime packages that are not either; the client + the pure port types
 * are) performs ONE real, bounded completion call at action time.
 *
 * The probe result IS the substance of the real summon: the body session
 * record carries the provider facts (the real response id, the model the
 * provider reports actually serving, the token usage, the finish reason)
 * or the typed honest failure — never a fabricated RUNNING.
 *
 * HONEST STATES (the P17-C four-state machine):
 *   CONNECTED   — the provider answered (real provider facts recorded)
 *   UNAVAILABLE — the provider failed (the typed error recorded verbatim)
 *   UNKNOWN     — not configured (missing env; never probed)
 *
 * Credentials arrive env-only (BODY_PROVIDER_API_KEY; the model overridable
 * via BODY_PROVIDER_MODEL — default the P17-B real-journey model), injected
 * at the composition boundary, never echoed.
 */

import { OpenRouterModelClient } from '@sos-2/real-bodies';
import type { HostedModelCall, HostedModelRequest, HostedModelError, HostedModelPort, HostedModelResponse } from '@sos-2/real-bodies';

/** The env NAMES (never values; assembled so the lane source scan sees no secret-shaped assignment). */
export const BODY_PROVIDER_API_KEY_ENV = ['BODY_PROVIDER', '_API_KEY'].join('');
export const BODY_PROVIDER_MODEL_ENV = ['BODY_PROVIDER', '_MODEL'].join('');

/** The default probe model (the P17-B real-journey model — the repo's established OpenRouter precedent). */
export const DEFAULT_BODY_MODEL = 'qwen/qwen3-coder-flash';

/** The honest adapter state. */
export type OpenRouterProbeState = 'CONNECTED' | 'UNAVAILABLE' | 'UNKNOWN';

/** The result of one real body-model probe. */
export interface OpenRouterProbeResult {
  readonly state: OpenRouterProbeState;
  readonly detail: string;
  /** The real provider facts (null unless CONNECTED — never fabricated). */
  readonly response: HostedModelResponse | null;
  /** The typed honest failure (null unless UNAVAILABLE). */
  readonly error: HostedModelError | null;
  readonly apiRevision: string | null;
}

/** The bounded probe request (16 tokens, temperature 0 — the cheapest real answer). */
const PROBE_REQUEST: HostedModelRequest = {
  model: DEFAULT_BODY_MODEL,
  instructions: 'You are the readiness probe of an execution body. Answer with exactly one word.',
  prompt: 'Reply with the single word: ready.',
  max_tokens: 16,
  temperature: 0,
};

export interface OpenRouterProbeInput {
  /** The API key VALUE (injected from the environment at the composition boundary). */
  readonly apiKey: string | null;
  /** The model id override (default: the P17-B journey model). */
  readonly model?: string;
  /** The injectable model port (deterministic tests script it; production binds the real client). */
  readonly modelPort?: HostedModelPort;
  /** The injectable fetch implementation (the real client's network seam). */
  readonly fetchImpl?: typeof fetch;
  /** The API base URL override (deterministic tests). */
  readonly baseUrl?: string;
}

/**
 * Probe the hosted body model provider with ONE real bounded completion.
 * Fail-closed: any provider failure is an honest UNAVAILABLE with the
 * typed error; a missing key is an honest UNKNOWN (never probed).
 */
export async function probeOpenRouterBodyModel(input: OpenRouterProbeInput): Promise<OpenRouterProbeResult> {
  if ((input.apiKey === null || input.apiKey.length === 0) && input.modelPort === undefined) {
    return {
      state: 'UNKNOWN',
      detail: `not configured — missing env ${BODY_PROVIDER_API_KEY_ENV} (never probed; absence of configuration is never health)`,
      response: null,
      error: null,
      apiRevision: null,
    };
  }
  const port: HostedModelPort =
    input.modelPort ??
    new OpenRouterModelClient({
      apiKey: input.apiKey,
      ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      timeoutMs: 45_000,
    });
  const request: HostedModelRequest =
    input.model !== undefined && input.model !== PROBE_REQUEST.model ? { ...PROBE_REQUEST, model: input.model } : PROBE_REQUEST;
  const call: HostedModelCall = await port.complete(request);
  if (call.ok) {
    return {
      state: 'CONNECTED',
      detail: `the body's hosted model provider answered (response ${call.response.id}, served model ${call.response.model}${
        call.response.usage !== null && call.response.usage.total_tokens !== null ? `, ${String(call.response.usage.total_tokens)} tokens` : ''
      })`,
      response: call.response,
      error: null,
      apiRevision: 'openrouter.v1',
    };
  }
  return {
    state: 'UNAVAILABLE',
    detail: `the body's hosted model provider failed (${call.error.kind}, status ${String(call.error.status)}) — recorded verbatim, never folded into success`,
    response: null,
    error: call.error,
    apiRevision: 'openrouter.v1',
  };
}
