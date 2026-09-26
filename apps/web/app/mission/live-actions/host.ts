/**
 * THE LIVE ACTION HOST (Work Order P18-B — the composition root + the
 * async->sync composition bridge for the /api/live-mission/actions
 * endpoint).
 *
 * Every consequential action the live-mission surface offers flows
 * through the MERGED @sos-2/action-gateway (validate -> idempotency
 * claim -> CURRENT authority re-evaluation at action time, fail-closed ->
 * executor seam -> evidence + event emission). The wiring precedent is
 * apps/actions/src/composition.ts (buildHost): everything is injected;
 * the reference wiring is deterministic and offline; real providers bind
 * as adapters behind the frozen seams.
 *
 * THE COMPOSITION BRIDGE (the P8 discipline, verbatim: "the async -> sync
 * bridge therefore lives at the COMPOSITION boundary"): the gateway's
 * executor seam is synchronous, so the host prefetches the REAL provider
 * facts asynchronously — at action time, after a CURRENT-authority
 * pre-check (a denied action never even probes) — and the request-scoped
 * executors answer synchronously from those facts. The gateway's OWN
 * evaluation inside execute() remains THE action-time authority decision.
 *
 * HONEST DEGRADATION (binding): the canonical durable stores are
 * DNS-unreachable today (Neon/Upstash — the P18-A recorded facts), so the
 * idempotency store, the event log, the evidence sink and the ask queue
 * are PROCESS-LOCAL: replays on a warm instance return the recorded
 * receipt; there is no cross-instance durable confirmation, and every
 * receipt says so. Providers answer the honest four-state machine
 * (CONNECTED / UNKNOWN / UNAVAILABLE / DEGRADED) — never fabricated.
 */

import { ActionGateway } from '@sos-2/action-gateway';
import { InMemoryEventLog, InMemoryEvidenceSink, InMemoryIdempotencyStore, ReferenceExecutor, ReferenceRollbackVerifier, ReferenceWorld } from '@sos-2/action-gateway';
import { validateRequest } from '@sos-2/action-gateway';
import { authorityQueryFor } from '@sos-2/action-gateway';
import type { AuthorityPort } from '@sos-2/action-gateway';
import type { ActionReceipt } from '@sos-2/action-gateway';
import { AskQueue, AskError } from '@sos-2/ask';
import type { HostedModelPort } from '@sos-2/real-bodies';
import type { FetchPort } from '@sos-2/deployment-providers';
import { bindGlobalFetch } from '@sos-2/deployment-providers';
import { ambientEnv, createConsoleAuthority } from './console-authority';
import type { EnvSource } from './console-authority';
import { getConsoleAskQueue, CONSOLE_ASK_SCOPE_NOTE } from './console-ask-queue';
import { probeOpenRouterBodyModel, BODY_PROVIDER_API_KEY_ENV, BODY_PROVIDER_MODEL_ENV } from './adapters/openrouter-probe';
import type { OpenRouterProbeResult } from './adapters/openrouter-probe';
import { readVercelDeploymentRecords, VERCEL_TOKEN_ENV, VERCEL_PROJECT_ID_ENV, VERCEL_ORG_ID_ENV } from './adapters/vercel-records';
import type { VercelRecordsResult } from './adapters/vercel-records';
import { RealBodyLifecycleExecutor, RealRecordsExecutor, RealRecordsRollbackVerifier, ProviderUnavailableExecutor } from './live-executors';
import type { BodySessionRecord, EnvironmentPointerRecord } from './live-executors';
import type { ActionExecutor } from '@sos-2/action-gateway';
import { completeActionEnvelope, completeAskResolution, RFC3339_PATTERN } from './submission';
import type { LiveActionEndpointResponse, RealExecutionRecord, ProviderStateRow, TranscriptRow } from './submission';

/** The host's injectable dependencies (everything; the defaults are the app's single impure boundary). */
export interface LiveActionHostDeps {
  /** The environment source (defaults to the ambient process env — the P18-A live-data precedent). */
  readonly env?: EnvSource;
  /** The injected clock (defaults to the real system clock). */
  readonly now?: () => number;
  /** The injectable fetch for the OpenRouter model client (defaults to the global fetch). */
  readonly fetchImpl?: typeof fetch;
  /** The injectable FetchPort for the Vercel records client (defaults to the global fetch seam). */
  readonly vercelFetch?: FetchPort;
  /** A scripted model port (the deterministic suites inject it; production binds the real client). */
  readonly modelPort?: HostedModelPort;
  /** An authority port override (the deterministic suites drive revoked/expired grants through it). */
  readonly authority?: AuthorityPort;
  /** An isolated ask queue (the deterministic suites drive fresh seeds through it). */
  readonly askQueue?: AskQueue;
}

/** The process-local stores + registries one host instance owns. */
export interface LiveActionHostStores {
  /** The reference world (the reference-mode executor's registry — the buildHost precedent). */
  readonly world: ReferenceWorld;
  /** The idempotency store (process-local — honestly noted on every receipt). */
  readonly idempotency: InMemoryIdempotencyStore;
  /** The event log (process-local). */
  readonly events: InMemoryEventLog;
  /** The evidence sink (process-local). */
  readonly evidence: InMemoryEvidenceSink;
  /** The real body sessions registry (OpenRouter-backed). */
  readonly bodySessions: Map<string, BodySessionRecord>;
  /** The environment-pointer ledger (Vercel-records-bound transitions). */
  readonly environmentPointers: Map<string, EnvironmentPointerRecord>;
  /** The recorded real executions, keyed by idempotency key (replay attachment). */
  readonly realExecutions: Map<string, RealExecutionRecord>;
}

/** The live action host surface (what the endpoint + the ask section consume). */
export interface LiveActionHost {
  submitAction(raw: unknown): Promise<LiveActionEndpointResponse>;
  submitAskResolution(input: {
    readonly entryId: string;
    readonly resolvedBy: string;
    readonly chosenAlternativeId: string;
    readonly note: string;
    readonly provenance?: readonly string[];
    readonly createdAt?: string;
  }): Promise<LiveActionEndpointResponse>;
  readonly askQueue: AskQueue;
  readonly stores: LiveActionHostStores;
}

const DEPLOYMENT_RECORD_FAMILIES = ['promotion', 'rollback', 'deployment'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The always-present honest scope limitation (process-local stores — never a fake durable confirmation). */
export const PROCESS_LOCAL_STORES_NOTE =
  'The idempotency store, event log, evidence sink and ask queue are process-local: the canonical durable stores are UNAVAILABLE (Neon/Upstash DNS-unreachable — the P18-A recorded facts). A replay on a warm instance returns the recorded receipt; there is no cross-instance durable confirmation.';

/** The reference-mode limitation for a family whose provider envs are not attached. */
export function referenceModeNote(missingEnvs: readonly string[]): string {
  return `Reference mode: the deterministic reference executor (the buildHost precedent) answered — the provider env ${missingEnvs.join(', ')} ${missingEnvs.length === 1 ? 'is' : 'are'} not attached (env NAMES only, never values).`;
}

/** The Vercel-records-bound promotion/rollback limitation (the honest non-mutation disclosure). */
export const VERCEL_POINTER_NOTE =
  'The environment-pointer ledger is process-local: the action is bound to the REAL Vercel deployment records read at action time (exact source_revision_sha, real dpl_… ids), but the console did NOT mutate the provider\u2019s physical alias — the durable promotion/rollback registrar binding is the frozen P17-A deployment registrar\u2019s to mint at the architect\u2019s integration.';

/** Compose a live action host (everything injectable; the deterministic suites script every seam). */
export function createLiveActionHost(deps: LiveActionHostDeps = {}): LiveActionHost {
  const env: EnvSource = deps.env ?? ambientEnv;
  const now: () => number = deps.now ?? (() => Date.now());
  const authority: AuthorityPort = deps.authority ?? createConsoleAuthority(env);
  const askQueue: AskQueue = deps.askQueue ?? getConsoleAskQueue().queue;

  const stores: LiveActionHostStores = {
    world: new ReferenceWorld(),
    idempotency: new InMemoryIdempotencyStore(),
    events: new InMemoryEventLog(),
    evidence: new InMemoryEvidenceSink(),
    bodySessions: new Map<string, BodySessionRecord>(),
    environmentPointers: new Map<string, EnvironmentPointerRecord>(),
    realExecutions: new Map<string, RealExecutionRecord>(),
  };

  function gatewayFor(executors: readonly ActionExecutor[], rollbackVerifier: RealRecordsRollbackVerifier | ReferenceRollbackVerifier | null): ActionGateway {
    return new ActionGateway({
      clock: { now },
      authority,
      executors: [...executors, new ReferenceExecutor(stores.world)],
      idempotency: stores.idempotency,
      events: stores.events,
      evidence: stores.evidence,
      rollbackVerifier,
    });
  }

  async function submitAction(raw: unknown): Promise<LiveActionEndpointResponse> {
    const at = now();
    const atRfc3339 = new Date(at).toISOString();
    if (!isPlainObject(raw)) {
      return {
        kind: 'endpoint-error',
        error: { code: 'SUBMISSION_MALFORMED', message: 'the action envelope must be a JSON object (the form field "action", or the JSON body { "action": … })' },
      };
    }
    const { envelope } = completeActionEnvelope(raw, at);
    const idempotencyKey = isNonEmptyString(envelope['idempotencyKey']) ? (envelope['idempotencyKey'] as string) : '';

    // IDEMPOTENT REPLAY: the recorded receipt + the recorded real execution — no new provider work.
    if (stores.idempotency.lookup(idempotencyKey) !== null) {
      const outcome = gatewayFor([], null).execute(envelope);
      if (outcome.kind === 'replayed') {
        return { kind: 'replayed', replayed: true, receipt: outcome.receipt, execution: stores.realExecutions.get(idempotencyKey) ?? null, limitations: [PROCESS_LOCAL_STORES_NOTE], at: atRfc3339 };
      }
      // The store said replayed but the gateway did not — impossible for the in-memory store; fail loud + typed.
      return { kind: 'endpoint-error', error: { code: 'IDEMPOTENCY_STATE_DIVERGED', message: 'the idempotency store and the gateway disagree — the action was not re-executed (fail-closed)' } };
    }

    const validated = validateRequest(envelope);
    if (!validated.ok) {
      const outcome = gatewayFor([], null).execute(envelope);
      if (outcome.kind === 'rejected') {
        return { kind: 'rejected', rejection: outcome.rejection };
      }
      return { kind: 'endpoint-error', error: { code: 'VALIDATION_STATE_DIVERGED', message: 'the envelope failed validation but the gateway did not reject it (fail-closed — never executed)' } };
    }

    // The async-bridge pre-check: a CURRENT-authority early-out so a denied
    // action never even probes its providers. The gateway's OWN evaluation
    // inside execute() (below) remains THE action-time authority decision.
    const snapshot = authority.evaluateCurrent(authorityQueryFor(validated.request, undefined), at);
    const limitations: string[] = [PROCESS_LOCAL_STORES_NOTE];

    let probe: OpenRouterProbeResult | null = null;
    let records: VercelRecordsResult | null = null;
    if (snapshot.granted) {
      const family = validated.request.family;
      if (family === 'body-lifecycle' && (isNonEmptyString(env()[BODY_PROVIDER_API_KEY_ENV]) || deps.modelPort !== undefined)) {
        probe = await probeOpenRouterBodyModel({
          apiKey: env()[BODY_PROVIDER_API_KEY_ENV] ?? null,
          ...(isNonEmptyString(env()[BODY_PROVIDER_MODEL_ENV]) ? { model: env()[BODY_PROVIDER_MODEL_ENV] as string } : {}),
          ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
          ...(deps.modelPort !== undefined ? { modelPort: deps.modelPort } : {}),
        });
      }
      if ((DEPLOYMENT_RECORD_FAMILIES as readonly string[]).includes(family) && isNonEmptyString(env()[VERCEL_TOKEN_ENV]) && isNonEmptyString(env()[VERCEL_PROJECT_ID_ENV])) {
        records = await readVercelDeploymentRecords({
          token: env()[VERCEL_TOKEN_ENV] ?? null,
          projectId: env()[VERCEL_PROJECT_ID_ENV] ?? null,
          orgId: isNonEmptyString(env()[VERCEL_ORG_ID_ENV]) ? (env()[VERCEL_ORG_ID_ENV] as string) : null,
          ...(deps.vercelFetch !== undefined ? { fetch: deps.vercelFetch } : {}),
        });
      }
    }

    // Compose the request-scoped executors + verifier from the prefetched facts.
    const executors: ActionExecutor[] = [];
    let rollbackVerifier: RealRecordsRollbackVerifier | ReferenceRollbackVerifier | null = null;
    let mode: 'real' | 'reference' = 'reference';

    if (probe !== null) {
      mode = 'real';
      executors.push(new RealBodyLifecycleExecutor(stores.bodySessions, probe, atRfc3339));
    }
    if (records !== null) {
      if (records.state === 'CONNECTED') {
        mode = 'real';
        executors.push(new RealRecordsExecutor(records.deployments, stores.environmentPointers, records.production, atRfc3339));
        rollbackVerifier = new RealRecordsRollbackVerifier(records.deployments);
        limitations.push(VERCEL_POINTER_NOTE);
      } else if (records.state === 'UNAVAILABLE') {
        mode = 'real';
        executors.push(
          new ProviderUnavailableExecutor(
            [...DEPLOYMENT_RECORD_FAMILIES],
            'VERCEL_RECORDS_UNAVAILABLE',
            `the real Vercel deployment records read failed (${records.lastError ?? 'unknown error'}) — the action fails CLOSED (no fake confirmations)`,
          ),
        );
      }
      // records UNKNOWN (not configured) is impossible here — the env gate above checked both names.
    }
    if (mode === 'reference') {
      limitations.push(referenceModeNote([BODY_PROVIDER_API_KEY_ENV, `${VERCEL_TOKEN_ENV} / ${VERCEL_PROJECT_ID_ENV}`]));
    }

    const outcome = gatewayFor(executors, rollbackVerifier).execute(envelope);
    if (outcome.kind === 'rejected') {
      return { kind: 'rejected', rejection: outcome.rejection };
    }

    const receipt: ActionReceipt = outcome.receipt;
    let execution: RealExecutionRecord | null = null;
    if (outcome.kind === 'replayed') {
      // A concurrent submission with the same key won the race (the gateway's
      // own idempotency claim caught it): the RECORDED execution is the truth.
      execution = stores.realExecutions.get(idempotencyKey) ?? null;
    } else if (probe !== null || records !== null) {
      const providers: ProviderStateRow[] = [];
      const requests: TranscriptRow[] = [];
      const facts: Record<string, string> = {};
      if (probe !== null) {
        providers.push({
          provider: 'openrouter (the body\u2019s hosted model provider)',
          state: probe.state,
          detail: probe.detail,
          lastError: probe.error !== null ? `${probe.error.kind}: ${probe.error.message}` : null,
          apiRevision: probe.apiRevision,
          credentialEnv: BODY_PROVIDER_API_KEY_ENV,
        });
        if (probe.response !== null) {
          facts['bodyModelResponseId'] = probe.response.id;
          facts['bodyServedModel'] = probe.response.model;
          facts['bodyFinishReason'] = probe.response.finish_reason ?? 'null';
          if (probe.response.usage?.total_tokens !== null && probe.response.usage?.total_tokens !== undefined) {
            facts['bodyUsageTotalTokens'] = String(probe.response.usage.total_tokens);
          }
        }
      }
      if (records !== null) {
        providers.push({
          provider: 'vercel (the deployment provider)',
          state: records.state,
          detail: records.detail,
          lastError: records.lastError,
          apiRevision: records.apiRevision,
          credentialEnv: `${VERCEL_TOKEN_ENV} / ${VERCEL_PROJECT_ID_ENV}`,
        });
        for (const request of records.requests) {
          requests.push({ provider: 'vercel', method: request.method, path: request.path, status: request.status });
        }
        if (records.production !== null) {
          facts['observedProductionDeploymentId'] = records.production.id;
          facts['observedProductionSourceSha'] = records.production.commitSha ?? 'unknown';
        }
      }
      if (receipt.output !== null && 'produced' in receipt.output) {
        for (const [key, value] of Object.entries(receipt.output.produced)) {
          facts[key] = value;
        }
      }
      const record: RealExecutionRecord = { at: atRfc3339, family: receipt.family, mode, providers, requests, facts };
      if (outcome.kind === 'executed') {
        stores.realExecutions.set(idempotencyKey, record);
      }
      execution = record;
    }

    if (outcome.kind === 'replayed') {
      return {
        kind: 'replayed',
        replayed: true,
        receipt,
        execution,
        limitations,
        at: atRfc3339,
      };
    }
    return {
      kind: 'executed',
      replayed: false,
      receipt,
      execution,
      limitations,
      at: atRfc3339,
    };
  }

  async function submitAskResolution(input: {
    readonly entryId: string;
    readonly resolvedBy: string;
    readonly chosenAlternativeId: string;
    readonly note: string;
    readonly provenance?: readonly string[];
    readonly createdAt?: string;
  }): Promise<LiveActionEndpointResponse> {
    const at = now();
    const atRfc3339 = new Date(at).toISOString();
    if (!isNonEmptyString(input.entryId) || !isNonEmptyString(input.resolvedBy) || !isNonEmptyString(input.chosenAlternativeId) || !isNonEmptyString(input.note)) {
      return {
        kind: 'ask-failed',
        error: {
          code: 'ASK_SUBMISSION_MALFORMED',
          message: 'an ask resolution needs a non-empty entry id, resolver identity, chosen alternative and note (every resolution is auditable)',
        },
      };
    }
    if (input.createdAt !== undefined && !RFC3339_PATTERN.test(input.createdAt)) {
      return { kind: 'ask-failed', error: { code: 'ASK_SUBMISSION_MALFORMED', message: `createdAt must be an RFC3339 timestamp, received: ${JSON.stringify(input.createdAt)}` } };
    }
    const submission = completeAskResolution({ ...input, nowRfc3339: atRfc3339 });
    try {
      const decision = askQueue.resolve(submission.entryId, {
        ...submission.resolution,
        provenance: [...submission.resolution.provenance],
      });
      return {
        kind: 'ask-resolved',
        resolution: {
          entryId: submission.entryId,
          decisionRef: decision.envelope.id,
          action: decision.content.action,
          resolvedBy: submission.resolution.resolved_by,
          chosenAlternativeId: submission.resolution.chosen_alternative_id,
          note: submission.resolution.note,
          createdAt: submission.resolution.created_at,
          provenance: [...submission.resolution.provenance],
          queue: { pending: askQueue.pendingCount, total: askQueue.size, scopeNote: CONSOLE_ASK_SCOPE_NOTE },
          at: atRfc3339,
        },
      };
    } catch (error) {
      return {
        kind: 'ask-failed',
        error: { code: 'ASK_RESOLUTION_REJECTED', message: error instanceof AskError ? error.message : error instanceof Error ? error.message : String(error) },
      };
    }
  }

  return { submitAction, submitAskResolution, askQueue, stores };
}

// ---------------------------------------------------------------------------
// The app's host singleton (the process boundary; routes consume this)
// ---------------------------------------------------------------------------

const LIVE_ACTION_HOST_GLOBAL = Symbol.for('sos-2.web-live-mission.live-action-host');

/** The app's live action host singleton (survives dev HMR and warm serverless reuse). */
export function getLiveActionHost(): LiveActionHost {
  const globals = globalThis as Record<symbol, LiveActionHost | undefined>;
  const existing = globals[LIVE_ACTION_HOST_GLOBAL];
  if (existing !== undefined) {
    return existing;
  }
  const fresh = createLiveActionHost();
  globals[LIVE_ACTION_HOST_GLOBAL] = fresh;
  return fresh;
}
