/**
 * THE GRANTED-SCOPE MODEL (Work Order P11) — the private workspace/file
 * access boundary of the local companion, as INJECTED DATA.
 *
 * THE COMPANION CANNOT EXCEED GRANTED SCOPE: every file access resolves
 * through the session's scope grants — a granted-scope check runs before
 * EVERY access (unknown root, absolute path, '..' escape, a read-only root
 * asked to write, or an expired grant is a typed COMPANION_SCOPE_DENIED
 * denial — never silent, never a crash). Grants are re-evaluated against
 * the injected clock before consequential operations (an expired grant
 * authorizes NOTHING — the fail-closed authority-gate discipline).
 *
 * The companion cannot mint or widen these grants: they arrive from the
 * pairing authority (injected) and are immutable typed records. There is
 * deliberately NO operation on this module that creates or extends a
 * grant from inside the companion.
 *
 * PATH DISCIPLINE (the P8 sandbox scope semantics applied to the user's
 * machine): a companion file path is '<rootName>/<relative-path>' where
 * rootName names a granted root and the relative path is workspace-style
 * (no leading '/', no '..' segments, no empty segments).
 */

import { companionDenial } from './denials.js';
import type { CompanionDenial, CompanionResult } from './denials.js';
import { InvalidCompanionContractError } from './errors.js';

/** The access mode of one granted root. */
export const COMPANION_SCOPE_ROOT_MODES = ['read', 'read-write'] as const;

export type CompanionScopeRootMode = (typeof COMPANION_SCOPE_ROOT_MODES)[number];

const ROOT_MODE_SET: ReadonlySet<string> = new Set(COMPANION_SCOPE_ROOT_MODES);

/** One granted workspace root: a name (the path's first segment) + the mode it grants. */
export interface CompanionScopeRoot {
  /** The root name — the first segment of a companion file path (non-empty, path-free). */
  readonly name: string;
  /** The access mode granted on this root. */
  readonly mode: CompanionScopeRootMode;
}

/**
 * ONE SCOPE GRANT — an immutable typed record granted by the pairing
 * authority. The companion can neither mint nor widen it.
 */
export interface CompanionScopeGrant {
  /** Grant identity — a RUNTIME identifier (never a SOS semantic identity). */
  readonly grant_id: string;
  /** The granted workspace roots (at least one). */
  readonly roots: readonly CompanionScopeRoot[];
  /** The granted local process command names (the process allowlist; empty = no process grant). */
  readonly process_allowlist: readonly string[];
  /** WHO granted it (provenance — e.g. 'user:pairing'). */
  readonly granted_by: string;
  /** When it was granted (RFC3339, injected clock). */
  readonly granted_at: string;
  /** Grant expiry (RFC3339) — re-evaluated before consequential operations; null = non-expiring. */
  readonly expires_at: string | null;
}

const SCOPE_NAMESPACE = 'companion-scope';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(value);
}

function isPathFreeName(value: string): boolean {
  return value.length > 0 && !/\s/.test(value) && !value.includes('/') && !value.includes('\\') && !value.startsWith('.');
}

/** Validate one scope grant (throws InvalidCompanionContractError). */
export function assertValidCompanionScopeGrant(value: unknown): asserts value is CompanionScopeGrant {
  if (!isPlainObject(value)) {
    throw new InvalidCompanionContractError(SCOPE_NAMESPACE, 'a companion scope grant must be an object');
  }
  const expected = ['grant_id', 'roots', 'process_allowlist', 'granted_by', 'granted_at', 'expires_at'];
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidCompanionContractError(
      SCOPE_NAMESPACE,
      `a companion scope grant must have the exact field set { ${expected.join(', ')} }`,
    );
  }
  if (!isNonEmptyString(value['grant_id']) || value['grant_id'].includes('sos://')) {
    throw new InvalidCompanionContractError(
      SCOPE_NAMESPACE,
      `grant_id must be a non-empty RUNTIME identifier (never a sos:// semantic identity), received: ${JSON.stringify(value['grant_id'])}`,
    );
  }
  const roots = value['roots'];
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new InvalidCompanionContractError(SCOPE_NAMESPACE, 'a scope grant must carry at least one granted root');
  }
  const seenRoots = new Set<string>();
  for (const root of roots) {
    if (!isPlainObject(root) || Object.keys(root).length !== 2 || !Object.prototype.hasOwnProperty.call(root, 'name') || !Object.prototype.hasOwnProperty.call(root, 'mode')) {
      throw new InvalidCompanionContractError(SCOPE_NAMESPACE, `every granted root must be { name, mode }, received: ${JSON.stringify(root)}`);
    }
    if (!isPathFreeName(String(root['name']))) {
      throw new InvalidCompanionContractError(
        SCOPE_NAMESPACE,
        `a granted root name must be non-empty and path-free (it is the first path segment), received: ${JSON.stringify(root['name'])}`,
      );
    }
    if (!ROOT_MODE_SET.has(String(root['mode']))) {
      throw new InvalidCompanionContractError(
        SCOPE_NAMESPACE,
        `a granted root mode must be one of ${COMPANION_SCOPE_ROOT_MODES.join(' | ')}, received: ${JSON.stringify(root['mode'])}`,
      );
    }
    if (seenRoots.has(String(root['name']))) {
      throw new InvalidCompanionContractError(SCOPE_NAMESPACE, `duplicate granted root name ${JSON.stringify(root['name'])}`);
    }
    seenRoots.add(String(root['name']));
  }
  const allowlist = value['process_allowlist'];
  if (!Array.isArray(allowlist) || !allowlist.every((entry) => isNonEmptyString(entry) && isPathFreeName(entry))) {
    throw new InvalidCompanionContractError(
      SCOPE_NAMESPACE,
      'process_allowlist must be an array of non-empty, path-free command names (the granted consequential operations)',
    );
  }
  if (new Set(allowlist as string[]).size !== (allowlist as string[]).length) {
    throw new InvalidCompanionContractError(SCOPE_NAMESPACE, 'process_allowlist must be duplicate-free');
  }
  if (!isNonEmptyString(value['granted_by'])) {
    throw new InvalidCompanionContractError(SCOPE_NAMESPACE, `granted_by must be a non-empty provenance string, received: ${JSON.stringify(value['granted_by'])}`);
  }
  if (!isRfc3339(value['granted_at'])) {
    throw new InvalidCompanionContractError(SCOPE_NAMESPACE, `granted_at must be an RFC3339 timestamp, received: ${JSON.stringify(value['granted_at'])}`);
  }
  if (value['expires_at'] !== null && !isRfc3339(value['expires_at'])) {
    throw new InvalidCompanionContractError(SCOPE_NAMESPACE, `expires_at must be null or an RFC3339 timestamp, received: ${JSON.stringify(value['expires_at'])}`);
  }
}

/** Validate a list of scope grants (throws InvalidCompanionContractError). */
export function assertValidScopeGrants(value: unknown): asserts value is readonly CompanionScopeGrant[] {
  if (!Array.isArray(value)) {
    throw new InvalidCompanionContractError(SCOPE_NAMESPACE, 'scope grants must be an array');
  }
  const seen = new Set<string>();
  for (const grant of value) {
    assertValidCompanionScopeGrant(grant);
    if (seen.has(grant.grant_id)) {
      throw new InvalidCompanionContractError(SCOPE_NAMESPACE, `duplicate scope grant id ${JSON.stringify(grant.grant_id)}`);
    }
    seen.add(grant.grant_id);
  }
}

/**
 * Re-evaluate scope grants at an instant — an expired grant authorizes
 * NOTHING (fail-closed; grants are re-evaluated before every consequential
 * operation, never cached as truth).
 */
export function evaluateScopeGrants(grants: readonly CompanionScopeGrant[], nowEpochMs: number): readonly CompanionScopeGrant[] {
  return grants.filter((grant) => grant.expires_at === null || Date.parse(grant.expires_at) > nowEpochMs);
}

/** The resolved target of one in-scope file access. */
export interface ScopedPath {
  /** The granted root the access resolved into. */
  readonly root: CompanionScopeRoot;
  /** The workspace-style relative path under the root (no leading '/', no '..' segments). */
  readonly relative_path: string;
}

const SEGMENT_PATTERN = /^(?!.*(^|\/)\.\.($|\/))[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * THE GRANTED-SCOPE CHECK: resolve a companion file path against the
 * active grants for the requested access mode. The path must be
 * '<rootName>/<relative-path>' with a workspace-style relative path —
 * unknown root, absolute path, '..' escape, wrong mode or an expired
 * grant is a typed COMPANION_SCOPE_DENIED denial (never silent).
 */
export function resolveScopedPath(
  grants: readonly CompanionScopeGrant[],
  path: string,
  mode: 'read' | 'write',
): CompanionResult<ScopedPath> {
  if (typeof path !== 'string' || path.length === 0) {
    return scopeDenied(path, 'the path is empty — a companion file path must be <rootName>/<relative-path>');
  }
  if (path.startsWith('/') || path.startsWith('\\')) {
    return scopeDenied(path, 'absolute paths are outside the granted-scope model — companion file paths are root-relative (never absolute)');
  }
  if (path.includes('\\')) {
    return scopeDenied(path, 'backslash paths are outside the granted-scope model — companion file paths use forward-slash root-relative segments');
  }
  const separator = path.indexOf('/');
  if (separator <= 0) {
    return scopeDenied(path, 'the path names no granted root — a companion file path must be <rootName>/<relative-path>');
  }
  const rootName = path.slice(0, separator);
  const relative = path.slice(separator + 1);
  if (relative.length === 0) {
    return scopeDenied(path, 'the path names no file under the granted root');
  }
  if (!SEGMENT_PATTERN.test(relative) || relative.split('/').some((segment) => segment === '.' || segment === '..')) {
    return scopeDenied(path, `the relative path ${JSON.stringify(relative)} escapes the granted-scope discipline ('..' segments and dot-segments are denied)`);
  }
  for (const grant of grants) {
    for (const root of grant.roots) {
      if (root.name === rootName) {
        if (mode === 'write' && root.mode !== 'read-write') {
          return scopeDenied(path, `the granted root ${JSON.stringify(rootName)} carries mode ${JSON.stringify(root.mode)} — writing a read-only root is an un-granted consequential operation`);
        }
        return { status: 'OK', value: { root, relative_path: relative } };
      }
    }
  }
  return scopeDenied(
    path,
    `no granted scope covers root ${JSON.stringify(rootName)} (granted roots: ${grants.flatMap((grant) => grant.roots.map((root) => root.name)).join(', ') || 'none'}) — the companion cannot exceed granted scope`,
  );
}

function scopeDenied(path: string, reason: string): CompanionResult<ScopedPath> {
  return { status: 'DENIED', denial: companionDenial('COMPANION_SCOPE_DENIED', path, reason) };
}

/** The typed denial for an un-granted consequential process operation. */
export function processDenied(command: string): CompanionDenial {
  return companionDenial(
    'COMPANION_PROCESS_DENIED',
    command,
    `the command ${JSON.stringify(command)} is not granted by the session's process allowlist — an un-granted consequential operation is a typed denial, never a silent run`,
  );
}

/** Is a command granted by the active scope grants? */
export function isProcessGranted(grants: readonly CompanionScopeGrant[], command: string): boolean {
  return grants.some((grant) => grant.process_allowlist.includes(command));
}
