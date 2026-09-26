/**
 * THE LIVE ACTION ENDPOINT (Work Order P18-B — the MOUNTING.md step-2
 * mount): `LIVE_ACTION_ENDPOINT = /api/live-mission/actions`.
 *
 * Every consequential action the live-mission surface offers POSTs here:
 *   - the gateway families — the frozen P17-C forms' `action` field
 *     carries the typed envelope JSON (validated + executed through the
 *     merged @sos-2/action-gateway: authority re-evaluated AT ACTION
 *     TIME, fail-closed; idempotent — the same envelope replays the
 *     recorded receipt);
 *   - the ASK resolutions — the merged @sos-2/ask AskQueue.resolve()
 *     (resolution authority = the HUMAN resolver; the queue mints the
 *     Decision record), submitted as the `ask` JSON field or the discrete
 *     form fields (askEntryId / askAlternative / askNote / askResolvedBy).
 *
 * Responses (typed, never a silent 5xx):
 *   - Accept: text/html  -> the standalone server-rendered receipt page
 *     (the browser form flow: receipt + evidence/rationale links +
 *     safe-failure UX — a self-contained document, no cross-instance
 *     state);
 *   - otherwise          -> the typed receipt JSON (200 for executed /
 *     replayed / ask-resolved; 400 for typed rejections and failures).
 *
 * GET answers with the endpoint's typed contract (honest discovery).
 */

import { getLiveActionHost, PROCESS_LOCAL_STORES_NOTE } from '../../../mission/live-actions/host';
import { renderActionReceiptHtml } from '../../../mission/live-actions/receipts/receipt-html';
import { statusFor } from '../../../mission/live-actions/submission';
import type { LiveActionEndpointResponse } from '../../../mission/live-actions/submission';
import { LIVE_MISSION_GRANTS_ENV } from '../../../mission/live-actions/console-authority';
import { BODY_PROVIDER_API_KEY_ENV, BODY_PROVIDER_MODEL_ENV } from '../../../mission/live-actions/adapters/openrouter-probe';
import { VERCEL_TOKEN_ENV, VERCEL_PROJECT_ID_ENV, VERCEL_ORG_ID_ENV } from '../../../mission/live-actions/adapters/vercel-records';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function jsonBody(outcome: unknown, status?: number): Response {
  return new Response(JSON.stringify(outcome, null, 2), {
    status: status ?? (isLiveActionOutcome(outcome) ? statusFor(outcome) : 200),
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function isLiveActionOutcome(value: unknown): value is LiveActionEndpointResponse {
  return typeof value === 'object' && value !== null && typeof (value as { kind?: unknown })['kind'] === 'string';
}

function respond(request: Request, outcome: LiveActionEndpointResponse, status?: number): Response {
  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('text/html')) {
    return new Response(renderActionReceiptHtml(outcome), {
      status: status ?? statusFor(outcome),
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return jsonBody(outcome, status);
}

async function readFieldStrings(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const parsed = (await request.json()) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        record[key] = value;
      } else if (value !== null && value !== undefined) {
        record[key] = JSON.stringify(value);
      }
    }
    return record;
  }
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const record: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') {
        record[key] = value;
      }
    }
    return record;
  }
  return {};
}

export async function POST(request: Request): Promise<Response> {
  const host = getLiveActionHost();
  try {
    const fields = await readFieldStrings(request);
    const actionEnvelope = fields['action'];
    const askEnvelope = fields['ask'];
    const askEntryId = fields['askEntryId'];

    if (actionEnvelope !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(actionEnvelope);
      } catch (error) {
        return respond(request, {
          kind: 'endpoint-error',
          error: { code: 'SUBMISSION_MALFORMED', message: `the "action" form field must carry valid envelope JSON — ${error instanceof Error ? error.message : String(error)}` },
        });
      }
      return respond(request, await host.submitAction(parsed));
    }

    if (askEnvelope !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(askEnvelope);
      } catch (error) {
        return respond(request, {
          kind: 'endpoint-error',
          error: { code: 'ASK_SUBMISSION_MALFORMED', message: `the "ask" form field must carry valid resolution JSON — ${error instanceof Error ? error.message : String(error)}` },
        });
      }
      const submission =
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? (parsed as { entryId?: unknown; resolution?: Record<string, unknown> })
          : {};
      return respond(
        request,
        await host.submitAskResolution({
          entryId: typeof submission.entryId === 'string' ? submission.entryId : '',
          resolvedBy: typeof submission.resolution?.['resolved_by'] === 'string' ? (submission.resolution['resolved_by'] as string) : '',
          chosenAlternativeId:
            typeof submission.resolution?.['chosen_alternative_id'] === 'string' ? (submission.resolution['chosen_alternative_id'] as string) : '',
          note: typeof submission.resolution?.['note'] === 'string' ? (submission.resolution['note'] as string) : '',
          provenance: Array.isArray(submission.resolution?.['provenance'])
            ? ((submission.resolution['provenance'] as unknown[]).filter((entry): entry is string => typeof entry === 'string'))
            : undefined,
          createdAt: typeof submission.resolution?.['created_at'] === 'string' ? (submission.resolution['created_at'] as string) : undefined,
        }),
      );
    }

    if (askEntryId !== undefined) {
      return respond(
        request,
        await host.submitAskResolution({
          entryId: askEntryId,
          resolvedBy: fields['askResolvedBy'] ?? '',
          chosenAlternativeId: fields['askAlternative'] ?? '',
          note: fields['askNote'] ?? '',
        }),
      );
    }

    return respond(request, {
      kind: 'endpoint-error',
      error: {
        code: 'SUBMISSION_MALFORMED',
        message: 'no action envelope: submit the form field "action" (the typed gateway envelope JSON), "ask" (the ASK resolution JSON), or the discrete ask fields (askEntryId, askAlternative, askNote, askResolvedBy)',
      },
    });
  } catch (error) {
    // Never a silent 5xx: a LOUD typed error with the honest message (no credentials ever appear — they are never read here).
    return respond(
      request,
      {
        kind: 'endpoint-error',
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      },
      500,
    );
  }
}

export async function GET(): Promise<Response> {
  return jsonBody({
    endpoint: '/api/live-mission/actions',
    methods: {
      POST: 'typed action submissions: the form field "action" (the gateway envelope JSON) | "ask" (the ASK resolution JSON) | the discrete ask fields (askEntryId, askAlternative, askNote, askResolvedBy); JSON bodies {"action": …} / {"ask": …} are accepted equally; Accept: text/html answers with the server-rendered receipt page',
      GET: 'this typed contract (honest discovery — never a fabricated capability)',
    },
    consequences: [
      "body-lifecycle (summon body) — through the merged action gateway; a real OpenRouter-backed body session when the provider env is attached",
      'promotion — through the merged action gateway; bound to the real Vercel deployment records (exact source_revision_sha) when the provider envs are attached',
      'rollback — through the merged action gateway; the rollback verification answers from the real records read at action time',
      'ASK resolution — through the merged @sos-2/ask AskQueue.resolve(); the queue mints the Decision record',
    ],
    authority: {
      model: 're-evaluated at action time through the merged ActionGateway, fail-closed',
      operatorDeclaration: LIVE_MISSION_GRANTS_ENV,
      note: 'unset or empty declaration denies every action (GRANT_NEVER_HELD); a provider credential is never authority by itself',
    },
    idempotency: 'the same envelope replays the recorded original receipt (content-derived identity for the frozen forms; caller-supplied identity is used as-is)',
    providers: {
      bodyModel: { credentialEnv: BODY_PROVIDER_API_KEY_ENV, modelEnv: BODY_PROVIDER_MODEL_ENV },
      deploymentRecords: { credentialEnvs: [VERCEL_TOKEN_ENV, VERCEL_PROJECT_ID_ENV, VERCEL_ORG_ID_ENV] },
    },
    honestScope: [PROCESS_LOCAL_STORES_NOTE],
  });
}
