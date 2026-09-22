/**
 * THE COMPANION SESSION/AUTHENTICATION CONTRACT (Work Order P11) — pairing
 * + session records as typed records over INJECTED seams.
 *
 * THE COMPANION CANNOT MINT SESSIONS OR AUTHORITY: pairing codes are
 * validated and session grants are minted by an INJECTED PairingAuthority
 * (the user/cloud side of the handshake); the reference implementation is
 * a deterministic in-process fake (real pairing endpoints attach later
 * through the same port without contract change). This mirrors the frozen
 * rule that bodies cannot mint or widen authority — the companion is a
 * replaceable local mechanism, never an authority.
 *
 * TOKEN VALUES NEVER ECHO: the pairing exchange produces a session token
 * VALUE that goes STRAIGHT into the injected CredentialStore under a NAME;
 * every typed record (session record, pairing result, observation, event,
 * denial) carries the token NAME only — never the value (the P8 sandbox
 * secrets discipline: values are never echoed, logged or serialized).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env — the clock
 * is injected and the reference authority derives deterministic ids/tokens
 * from injected data + sequences.
 */

import { InvalidCompanionContractError } from './errors.js';
import type { CompanionScopeGrant } from './scope.js';
import { assertValidScopeGrants } from './scope.js';
import { formatRfc3339 } from '@sos-2/live-store';
import { assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';

// ---------------------------------------------------------------------------
// The pairing authority port (INJECTED — the companion cannot mint it)
// ---------------------------------------------------------------------------

/** The pairing handshake input: the code the user supplies + the device identity. */
export interface PairingRequest {
  /** The pairing code (supplied by the user; validated by the authority). */
  readonly pairing_code: string;
  /** The companion's device identity (a RUNTIME identifier, never a semantic id). */
  readonly device_id: string;
  /** A human-readable device label (provenance metadata only). */
  readonly device_label: string;
}

/** The outcome of one pairing-code exchange. */
export type PairingOutcome =
  | {
      readonly status: 'PAIRED';
      /** The session record (carries the token NAME only — never the value). */
      readonly session: CompanionSessionRecord;
    }
  | {
      /** The authority refused the pairing code — typed, truthful, never silent. */
      readonly status: 'DENIED';
      readonly reason: string;
    };

/** The internal exchange result: the token VALUE transits to the credential store and never surfaces again. */
export interface PairingExchange {
  /** The minted session (typed record; token NAME only). */
  readonly session: CompanionSessionRecord;
  /** The session token VALUE — consumed by the credential store, never echoed/logged/serialized. */
  readonly token_value: string;
}

/**
 * THE PAIRING AUTHORITY PORT — the injected authority side of the
 * handshake. Real cloud pairing endpoints implement this port; the
 * reference implementation is a deterministic in-process fake. The
 * companion itself has NO ability to mint sessions, grants or authority.
 */
export interface PairingAuthority {
  /** Validate a pairing code and mint the session + token (typed refusal when the code is unknown/expired). */
  exchangePairingCode(request: PairingRequest, nowEpochMs: number): PairingExchange | { refused: string };
  /** Validate a session token VALUE → the session it authenticates (values never leave this seam). */
  validateSessionToken(tokenValue: string): { valid: boolean; session_id: string | null };
}

// ---------------------------------------------------------------------------
// The credential store port (INJECTED — names out, values never out)
// ---------------------------------------------------------------------------

/**
 * THE CREDENTIAL STORE PORT — where session token VALUES live. The store
 * resolves values ONLY inside the session-validation seam; there is
 * deliberately NO value-revealing operation on this port (the P8 sandbox
 * secrets discipline: only NAMES are ever declared).
 */
export interface CredentialStore {
  /** Store a credential value under a NAME (overwrites silently — names are stable). */
  store(name: string, value: string): void;
  /** Resolve a credential value by NAME — ONLY inside the authentication seam, never surfaced. */
  resolve(name: string): string | null;
  /** The declared credential NAMES (never values). */
  names(): readonly string[];
  /** Drop a credential by NAME (session end — the value dies with the session). */
  drop(name: string): void;
}

/** An in-memory credential store (tests + local development; values never echo). */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  store(name: string, value: string): void {
    assertNonEmpty(name, 'credential name');
    assertNonEmpty(value, 'credential value');
    this.values.set(name, value);
  }

  resolve(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  names(): readonly string[] {
    return [...this.values.keys()].sort();
  }

  drop(name: string): void {
    this.values.delete(name);
  }
}

// ---------------------------------------------------------------------------
// The session record
// ---------------------------------------------------------------------------

/** One paired companion session (typed record — token NAME only, never the value). */
export interface CompanionSessionRecord {
  /** Session identity — a RUNTIME identifier (never a SOS semantic identity). */
  readonly session_id: string;
  /** The authenticated device identity. */
  readonly device_id: string;
  /** The device label (provenance metadata only). */
  readonly device_label: string;
  /** The session token NAME — the VALUE lives in the credential store and never echoes. */
  readonly token_name: string;
  /** The scope grants this session acts under (granted at pairing; re-evaluated before consequential operations). */
  readonly scopes: readonly CompanionScopeGrant[];
  /** When the session was paired (RFC3339, injected clock). */
  readonly paired_at: string;
  /** Session expiry (RFC3339), or null for a non-expiring session. */
  readonly expires_at: string | null;
}

/** The honest session status — re-evaluated against the injected clock, never cached as truth. */
export type CompanionSessionStatus =
  | { readonly status: 'ACTIVE'; readonly session: CompanionSessionRecord }
  | { readonly status: 'EXPIRED'; readonly session: CompanionSessionRecord }
  | { readonly status: 'REVOKED'; readonly session: null }
  | { readonly status: 'UNPAIRED'; readonly session: null };

const SESSION_NAMESPACE = 'companion-session';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function assertNonEmpty(value: string, what: string): void {
  if (value.length === 0) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, `${what} must be non-empty`);
  }
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(value);
}

/** Validate a session record (throws InvalidCompanionContractError). */
export function assertValidCompanionSessionRecord(value: unknown): asserts value is CompanionSessionRecord {
  if (!isPlainObject(value)) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, 'a companion session record must be an object');
  }
  const expected = ['session_id', 'device_id', 'device_label', 'token_name', 'scopes', 'paired_at', 'expires_at'];
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidCompanionContractError(
      SESSION_NAMESPACE,
      `a companion session record must have the exact field set { ${expected.join(', ')} }`,
    );
  }
  try {
    assertValidRuntimeIdentifier(value['session_id'], 'companion session session_id');
  } catch (cause) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, (cause as Error).message);
  }
  try {
    assertValidRuntimeIdentifier(value['device_id'], 'companion session device_id');
  } catch (cause) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, (cause as Error).message);
  }
  if (!isNonEmpty(value['device_label'])) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, `device_label must be a non-empty string, received: ${JSON.stringify(value['device_label'])}`);
  }
  if (!isNonEmpty(value['token_name'])) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, `token_name must be a non-empty string (the VALUE lives in the credential store and never echoes)`);
  }
  assertValidScopeGrants(value['scopes']);
  if (!isRfc3339(value['paired_at'])) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, `paired_at must be an RFC3339 timestamp, received: ${JSON.stringify(value['paired_at'])}`);
  }
  if (value['expires_at'] !== null && !isRfc3339(value['expires_at'])) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, `expires_at must be null or an RFC3339 timestamp, received: ${JSON.stringify(value['expires_at'])}`);
  }
}

/** Re-evaluate a session record against an instant (the honest status — never cached). */
export function evaluateCompanionSession(session: CompanionSessionRecord | null, nowEpochMs: number): CompanionSessionStatus {
  if (session === null) {
    return { status: 'UNPAIRED', session: null };
  }
  if (session.expires_at !== null && Date.parse(session.expires_at) <= nowEpochMs) {
    return { status: 'EXPIRED', session };
  }
  return { status: 'ACTIVE', session };
}

/** Validate a pairing request (throws InvalidCompanionContractError). */
export function assertValidPairingRequest(value: unknown): asserts value is PairingRequest {
  if (!isPlainObject(value)) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, 'a pairing request must be an object');
  }
  const expected = ['pairing_code', 'device_id', 'device_label'];
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, `a pairing request must have the exact field set { ${expected.join(', ')} }`);
  }
  if (!isNonEmpty(value['pairing_code'])) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, `pairing_code must be a non-empty string, received: ${JSON.stringify(value['pairing_code'])}`);
  }
  try {
    assertValidRuntimeIdentifier(value['device_id'], 'pairing request device_id');
  } catch (cause) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, (cause as Error).message);
  }
  if (!isNonEmpty(value['device_label'])) {
    throw new InvalidCompanionContractError(SESSION_NAMESPACE, `device_label must be a non-empty string, received: ${JSON.stringify(value['device_label'])}`);
  }
}

// ---------------------------------------------------------------------------
// The reference pairing authority (deterministic in-process fake)
// ---------------------------------------------------------------------------

/** One admitted pairing code of the reference authority: the code + the scopes it grants. */
export interface ReferencePairingCode {
  /** The pairing code (non-empty). */
  readonly code: string;
  /** The scope grants the code grants (validated). */
  readonly scopes: readonly CompanionScopeGrant[];
  /** How long the minted session stays valid (ms), or null for non-expiring. */
  readonly sessionDurationMs: number | null;
}

/**
 * The REFERENCE pairing authority — a deterministic in-process fake: the
 * admitted codes are INJECTED (an allowlist of typed records); token
 * values are deterministic sequences; sessions are validated by exact
 * token match. NO real cloud pairing endpoint exists in this Work Order —
 * real endpoints attach later through the same port without contract
 * change, and connection evidence is never fabricated.
 */
export class ReferencePairingAuthority implements PairingAuthority {
  private readonly codes: ReadonlyMap<string, ReferencePairingCode>;
  private readonly sessions = new Map<string, { token: string; record: CompanionSessionRecord }>();
  private readonly tokens = new Map<string, string>();
  private sequence = 0;

  constructor(codes: readonly ReferencePairingCode[]) {
    if (!Array.isArray(codes) || codes.length === 0) {
      throw new InvalidCompanionContractError(
        'reference-pairing-authority',
        'the reference pairing authority requires a non-empty injected allowlist of pairing codes',
      );
    }
    const seen = new Set<string>();
    for (const entry of codes) {
      if (typeof entry !== 'object' || entry === null || typeof entry.code !== 'string' || entry.code.length === 0) {
        throw new InvalidCompanionContractError('reference-pairing-authority', 'every reference pairing code must carry a non-empty code');
      }
      assertValidScopeGrants(entry.scopes);
      if (seen.has(entry.code)) {
        throw new InvalidCompanionContractError('reference-pairing-authority', `duplicate pairing code ${JSON.stringify(entry.code)}`);
      }
      seen.add(entry.code);
    }
    this.codes = new Map(codes.map((entry) => [entry.code, entry]));
  }

  exchangePairingCode(request: PairingRequest, nowEpochMs: number): PairingExchange | { refused: string } {
    assertValidPairingRequest(request);
    const admitted = this.codes.get(request.pairing_code);
    if (admitted === undefined) {
      return { refused: `the pairing authority does not know pairing code ${JSON.stringify(request.pairing_code)} — pairing refused (never a fabricated session)` };
    }
    this.sequence += 1;
    const sessionId = `companion-session-${String(this.sequence).padStart(4, '0')}`;
    const tokenName = `companion-session-token:${sessionId}`;
    // Deterministic token value — a real authority would mint an opaque
    // secret; this REFERENCE value never echoes outside the credential
    // store seam (pinned by output scans).
    const tokenValue = `reference-session-token-${String(this.sequence).padStart(4, '0')}`;
    const pairedAt = formatRfc3339(nowEpochMs);
    const record: CompanionSessionRecord = {
      session_id: sessionId,
      device_id: request.device_id,
      device_label: request.device_label,
      token_name: tokenName,
      scopes: structuredClone(admitted.scopes as unknown as readonly CompanionScopeGrant[]),
      paired_at: pairedAt,
      expires_at: admitted.sessionDurationMs === null ? null : formatRfc3339(nowEpochMs + admitted.sessionDurationMs),
    };
    assertValidCompanionSessionRecord(record);
    this.sessions.set(sessionId, { token: tokenValue, record });
    this.tokens.set(tokenValue, sessionId);
    return { session: record, token_value: tokenValue };
  }

  validateSessionToken(tokenValue: string): { valid: boolean; session_id: string | null } {
    const sessionId = this.tokens.get(tokenValue) ?? null;
    return { valid: sessionId !== null, session_id: sessionId };
  }
}
