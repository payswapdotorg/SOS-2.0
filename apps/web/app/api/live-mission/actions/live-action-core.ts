/**
 * THE LIVE ACTION ENDPOINT CORE (Work Order P18-B — MOUNTING.md
 * integration step 2). This module is the whole action-submission
 * pipeline behind `LIVE_ACTION_ENDPOINT` = `/api/live-mission/actions`,
 * kept free of every ambient boundary (no network, no clock, no env —
 * all injected) so the deterministic suite drives the REAL pipeline and
 * the Next route handler stays a thin adapter.
 *
 * Pipeline (fail-closed, exactly the merged gateway's order):
 *
 *   1. parse the submission (form-encoded `action` field or a JSON body);
 *   2. dispatch by envelope shape: `family` -> action-gateway envelope,
 *      `entryId`+`resolution` -> ASK resolution envelope;
 *   3. complete partial form envelopes: the mounted forms POST the
 *      typed payload WITHOUT actionId/idempotencyKey/requestedAt (the
 *      server-rendered surface carries no volatile state) — the endpoint
 *      derives actionId and idempotencyKey as DETERMINISTIC content
 *      addresses of the envelope's semantic content, so the SAME form
 *      submission always maps to the SAME idempotency key (same
 *      envelope -> same outcome + receipt, no double execution). A full
 *      envelope (the P17-C builders' output) is submitted as carried;
 *   4. gateway actions: `ActionGateway.execute` — envelope validation
 *      (typed rejection; smuggled authority fields are named), the
 *      idempotency claim (replay returns the recorded original receipt),
 *      CURRENT authority re-evaluation AT ACTION TIME (revoked/expired/
 *      never-held grants fail CLOSED — executors never invoked), typed
 *      executor operations, evidence + event emission bound to the exact
 *      revisions acted on;
 *   5. ASK envelopes: `AskQueue.resolve` (resolution authority is the
 *      HUMAN resolver; the queue mints the Decision record bound to the
 *      origin ask's exact input digest). ASK resolution is terminal per
 *      entry (the frozen queue contract), so the endpoint wraps it in
 *      its own idempotency layer: the SAME resolution envelope replays
 *      the recorded original outcome (never a second resolution
 *      attempt). Unknown entries / invalid resolutions are typed HONEST
 *      failures — the ask plane is not wired on this branch, and a
 *      failure is recorded truthfully, never fabricated success.
 *
 * HONESTY (binding): provider states are machine-checkable
 * CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED — never fabricated; receipts
 * carry their evidence ids and rationale links; denied actions render
 * safe failure UX with the authority reason; the in-process idempotency
 * scope is stated on every receipt (the durable store adapters are
 * UNAVAILABLE from this environment — no durable confirmation is
 * claimed).
 */

import {
  ActionGateway,
  InMemoryAuthority,
  InMemoryEventLog,
  InMemoryEvidenceSink,
  InMemoryIdempotencyStore,
  ReferenceExecutor,
  ReferenceRollbackVerifier,
  ReferenceWorld,
  contentAddress,
} from '@sos-2/action-gateway';
import type {
  ActionExecutor,
  ActionReceipt,
  ActionValidationRejection,
  AuthorityPort,
  Clock,
  EvidenceSink,
  IdempotencyStore,
  RollbackVerifier,
  Timestamp,
} from '@sos-2/action-gateway';
import { AskQueue, AskError } from '@sos-2/ask';

// ---------------------------------------------------------------------------
// The submission envelope shapes (the P17-C builders' public shapes)
// ---------------------------------------------------------------------------

/** The mounted form's envelope: the typed payload WITHOUT volatile ids. */
export type RawActionEnvelope = Record<string, unknown>;

/** The ASK resolution envelope (AskQueue.resolve input, P17-C shape). */
export interface RawAskEnvelope {
  readonly entryId: string;
  readonly resolution: {
    readonly resolved_by: string;
    readonly chosen_alternative_id: string;
    readonly note: string;
    readonly provenance: readonly string[];
    readonly created_at: string;
  };
}

// ---------------------------------------------------------------------------
// The view receipts (serializable; the receipt view renders these)
// ---------------------------------------------------------------------------

/** How the submitted action envelope was identified. */
export type EnvelopeDerivation = 'form-derived' | 'envelope-carried';

/** The idempotency scope honestly stated on every receipt. */
export type IdempotencyScope = 'in-process' | 'reference-in-memory';

/** One gateway-action receipt view (executed, replayed or rejected). */
export interface GatewayActionReceiptView {
  readonly kind: 'gateway-action';
  readonly hostLabel: string;
  readonly outcome: 'executed' | 'replayed' | 'rejected';
  readonly replayed: boolean;
  readonly receipt: ActionReceipt | null;
  readonly rejection: ActionValidationRejection | null;
  readonly submittedEnvelope: unknown;
  readonly derivation: EnvelopeDerivation | null;
  readonly actionId: string | null;
  readonly idempotencyKey: string | null;
  readonly idempotencyScope: IdempotencyScope;
  readonly honestyNotes: readonly string[];
}

/** Typed honest ASK failure codes (never fabricated success). */
export type AskFailureCode =
  | 'ASK_ENTRY_UNKNOWN'
  | 'ASK_ALREADY_RESOLVED'
  | 'ASK_RESOLUTION_INVALID'
  | 'ASK_ENVELOPE_INVALID';

/** One ASK-resolution receipt view. */
export interface AskResolutionReceiptView {
  readonly kind: 'ask-resolution';
  readonly hostLabel: string;
  readonly status: 'RESOLVED' | 'FAILED';
  readonly replayed: boolean;
  readonly entryId: string;
  readonly resolvedBy: string | null;
  readonly decisionRef: string | null;
  readonly chosenAlternativeId: string | null;
  /** RFC3339 resolution instant (from the resolution envelope / the injected clock). */
  readonly resolvedAt: string | null;
  readonly error: { readonly code: AskFailureCode; readonly detail: string } | null;
  readonly submittedEnvelope: unknown;
  readonly idempotencyKey: string;
  readonly idempotencyScope: IdempotencyScope;
  readonly honestyNotes: readonly string[];
}

/** A submission that could not even be shaped into an envelope. */
export interface MalformedSubmissionView {
  readonly kind: 'malformed';
  readonly detail: string;
}

/** Everything the endpoint can answer with. */
export type LiveActionReceiptView = GatewayActionReceiptView | AskResolutionReceiptView | MalformedSubmissionView;

/** The endpoint's full answer: the view receipt + the honest HTTP status. */
export interface LiveActionResult {
  readonly view: LiveActionReceiptView;
  readonly httpStatus: number;
}

// ---------------------------------------------------------------------------
// The host (the buildHost precedent, web-side)
// ---------------------------------------------------------------------------

/** An idempotently recorded ASK resolution outcome (the replay record). */
interface RecordedAskResolution {
  readonly idempotencyKey: string;
  readonly view: AskResolutionReceiptView;
  readonly recordedAt: Timestamp;
}

export interface LiveActionHost {
  readonly label: string;
  readonly clock: Clock;
  readonly gateway: ActionGateway;
  readonly asks: AskQueue;
  readonly idempotencyScope: IdempotencyScope;
  /** The endpoint-level ASK replay store (same envelope -> same outcome). */
  readonly askReplays: Map<string, RecordedAskResolution>;
  /**
   * The IN-PROCESS receipt ledger (idempotencyKey -> receipt view): the
   * receipt page reads it after the POST-redirect-GET hop. In-process by
   * design — the durable adapters are UNAVAILABLE from this environment;
   * no durable confirmation is claimed (the page states the scope).
   */
  readonly receiptLedger: Map<string, LiveActionReceiptView>;
  /** Reference-mode extras (deterministic suite reach-through; absent on the deployed host). */
  readonly reference: {
    readonly world: ReferenceWorld;
    readonly authority: AuthorityPort;
    readonly evidence: EvidenceSink;
    readonly events: InMemoryEventLog;
    readonly idempotency: IdempotencyStore;
  } | null;
}

export interface CreateLiveActionHostOptions {
  readonly clock?: Clock;
  readonly authority?: AuthorityPort;
  readonly executors?: readonly ActionExecutor[];
  readonly rollbackVerifier?: RollbackVerifier | null;
  readonly asks?: AskQueue;
  readonly hostLabel?: string;
}

/**
 * Compose the live action host (the apps/actions buildHost precedent,
 * web-side): everything injected; the reference wiring below is
 * deterministic and offline. Real providers attach behind the executor
 * seam at the process boundary (the route handler), never as authorities.
 */
export function createLiveActionHost(options: CreateLiveActionHostOptions = {}): LiveActionHost {
  const clock = options.clock ?? { now: (): Timestamp => 0 };
  const world = new ReferenceWorld();
  const authority = options.authority ?? new InMemoryAuthority();
  const executors = options.executors ?? [new ReferenceExecutor(world)];
  const idempotency = new InMemoryIdempotencyStore();
  const events = new InMemoryEventLog();
  const evidence = new InMemoryEvidenceSink();
  const gateway = new ActionGateway({
    clock,
    authority,
    executors,
    idempotency,
    events,
    evidence,
    rollbackVerifier: options.rollbackVerifier === undefined ? new ReferenceRollbackVerifier(world) : options.rollbackVerifier,
  });
  return {
    label: options.hostLabel ?? 'live-action:reference',
    clock,
    gateway,
    asks: options.asks ?? new AskQueue(),
    idempotencyScope: 'in-process',
    askReplays: new Map(),
    receiptLedger: new Map(),
    reference: { world, authority, evidence, events, idempotency },
  };
}

// ---------------------------------------------------------------------------
// Step 1: parse the submission body
// ---------------------------------------------------------------------------

export interface ParsedSubmission {
  readonly envelope: unknown;
}

/** Parse a submitted body: form-encoded (`action` field) or JSON. */
export function parseLiveActionBody(input: { contentType: string; text: string }): { ok: true; parsed: ParsedSubmission } | { ok: false; detail: string } {
  const contentType = input.contentType.toLowerCase();
  const text = input.text.trim();
  if (text.length === 0) {
    return { ok: false, detail: 'the submission body is empty (expected a form-encoded `action` field or a JSON action/ASK envelope)' };
  }
  if (contentType.includes('application/json')) {
    try {
      return { ok: true, parsed: { envelope: JSON.parse(text) as unknown } };
    } catch (error) {
      return { ok: false, detail: `the JSON body could not be parsed: ${errorMessage(error)}` };
    }
  }
  // form-encoded (the mounted forms POST `action` as a hidden input)
  try {
    const fields = new URLSearchParams(text);
    const action = fields.get('action');
    if (action === null) {
      return { ok: false, detail: "the form body carries no `action` field (the mounted forms submit the typed envelope there)" };
    }
    try {
      return { ok: true, parsed: { envelope: JSON.parse(action) as unknown } };
    } catch (error) {
      return { ok: false, detail: `the \`action\` field is not valid JSON: ${errorMessage(error)}` };
    }
  } catch (error) {
    return { ok: false, detail: `the form body could not be parsed: ${errorMessage(error)}` };
  }
}

// ---------------------------------------------------------------------------
// Step 2: dispatch by envelope shape
// ---------------------------------------------------------------------------

export type SubmissionKind = 'gateway-action' | 'ask-resolution';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Dispatch by shape: `family` -> gateway action; `entryId`+`resolution` -> ASK resolution. */
export function dispatchSubmission(envelope: unknown): { kind: SubmissionKind } | { error: string } {
  if (!isPlainObject(envelope)) {
    return { error: 'the envelope must be a JSON object (a typed action envelope or an ASK resolution envelope)' };
  }
  if (typeof envelope['family'] === 'string' && envelope['family'].length > 0) {
    return { kind: 'gateway-action' };
  }
  if (isNonEmptyString(envelope['entryId']) && isPlainObject(envelope['resolution'])) {
    return { kind: 'ask-resolution' };
  }
  return { error: 'the envelope is neither a typed action envelope (missing `family`) nor an ASK resolution envelope (missing `entryId`/`resolution`)' };
}

// ---------------------------------------------------------------------------
// Step 3: complete partial form envelopes (deterministic derivation)
// ---------------------------------------------------------------------------

export interface CompletedEnvelope {
  readonly envelope: Record<string, unknown>;
  readonly derivation: EnvelopeDerivation;
  readonly actionId: string;
  readonly idempotencyKey: string;
}

/**
 * Complete the submitted action envelope. The mounted forms POST the
 * typed payload without volatile ids; the endpoint derives actionId and
 * idempotencyKey as DETERMINISTIC content addresses of the envelope's
 * semantic content (family/actor/targetRevision/payload — NOT the
 * submission instant), so resubmitting the SAME form maps to the SAME
 * idempotency key: same envelope -> same outcome + receipt. A full
 * envelope (actionId + idempotencyKey carried) is honored as carried.
 */
export function completeActionEnvelope(raw: Record<string, unknown>, requestedAt: Timestamp): { ok: true; completed: CompletedEnvelope } | { ok: false; detail: string } {
  const carriedActionId = raw['actionId'];
  const carriedIdempotencyKey = raw['idempotencyKey'];
  if (isNonEmptyString(carriedActionId) && isNonEmptyString(carriedIdempotencyKey)) {
    const carriedRequestedAt = raw['requestedAt'];
    const envelope =
      typeof carriedRequestedAt === 'number' && Number.isFinite(carriedRequestedAt)
        ? { ...raw }
        : { ...raw, requestedAt };
    return { ok: true, completed: { envelope, derivation: 'envelope-carried', actionId: carriedActionId, idempotencyKey: carriedIdempotencyKey } };
  }
  if (carriedActionId !== undefined || carriedIdempotencyKey !== undefined) {
    return { ok: false, detail: 'a partially-identified envelope: provide both actionId and idempotencyKey, or neither (the endpoint derives both deterministically)' };
  }
  const semantic = {
    family: raw['family'],
    actor: raw['actor'],
    targetRevision: raw['targetRevision'],
    payload: raw['payload'],
  };
  const actionId = contentAddress(semantic, 'live-action');
  const idempotencyKey = contentAddress(semantic, 'live-action-idempotency');
  const envelope: Record<string, unknown> = { ...raw, actionId, idempotencyKey, requestedAt };
  return { ok: true, completed: { envelope, derivation: 'form-derived', actionId, idempotencyKey } };
}

// ---------------------------------------------------------------------------
// Steps 4-5: submit through the gateway / the ask queue
// ---------------------------------------------------------------------------

const IDEMPOTENCY_NOTE = 'idempotency scope: in-process on this host — the same envelope replays the recorded original receipt within this process; the durable idempotency store adapters (Neon/Upstash) are UNAVAILABLE from this deployment environment, so NO durable idempotency is claimed';

const AUTHORITY_NOTE = 'authority was re-evaluated AT ACTION TIME by the merged action gateway — a revoked, expired or never-held grant fails CLOSED (DENIED) and the executor is never invoked; exactly one evaluation per submission';

const EVIDENCE_NOTE = 'the receipt carries the gateway evidence sink content-addressed evidence ids verbatim; the evidence ledger surface mounts with the data plane (P18-A) — the ids here are the binding, never a fabricated ledger';

/** Submit one action envelope through the real gateway. */
function submitGatewayAction(raw: Record<string, unknown>, host: LiveActionHost, now: Timestamp): LiveActionResult {
  const completion = completeActionEnvelope(raw, now);
  if (!completion.ok) {
    return {
      view: {
        kind: 'gateway-action',
        hostLabel: host.label,
        outcome: 'rejected',
        replayed: false,
        receipt: null,
        rejection: { code: 'ENVELOPE_MALFORMED', field: 'actionId', detail: completion.detail },
        submittedEnvelope: raw,
        derivation: null,
        actionId: null,
        idempotencyKey: null,
        idempotencyScope: host.idempotencyScope,
        honestyNotes: [AUTHORITY_NOTE, IDEMPOTENCY_NOTE],
      },
      httpStatus: 400,
    };
  }
  const outcome = host.gateway.execute(completion.completed.envelope);
  if (outcome.kind === 'rejected') {
    return {
      view: {
        kind: 'gateway-action',
        hostLabel: host.label,
        outcome: 'rejected',
        replayed: false,
        receipt: null,
        rejection: outcome.rejection,
        submittedEnvelope: completion.completed.envelope,
        derivation: completion.completed.derivation,
        actionId: completion.completed.actionId,
        idempotencyKey: completion.completed.idempotencyKey,
        idempotencyScope: host.idempotencyScope,
        honestyNotes: [AUTHORITY_NOTE, IDEMPOTENCY_NOTE, EVIDENCE_NOTE],
      },
      httpStatus: 400,
    };
  }
  const replayed = outcome.kind === 'replayed';
  return {
    view: {
      kind: 'gateway-action',
      hostLabel: host.label,
      outcome: replayed ? 'replayed' : 'executed',
      replayed,
      receipt: outcome.receipt,
      rejection: null,
      submittedEnvelope: completion.completed.envelope,
      derivation: completion.completed.derivation,
      actionId: completion.completed.actionId,
      idempotencyKey: completion.completed.idempotencyKey,
      idempotencyScope: host.idempotencyScope,
      honestyNotes: [
        AUTHORITY_NOTE,
        IDEMPOTENCY_NOTE,
        EVIDENCE_NOTE,
        replayed
          ? 'REPLAY: the idempotency key matched the recorded original receipt — the recorded outcome was returned and the executor was NOT invoked again (no double execution)'
          : 'first execution of this idempotency key — the receipt below is the original outcome record',
      ],
    },
    httpStatus: 200,
  };
}

function classifyAskFailure(message: string): AskFailureCode {
  if (message.includes('unknown ask queue entry')) return 'ASK_ENTRY_UNKNOWN';
  if (message.includes('already RESOLVED')) return 'ASK_ALREADY_RESOLVED';
  return 'ASK_RESOLUTION_INVALID';
}

const ASK_HONESTY_NOTES = [
  'resolution authority is the HUMAN resolver (resolved_by) — the merged AskQueue mints the Decision record bound to the origin ask\u2019s exact input digest; an entry is resolved at most once',
  'the ask plane has NO wired producer on this branch (the queue is honestly empty): an unknown entry is a typed honest failure (ASK_ENTRY_UNKNOWN), never a fabricated resolution',
  IDEMPOTENCY_NOTE,
];

/** Submit one ASK resolution envelope through the real queue (idempotent). */
function submitAskResolution(raw: Record<string, unknown>, host: LiveActionHost, now: Timestamp): LiveActionResult {
  const entryId = raw['entryId'];
  const resolution = raw['resolution'];
  if (!isNonEmptyString(entryId) || !isPlainObject(resolution)) {
    return {
      view: {
        kind: 'ask-resolution',
        hostLabel: host.label,
        status: 'FAILED',
        replayed: false,
        entryId: typeof entryId === 'string' ? entryId : '',
        resolvedBy: null,
        decisionRef: null,
        chosenAlternativeId: null,
        resolvedAt: isoTime(now),
        error: { code: 'ASK_ENVELOPE_INVALID', detail: 'the ASK envelope must carry a non-empty entryId and a resolution object' },
        submittedEnvelope: raw,
        idempotencyKey: '',
        idempotencyScope: host.idempotencyScope,
        honestyNotes: ASK_HONESTY_NOTES,
      },
      httpStatus: 400,
    };
  }
  const idempotencyKey = contentAddress({ entryId, resolution }, 'live-ask-idempotency');
  const existing = host.askReplays.get(idempotencyKey);
  if (existing !== undefined) {
    const replayView: AskResolutionReceiptView = {
      ...existing.view,
      replayed: true,
      idempotencyKey,
      honestyNotes: [
        ...existing.view.honestyNotes,
        'REPLAY: this exact resolution envelope matched the recorded original outcome — the recorded outcome was returned; the queue was NOT consulted a second time (an entry is resolved at most once)',
      ],
    };
    return { view: replayView, httpStatus: 200 };
  }
  const resolvedBy = isNonEmptyString(resolution['resolved_by']) ? resolution['resolved_by'] : null;
  const resolvedAt = isNonEmptyString(resolution['created_at']) ? resolution['created_at'] : isoTime(now);
  try {
    // the queue re-validates every field at runtime (fail-closed typed
    // errors); the casts only re-type what dispatch already shaped.
    const decision = host.asks.resolve(entryId, {
      resolved_by: resolution['resolved_by'] as string,
      chosen_alternative_id: resolution['chosen_alternative_id'] as string,
      note: resolution['note'] as string,
      provenance: resolution['provenance'] as string[],
      created_at: resolution['created_at'] as string,
    });
    const view: AskResolutionReceiptView = {
      kind: 'ask-resolution',
      hostLabel: host.label,
      status: 'RESOLVED',
      replayed: false,
      entryId,
      resolvedBy: decision.content.resolution?.resolved_by ?? resolvedBy,
      decisionRef: decision.envelope.id,
      chosenAlternativeId: decision.content.resolution?.alternative_id ?? null,
      resolvedAt,
      error: null,
      submittedEnvelope: raw,
      idempotencyKey,
      idempotencyScope: host.idempotencyScope,
      honestyNotes: [
        ...ASK_HONESTY_NOTES,
        `the resolution minted Decision record ${decision.envelope.id} — the decision reference IS the evidence binding for this resolution`,
      ],
    };
    host.askReplays.set(idempotencyKey, { idempotencyKey, view, recordedAt: host.clock.now() });
    return { view, httpStatus: 200 };
  } catch (error) {
    const message = errorMessage(error);
    const code = error instanceof AskError ? classifyAskFailure(message) : 'ASK_RESOLUTION_INVALID';
    const view: AskResolutionReceiptView = {
      kind: 'ask-resolution',
      hostLabel: host.label,
      status: 'FAILED',
      replayed: false,
      entryId,
      resolvedBy,
      decisionRef: null,
      chosenAlternativeId: null,
      resolvedAt,
      error: { code, detail: message },
      submittedEnvelope: raw,
      idempotencyKey,
      idempotencyScope: host.idempotencyScope,
      honestyNotes: ASK_HONESTY_NOTES,
    };
    host.askReplays.set(idempotencyKey, { idempotencyKey, view, recordedAt: host.clock.now() });
    return { view, httpStatus: 200 };
  }
}

/** The receipt page URL for a view carrying an idempotency key (the PRG hop). */
export function receiptUrlFor(view: LiveActionReceiptView): string | null {
  if (view.kind === 'malformed') return null;
  const key = view.idempotencyKey;
  if (key === null || key === undefined || key.length === 0) return null;
  return `/mission/receipt?key=${encodeURIComponent(key)}`;
}

// ---------------------------------------------------------------------------
// The receipt cookie (the cross-instance PRG hop)
// ---------------------------------------------------------------------------

/** The cookie name carrying the submission's own receipt (server-minted, key-validated). */
export const LIVE_ACTION_RECEIPT_COOKIE = 'live-action-receipt';

/** The cookie payload cap (compact view without the submitted envelope; cookies are ~4KB). */
const RECEIPT_COOKIE_MAX_CHARS = 3_600;

interface ViewWithEnvelope extends Record<string, unknown> {
  submittedEnvelope?: unknown;
}

/**
 * Compact the receipt view for the PRG cookie: the submitted envelope is
 * dropped (it is never rendered); everything else (status, authority,
 * evidence ids, idempotency scope, honesty notes) round-trips so the
 * receipt page renders on ANY serverless instance. Returns null when the
 * view carries no key or exceeds the cookie budget (the page then falls
 * back to the in-process ledger / the honest empty state — never a
 * fabricated receipt).
 */
export function compactReceiptForCookie(view: LiveActionReceiptView): string | null {
  if (view.kind === 'malformed') return null;
  const key = view.idempotencyKey;
  if (key === null || key === undefined || key.length === 0) return null;
  const { submittedEnvelope: _dropped, ...rest } = view as unknown as ViewWithEnvelope;
  const serialized = JSON.stringify(rest);
  if (serialized.length > RECEIPT_COOKIE_MAX_CHARS) return null;
  return serialized;
}

/**
 * Parse + validate a receipt cookie candidate against the requested key:
 * only a view whose idempotency key MATCHES the URL key is accepted (the
 * cookie is the submission's own server-minted round-trip, never an
 * injection vector for someone else's receipt). Returns null on any
 * mismatch or malformed payload.
 */
export function parseReceiptCookie(raw: string, key: string): LiveActionReceiptView | null {
  if (key.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const view = parsed as Record<string, unknown>;
    if (view['kind'] !== 'gateway-action' && view['kind'] !== 'ask-resolution') return null;
    const carriedKey = view['idempotencyKey'];
    if (carriedKey !== key) return null;
    return parsed as LiveActionReceiptView;
  } catch {
    return null;
  }
}

const RECEIPT_LEDGER_CAP = 256;

function recordReceipt(host: LiveActionHost, view: LiveActionReceiptView): void {
  if (view.kind === 'malformed') return;
  const key = view.idempotencyKey;
  if (typeof key !== 'string' || key.length === 0) return;
  host.receiptLedger.set(key, view);
  if (host.receiptLedger.size > RECEIPT_LEDGER_CAP) {
    const oldest = host.receiptLedger.keys().next().value;
    if (typeof oldest === 'string') host.receiptLedger.delete(oldest);
  }
}

/**
 * THE submission pipeline: parse -> dispatch -> complete -> execute.
 * `now` is the caller-injected submission instant (the route handler
 * supplies the real clock; the deterministic suite injects fixed time).
 * Every receipt-bearing outcome is recorded into the in-process receipt
 * ledger (the PRG receipt page reads it back).
 */
export function submitLiveAction(input: { body: string; contentType: string; host: LiveActionHost; now: Timestamp }): LiveActionResult {
  const parsed = parseLiveActionBody({ contentType: input.contentType, text: input.body });
  if (!parsed.ok) {
    return { view: { kind: 'malformed', detail: parsed.detail }, httpStatus: 400 };
  }
  const dispatched = dispatchSubmission(parsed.parsed.envelope);
  if ('error' in dispatched) {
    return { view: { kind: 'malformed', detail: dispatched.error }, httpStatus: 400 };
  }
  let result: LiveActionResult;
  if (dispatched.kind === 'ask-resolution') {
    result = submitAskResolution(parsed.parsed.envelope as Record<string, unknown>, input.host, input.now);
  } else {
    result = submitGatewayAction(parsed.parsed.envelope as Record<string, unknown>, input.host, input.now);
  }
  recordReceipt(input.host, result.view);
  return result;
}

// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** RFC3339 from the INJECTED epoch (never an ambient clock). */
function isoTime(epochMs: Timestamp): string {
  return new Date(epochMs).toISOString();
}
