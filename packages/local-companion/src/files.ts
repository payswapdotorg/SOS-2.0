/**
 * THE PRIVATE WORKSPACE/FILE ACCESS SURFACE (Work Order P11).
 *
 * Every access runs the SAME uniform gate pipeline, in order:
 *
 *   1. SESSION  the companion session must be ACTIVE and its token must
 *               validate against the injected pairing authority (an
 *               unpaired/expired session is a typed
 *               COMPANION_UNAUTHENTICATED denial)
 *   2. SCOPE    the granted-scope check (resolveScopedPath — an unknown
 *               root, absolute path, '..' escape, read-only-root write or
 *               expired grant is a typed COMPANION_SCOPE_DENIED denial)
 *   3. PORT     the resolved access dispatches onto the INJECTABLE
 *               LocalFilePort (the real local filesystem attaches later
 *               through the same port; the reference implementation is an
 *               in-memory store — deterministic, offline-testable)
 *
 * Every access emits a provenance-labelled local observation
 * (local.workspace.read / local.workspace.wrote / local.scope.denied).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env — the
 * session, scope and file port are injected.
 */

import { companionDenial } from './denials.js';
import type { CompanionDenial, CompanionResult } from './denials.js';
import { resolveScopedPath, evaluateScopeGrants } from './scope.js';
import type { LocalObservationSink } from './observations.js';
import { nullObservationSink } from './observations.js';
import type { CompanionSessionRecord, CompanionSessionStatus } from './session.js';
import type { Clock } from '@sos-2/live-store';

/**
 * THE LOCAL FILE PORT — the injectable seam onto the user's private
 * filesystem. A real desktop companion implements this port against the
 * host filesystem (behind its own OS-level permissions); the reference
 * implementation is a deterministic in-memory store. Paths arriving here
 * are ALREADY scope-resolved ('<rootName>/<relative>').
 */
export interface LocalFilePort {
  /** Read one file (the scope-resolved '<rootName>/<relative>' path). Returns null when absent. */
  read(path: string): string | null;
  /** Write one file (returns the bytes written). */
  write(path: string, content: string): number;
  /** List the stored file paths (deterministic sorted order). */
  list(): readonly string[];
  /** Does the file exist? */
  exists(path: string): boolean;
}

/** An in-memory local file port (the LOCAL REFERENCE RUNTIME — deterministic, offline). */
export class InMemoryLocalFilePort implements LocalFilePort {
  private readonly files = new Map<string, string>();

  /** Seed the port with files (the pre-existing local workspace content). */
  seed(files: Readonly<Record<string, string>>): void {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, content);
    }
  }

  read(path: string): string | null {
    return this.files.get(path) ?? null;
  }

  write(path: string, content: string): number {
    const bytes = content.length;
    this.files.set(path, content);
    return bytes;
  }

  list(): readonly string[] {
    return [...this.files.keys()].sort();
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }
}

/** The input of one companion file read. */
export interface CompanionFileReadRequest {
  /** The companion file path: '<rootName>/<relative-path>'. */
  readonly path: string;
}

/** The input of one companion file write (a consequential operation — scope mode 'read-write' required). */
export interface CompanionFileWriteRequest {
  readonly path: string;
  readonly content: string;
}

/**
 * The session resolver the surface gates every access through — the
 * companion core supplies it; the status is re-evaluated per access
 * (never cached as truth).
 */
export interface CompanionSessionResolver {
  session(): CompanionSessionStatus;
}

/**
 * THE COMPANION FILESYSTEM SURFACE — session-gated, scope-gated private
 * workspace access over the injectable LocalFilePort.
 */
export class CompanionFilesystemSurface {
  private readonly port: LocalFilePort;
  private readonly resolver: CompanionSessionResolver;
  private readonly clock: Clock;
  private readonly sink: LocalObservationSink;

  constructor(deps: { readonly port: LocalFilePort; readonly resolver: CompanionSessionResolver; readonly clock: Clock; readonly sink?: LocalObservationSink }) {
    if (typeof deps !== 'object' || deps === null || typeof deps.port !== 'object' || deps.port === null) {
      throw new Error('the companion filesystem surface requires an injected LocalFilePort');
    }
    if (typeof deps.resolver !== 'object' || deps.resolver === null || typeof deps.resolver.session !== 'function') {
      throw new Error('the companion filesystem surface requires an injected session resolver');
    }
    if (typeof deps.clock !== 'object' || deps.clock === null || typeof deps.clock.nowEpochMs !== 'function') {
      throw new Error('the companion filesystem surface requires an injected clock (grants are re-evaluated before consequential operations)');
    }
    this.port = deps.port;
    this.resolver = deps.resolver;
    this.clock = deps.clock;
    this.sink = deps.sink ?? nullObservationSink();
  }

  read(request: CompanionFileReadRequest): CompanionResult<{ readonly content: string }> {
    const active = this.activeSession();
    if (active === null) {
      return unauthenticated(active);
    }
    // Grants are RE-EVALUATED before every consequential operation: an
    // expired grant authorizes NOTHING (fail-closed).
    const scoped = resolveScopedPath(evaluateScopeGrants(active.scopes, this.clock.nowEpochMs()), request.path, 'read');
    if (scoped.status === 'DENIED') {
      this.sink({ source: 'local-companion:filesystem', kind: 'local.scope.denied', payload: { boundary: 'filesystem', path: request.path, code: scoped.denial.code } });
      return { status: 'DENIED', denial: scoped.denial };
    }
    const content = this.port.read(request.path);
    if (content === null) {
      const denial = companionDenial(
        'COMPANION_SCOPE_DENIED',
        request.path,
        `no file exists at the granted path ${JSON.stringify(request.path)} on this local workspace — the access was in scope and the absence is a truthful denial, never a fabricated file`,
      );
      this.sink({ source: 'local-companion:filesystem', kind: 'local.scope.denied', payload: { boundary: 'filesystem', path: request.path, code: denial.code } });
      return { status: 'DENIED', denial };
    }
    this.sink({ source: 'local-companion:filesystem', kind: 'local.workspace.read', payload: { path: request.path } });
    return { status: 'OK', value: { content } };
  }

  write(request: CompanionFileWriteRequest): CompanionResult<{ readonly bytes: number }> {
    const active = this.activeSession();
    if (active === null) {
      return unauthenticated(active);
    }
    const scoped = resolveScopedPath(evaluateScopeGrants(active.scopes, this.clock.nowEpochMs()), request.path, 'write');
    if (scoped.status === 'DENIED') {
      this.sink({ source: 'local-companion:filesystem', kind: 'local.scope.denied', payload: { boundary: 'filesystem', path: request.path, code: scoped.denial.code } });
      return { status: 'DENIED', denial: scoped.denial };
    }
    const bytes = this.port.write(request.path, request.content);
    this.sink({ source: 'local-companion:filesystem', kind: 'local.workspace.wrote', payload: { path: request.path, bytes } });
    return { status: 'OK', value: { bytes } };
  }

  list(): CompanionResult<{ readonly paths: readonly string[] }> {
    const active = this.activeSession();
    if (active === null) {
      return unauthenticated(active);
    }
    // Listing is a read across every granted root: only paths whose root
    // is granted AND whose grant is still live appear (port content
    // outside granted scope is invisible — the companion cannot exceed
    // granted scope; grants are re-evaluated before the access).
    const liveGrants = evaluateScopeGrants(active.scopes, this.clock.nowEpochMs());
    const grantedRoots = new Set(liveGrants.flatMap((grant) => grant.roots.map((root) => root.name)));
    const paths = this.port.list().filter((path) => grantedRoots.has(path.split('/')[0] ?? ''));
    this.sink({ source: 'local-companion:filesystem', kind: 'local.workspace.listed', payload: { count: paths.length } });
    return { status: 'OK', value: { paths } };
  }

  /** The ACTIVE session record, or null when unpaired/expired (re-evaluated per access). */
  private activeSession(): CompanionSessionRecord | null {
    const status = this.resolver.session();
    if (status.status === 'ACTIVE') {
      return status.session;
    }
    this.sink({ source: 'local-companion:session', kind: 'local.scope.denied', payload: { boundary: 'session', code: 'COMPANION_UNAUTHENTICATED', session_status: status.status } });
    return null;
  }
}

/** The typed COMPANION_UNAUTHENTICATED denial (shared with the process surface). */
export function unauthenticatedDenial(): CompanionDenial {
  return companionDenial(
    'COMPANION_UNAUTHENTICATED',
    'companion-session',
    'the companion has no ACTIVE paired session — pair through the pairing authority first (the session is the gate; an expired or revoked session authorizes nothing)',
  );
}

function unauthenticated<T>(_active: null): CompanionResult<T> {
  return { status: 'DENIED', denial: unauthenticatedDenial() };
}
