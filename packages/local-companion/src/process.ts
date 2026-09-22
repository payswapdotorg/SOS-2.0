/**
 * THE LOCAL SHELL/PROCESS INTEGRATION (Work Order P11) — typed operation
 * records through an INJECTABLE LocalProcess seam.
 *
 * ZERO REAL PROCESS SPAWNING IN LIBRARY CODE: the reference
 * implementation is a deterministic in-process simulator with an
 * INJECTABLE COMMAND REGISTRY (typed LocalCommand entries — the P8
 * ShellSimulator precedent). A real desktop companion's process bridge
 * implements the same seam later without contract change.
 *
 * EVERY execution runs the gate pipeline: SESSION (typed
 * COMPANION_UNAUTHENTICATED when not ACTIVE) -> PROCESS GRANT (a command
 * outside the session's process allowlist is a typed
 * COMPANION_PROCESS_DENIED denial — an un-granted consequential operation
 * never runs) -> SEAM (the typed operation record). Every execution
 * emits a provenance-labelled local observation.
 */

import { companionOk } from './denials.js';
import type { CompanionResult } from './denials.js';
import { evaluateScopeGrants, isProcessGranted, processDenied } from './scope.js';
import type { LocalObservationSink } from './observations.js';
import { nullObservationSink } from './observations.js';
import type { CompanionSessionRecord } from './session.js';
import type { CompanionSessionResolver } from './files.js';
import { unauthenticatedDenial } from './files.js';
import type { JsonValue } from '@sos-2/semantic-spine';
import type { Clock } from '@sos-2/live-store';

/** The deterministic typed outcome of one local process operation. */
export interface LocalProcessResult {
  readonly exit_code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The input of one local process operation (a consequential operation — the command must be granted). */
export interface LocalProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  /** Working directory (a companion root-relative path), or null for the workspace base. */
  readonly cwd: string | null;
}

/**
 * THE LOCAL PROCESS SEAM — the injectable port a real desktop companion's
 * process bridge implements. The reference implementation is the
 * deterministic simulator below; neither spawns a real process.
 */
export interface LocalProcess {
  exec(request: LocalProcessRequest, context: LocalCommandContext): LocalProcessResult;
}

/** The context a simulated local command runs within (the local workspace view). */
export interface LocalCommandContext {
  /** Read one local file through the scope-resolved view (or null when absent). */
  readLocalFile(path: string): string | null;
  /** List local file paths (deterministic order). */
  listLocalFiles(): readonly string[];
  /** Emit one body-side local event (typed record; never carries secret values). */
  emitLocalEvent(kind: string, payload: JsonValue): void;
}

/** One simulated local command (the injectable registry entry). */
export interface LocalCommand {
  /** The command name (non-empty, whitespace-free, no path separators). */
  readonly name: string;
  /** Deterministic execution of the command. */
  run(args: readonly string[], context: LocalCommandContext): LocalProcessResult;
}

function isValidCommandName(name: string): boolean {
  return name.length > 0 && !/\s/.test(name) && !name.includes('/') && !name.includes('\\');
}

/** The built-in deterministic local command registry: echo, cat, ls, pwd. */
export function builtinLocalCommands(): LocalCommand[] {
  return [
    {
      name: 'echo',
      run: (args) => localOk(args.join(' ')),
    },
    {
      name: 'cat',
      run: (args, context) => {
        const path = args[0];
        if (path === undefined) {
          return localErr(2, 'cat: missing file operand');
        }
        const content = context.readLocalFile(path);
        if (content === null) {
          return localErr(1, `cat: ${path}: no such file`);
        }
        return localOk(content);
      },
    },
    {
      name: 'ls',
      run: (_args, context) => localOk(context.listLocalFiles().join('\n')),
    },
    {
      name: 'pwd',
      run: () => localOk('/local/workspace'),
    },
  ];
}

function localOk(stdout: string): LocalProcessResult {
  return { exit_code: 0, stdout, stderr: '' };
}

function localErr(exitCode: number, stderr: string): LocalProcessResult {
  return { exit_code: exitCode, stdout: '', stderr };
}

/**
 * THE SIMULATED LOCAL PROCESS — the deterministic in-process reference
 * runtime: command dispatch onto an injectable registry; an unknown
 * command answers exit code 127 (command not found), the same truthful
 * convention as a real shell. NO real process is ever spawned.
 */
export class SimulatedLocalProcess implements LocalProcess {
  private readonly commands: ReadonlyMap<string, LocalCommand>;

  constructor(commands: readonly LocalCommand[] = builtinLocalCommands()) {
    const seen = new Set<string>();
    for (const command of commands) {
      if (typeof command !== 'object' || command === null || typeof command.name !== 'string' || typeof command.run !== 'function') {
        throw new Error(`every local command registry entry must be { name, run }, received: ${JSON.stringify(command)}`);
      }
      if (!isValidCommandName(command.name)) {
        throw new Error(`local command name must be non-empty and path-free, received: ${JSON.stringify(command.name)}`);
      }
      if (seen.has(command.name)) {
        throw new Error(`duplicate local command name: ${JSON.stringify(command.name)}`);
      }
      seen.add(command.name);
    }
    this.commands = new Map(commands.map((command) => [command.name, command]));
  }

  /** The registry's command names (deterministic order — audit). */
  commandNames(): readonly string[] {
    return [...this.commands.keys()];
  }

  exec(request: LocalProcessRequest, context: LocalCommandContext): LocalProcessResult {
    if (typeof request.command !== 'string' || request.command.length === 0) {
      return localErr(2, 'empty command');
    }
    const entry = this.commands.get(request.command);
    if (entry === undefined) {
      return localErr(127, `command not found: ${request.command}`);
    }
    if (!Array.isArray(request.args) || !request.args.every((arg) => typeof arg === 'string')) {
      return localErr(2, `invalid arguments for ${request.command}`);
    }
    return entry.run(request.args, context);
  }
}

/**
 * THE COMPANION PROCESS SURFACE — session-gated, allowlist-gated local
 * process operations over the injectable LocalProcess seam.
 */
export class CompanionProcessSurface {
  private readonly process: LocalProcess;
  private readonly fileView: () => { read(path: string): string | null; list(): readonly string[] };
  private readonly resolver: CompanionSessionResolver;
  private readonly clock: Clock;
  private readonly sink: LocalObservationSink;

  constructor(deps: {
    readonly process: LocalProcess;
    readonly fileView: () => { read(path: string): string | null; list(): readonly string[] };
    readonly resolver: CompanionSessionResolver;
    readonly clock: Clock;
    readonly sink?: LocalObservationSink;
  }) {
    if (typeof deps !== 'object' || deps === null || typeof deps.process !== 'object' || typeof deps.process.exec !== 'function') {
      throw new Error('the companion process surface requires an injected LocalProcess seam');
    }
    if (typeof deps.fileView !== 'function') {
      throw new Error('the companion process surface requires an injected local file view');
    }
    if (typeof deps.resolver !== 'object' || deps.resolver === null || typeof deps.resolver.session !== 'function') {
      throw new Error('the companion process surface requires an injected session resolver');
    }
    if (typeof deps.clock !== 'object' || deps.clock === null || typeof deps.clock.nowEpochMs !== 'function') {
      throw new Error('the companion process surface requires an injected clock (grants are re-evaluated before consequential operations)');
    }
    this.process = deps.process;
    this.fileView = deps.fileView;
    this.resolver = deps.resolver;
    this.clock = deps.clock;
    this.sink = deps.sink ?? nullObservationSink();
  }

  exec(request: LocalProcessRequest): CompanionResult<LocalProcessResult> {
    const status = this.resolver.session();
    if (status.status !== 'ACTIVE') {
      this.sink({ source: 'local-companion:process', kind: 'local.scope.denied', payload: { boundary: 'session', code: 'COMPANION_UNAUTHENTICATED', session_status: status.status } });
      return { status: 'DENIED', denial: unauthenticatedDenial() };
    }
    const session: CompanionSessionRecord = status.session;
    if (typeof request.command !== 'string' || request.command.length === 0) {
      return { status: 'DENIED', denial: processDenied(String(request.command)) };
    }
    // Grants are RE-EVALUATED before every consequential operation: an
    // expired grant's process allowlist authorizes NOTHING (fail-closed).
    const liveGrants = evaluateScopeGrants(session.scopes, this.clock.nowEpochMs());
    if (!isProcessGranted(liveGrants, request.command)) {
      this.sink({ source: 'local-companion:process', kind: 'local.scope.denied', payload: { boundary: 'process', command: request.command, code: 'COMPANION_PROCESS_DENIED' } });
      return { status: 'DENIED', denial: processDenied(request.command) };
    }
    const view = this.fileView();
    const result = this.process.exec(request, {
      readLocalFile: (path) => view.read(path),
      listLocalFiles: () => view.list(),
      emitLocalEvent: (kind, payload) => this.sink({ source: 'local-companion:process', kind, payload }),
    });
    this.sink({ source: 'local-companion:process', kind: 'local.process.executed', payload: { command: request.command, exit_code: result.exit_code } });
    return companionOk(result);
  }
}
