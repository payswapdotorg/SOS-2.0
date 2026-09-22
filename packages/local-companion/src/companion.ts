/**
 * THE LOCAL COMPANION CORE (Work Order P11) — the authenticated local
 * companion contract assembled: pairing/session, granted-scope private
 * file access, local process integration, the durable local event log and
 * provenance-labelled observations.
 *
 * THE COMPANION IS A MECHANISM, NEVER AN AUTHORITY (the spirit/brain/body
 * rule): it cannot mint sessions (the pairing authority is injected), it
 * cannot mint or widen scope grants (they arrive immutable from pairing),
 * it cannot exceed granted scope (every access re-checks), and its
 * observations are provenance-labelled input — never semantic truth.
 *
 * The §9 Harness Contract surface over this core lives in
 * harness-body.ts (LocalCompanionBody) so the companion registers with
 * the P5 Body Broker behind the Execution Fabric like any body.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env — the
 * clock, authority, credential store, file port and process seam are
 * injected.
 */

import { InvalidCompanionContractError } from './errors.js';
import type { PairingOutcome, PairingRequest, PairingAuthority, CredentialStore, CompanionSessionRecord, CompanionSessionStatus } from './session.js';
import { evaluateCompanionSession } from './session.js';
import { InMemoryCredentialStore } from './session.js';
import { ReferencePairingAuthority } from './session.js';
import { CompanionFilesystemSurface } from './files.js';
import type { CompanionSessionResolver, LocalFilePort } from './files.js';
import { CompanionProcessSurface } from './process.js';
import type { LocalProcess } from './process.js';
import { SimulatedLocalProcess } from './process.js';
import { InMemoryLocalFilePort } from './files.js';
import { InMemoryLocalEventLog } from './observations.js';
import type { LocalEventLog, LocalEventRecord, LocalObservationInput } from './observations.js';
import type { Clock } from '@sos-2/live-store';
import { assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';

/** The local companion's device identity + injected seams. */
export interface LocalCompanionOptions {
  /** The companion's device identity (a RUNTIME identifier, never a semantic id). */
  readonly deviceId: string;
  /** A human-readable device label (provenance metadata only). */
  readonly deviceLabel: string;
  /** The INJECTED pairing authority (the companion cannot mint sessions itself). */
  readonly pairingAuthority: PairingAuthority;
  /** The INJECTED credential store (token VALUES live here and never echo). */
  readonly credentials: CredentialStore;
  /** The INJECTED local file port (the private workspace seam). */
  readonly files: LocalFilePort;
  /** The INJECTED local process seam (typed operation records; zero real spawning in the reference). */
  readonly process: LocalProcess;
  /** The INJECTED clock (no hidden time). */
  readonly clock: Clock;
  /** The durable local event log (defaults to the in-memory reference). */
  readonly eventLog?: LocalEventLog;
}

/** The honest session resolution (re-evaluated per access — never cached as truth). */
export type SessionResolution = CompanionSessionStatus;

/**
 * THE LOCAL COMPANION — the authenticated local mechanism. One active
 * session at a time (the reference pairing model); every surface access
 * re-evaluates the session AND the granted scope before consequential
 * operations.
 */
export class LocalCompanion {
  readonly deviceId: string;
  readonly deviceLabel: string;
  readonly eventLog: LocalEventLog;
  readonly files: CompanionFilesystemSurface;
  readonly process: CompanionProcessSurface;

  private readonly pairingAuthority: PairingAuthority;
  private readonly credentials: CredentialStore;
  private readonly clock: Clock;
  private currentSession: CompanionSessionRecord | null = null;

  constructor(options: LocalCompanionOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new InvalidCompanionContractError('local-companion', 'local companion options must be an object');
    }
    try {
      assertValidRuntimeIdentifier(options.deviceId, 'local companion deviceId');
    } catch (cause) {
      throw new InvalidCompanionContractError('local-companion', (cause as Error).message);
    }
    if (typeof options.deviceLabel !== 'string' || options.deviceLabel.length === 0) {
      throw new InvalidCompanionContractError('local-companion', `deviceLabel must be a non-empty string, received: ${JSON.stringify(options.deviceLabel)}`);
    }
    if (typeof options.pairingAuthority !== 'object' || options.pairingAuthority === null || typeof options.pairingAuthority.exchangePairingCode !== 'function') {
      throw new InvalidCompanionContractError('local-companion', 'the local companion requires an INJECTED pairing authority (the companion cannot mint sessions)');
    }
    if (typeof options.credentials !== 'object' || options.credentials === null || typeof options.credentials.store !== 'function') {
      throw new InvalidCompanionContractError('local-companion', 'the local companion requires an INJECTED credential store');
    }
    if (typeof options.files !== 'object' || options.files === null || typeof options.files.read !== 'function') {
      throw new InvalidCompanionContractError('local-companion', 'the local companion requires an INJECTED local file port');
    }
    if (typeof options.process !== 'object' || options.process === null || typeof options.process.exec !== 'function') {
      throw new InvalidCompanionContractError('local-companion', 'the local companion requires an INJECTED local process seam');
    }
    if (typeof options.clock !== 'object' || options.clock === null || typeof options.clock.nowEpochMs !== 'function') {
      throw new InvalidCompanionContractError('local-companion', 'the local companion requires an INJECTED clock (no hidden time)');
    }
    this.deviceId = options.deviceId;
    this.deviceLabel = options.deviceLabel;
    this.pairingAuthority = options.pairingAuthority;
    this.credentials = options.credentials;
    this.clock = options.clock;
    this.eventLog = options.eventLog ?? new InMemoryLocalEventLog({ deviceId: options.deviceId, clock: options.clock });

    const sink = (input: LocalObservationInput): void => {
      this.emitObservation(input);
    };
    const resolver: CompanionSessionResolver = { session: () => this.resolveSession() };
    this.files = new CompanionFilesystemSurface({ port: options.files, resolver, clock: options.clock, sink });
    this.process = new CompanionProcessSurface({
      process: options.process,
      fileView: () => ({
        // The process seam reads the SAME port the filesystem surface
        // dispatches onto — the private workspace view (scope checks gate
        // the surfaces; the seam sees only already-granted paths).
        read: (path) => options.files.read(path),
        list: () => options.files.list(),
      }),
      resolver,
      clock: options.clock,
      sink,
    });
  }

  /**
   * Pair the companion: exchange the pairing code with the injected
   * authority, store the session token VALUE straight into the credential
   * store (it never echoes), and adopt the granted scopes. The typed
   * outcome carries the SESSION RECORD (token NAME only).
   */
  pair(request: PairingRequest): PairingOutcome {
    const exchange = this.pairingAuthority.exchangePairingCode(request, this.clock.nowEpochMs());
    if ('refused' in exchange) {
      this.emitObservation({ source: 'local-companion:session', kind: 'local.session.pairing-refused', payload: { reason: exchange.refused } });
      return { status: 'DENIED', reason: exchange.refused };
    }
    this.credentials.store(exchange.session.token_name, exchange.token_value);
    this.currentSession = exchange.session;
    this.emitObservation({
      source: 'local-companion:session',
      kind: 'local.session.paired',
      payload: { session_id: exchange.session.session_id, token_name: exchange.session.token_name, scope_grants: exchange.session.scopes.map((grant) => grant.grant_id) },
    });
    return { status: 'PAIRED', session: exchange.session };
  }

  /** End the current session (the token value dies with the session). */
  endSession(reason: string): void {
    if (this.currentSession === null) {
      return;
    }
    this.credentials.drop(this.currentSession.token_name);
    this.emitObservation({ source: 'local-companion:session', kind: 'local.session.ended', payload: { session_id: this.currentSession.session_id, reason } });
    this.currentSession = null;
  }

  /** The CURRENT session status — re-evaluated (expiry + token validation), never cached as truth. */
  session(): SessionResolution {
    return this.resolveSession();
  }
  /** Emit one provenance-labelled local observation into the durable local event log. */
  emitObservation(input: LocalObservationInput): LocalEventRecord {
    return this.eventLog.append(input);
  }

  /** The private session token validation (values never leave this seam). */
  private resolveSession(): SessionResolution {
    if (this.currentSession === null) {
      return { status: 'UNPAIRED', session: null };
    }
    const evaluated = evaluateCompanionSession(this.currentSession, this.clock.nowEpochMs());
    if (evaluated.status !== 'ACTIVE') {
      return evaluated;
    }
    const token = this.credentials.resolve(this.currentSession.token_name);
    if (token === null) {
      return { status: 'REVOKED', session: null };
    }
    const validation = this.pairingAuthority.validateSessionToken(token);
    if (!validation.valid || validation.session_id !== this.currentSession.session_id) {
      return { status: 'REVOKED', session: null };
    }
    return { status: 'ACTIVE', session: this.currentSession };
  }
}

/** Compose a REFERENCE local companion: the deterministic in-process seams. */
export function createReferenceLocalCompanion(deps: {
  readonly deviceId: string;
  readonly deviceLabel: string;
  readonly clock: Clock;
  readonly pairingCodes?: readonly { code: string; scopes: readonly import('./scope.js').CompanionScopeGrant[]; sessionDurationMs: number | null }[];
  readonly files?: Readonly<Record<string, string>>;
}): { companion: LocalCompanion; credentials: InMemoryCredentialStore; authority: ReferencePairingAuthority; filePort: InMemoryLocalFilePort; processSeam: SimulatedLocalProcess } {
  const credentials = new InMemoryCredentialStore();
  const authority = new ReferencePairingAuthority(
    deps.pairingCodes ?? [
      {
        code: 'pair-local-0001',
        scopes: [
          {
            grant_id: 'grant-local-workspace',
            roots: [
              { name: 'acme', mode: 'read-write' },
              { name: 'notes', mode: 'read' },
            ],
            process_allowlist: ['echo', 'cat', 'ls', 'pwd'],
            granted_by: 'user:pairing',
            granted_at: '2026-01-15T09:00:00Z',
            expires_at: null,
          },
        ],
        sessionDurationMs: null,
      },
    ],
  );
  const filePort = new InMemoryLocalFilePort();
  if (deps.files !== undefined) {
    filePort.seed(deps.files);
  }
  const processSeam = new SimulatedLocalProcess();
  const companion = new LocalCompanion({
    deviceId: deps.deviceId,
    deviceLabel: deps.deviceLabel,
    pairingAuthority: authority,
    credentials,
    files: filePort,
    process: processSeam,
    clock: deps.clock,
  });
  return { companion, credentials, authority, filePort, processSeam };
}
