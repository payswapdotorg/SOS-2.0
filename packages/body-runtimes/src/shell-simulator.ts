/**
 * The deterministic in-process shell simulator (Work Order P8) — the shell
 * capability of the disposable cloud coding/shell body.
 *
 * NO REAL PROCESS IS EVER SPAWNED: the simulator dispatches a command name
 * onto an INJECTABLE COMMAND REGISTRY (a typed ShellCommand list) and
 * answers a deterministic ShellCommandResult (exit code / stdout /
 * stderr). The built-in registry (echo, cat, ls, pwd, test, exit) covers
 * the deterministic test vocabulary; callers inject additional commands
 * (e.g. a scripted build or deploy check) through the same registry — the
 * real provider shell attaches later behind the same seam without
 * contract change.
 */

import { InvalidBodyRuntimeOptionsError } from './errors.js';
import type { JsonValue } from '@sos-2/semantic-spine';

/** The deterministic outcome of one simulated command execution. */
export interface ShellCommandResult {
  readonly exit_code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The context a simulated command runs within (the bounded task session). */
export interface ShellCommandContext {
  /** The bounded task this execution belongs to. */
  readonly taskRef: string;
  /** Read one workspace file through the session sandbox (or null when absent/denied). */
  readWorkspaceFile(path: string): string | null;
  /** List workspace file paths through the session sandbox (deterministic order). */
  listWorkspaceFiles(): readonly string[];
  /** Emit one body-side event (typed record; never carries secret values). */
  emitEvent(kind: string, payload: JsonValue): void;
}

/** One simulated shell command (the injectable registry entry). */
export interface ShellCommand {
  /** The command name (non-empty, whitespace-free, no path separators). */
  readonly name: string;
  /** Deterministic execution of the command. */
  run(args: readonly string[], context: ShellCommandContext): ShellCommandResult;
}

/** Construct a successful command result. */
export function shellOk(stdout: string): ShellCommandResult {
  return { exit_code: 0, stdout, stderr: '' };
}

/** Construct a failed command result. */
export function shellErr(exitCode: number, stderr: string): ShellCommandResult {
  return { exit_code: exitCode, stdout: '', stderr };
}

function isValidCommandName(name: string): boolean {
  return name.length > 0 && !/\s/.test(name) && !name.includes('/') && !name.includes('\\');
}

/** Validate a command registry (throws InvalidBodyRuntimeOptionsError). */
export function assertValidShellCommandRegistry(commands: readonly ShellCommand[]): void {
  const seen = new Set<string>();
  for (const command of commands) {
    if (typeof command !== 'object' || command === null || typeof command.name !== 'string' || typeof command.run !== 'function') {
      throw new InvalidBodyRuntimeOptionsError('shell-registry', 'every shell registry entry must be { name, run }');
    }
    if (!isValidCommandName(command.name)) {
      throw new InvalidBodyRuntimeOptionsError(
        'shell-registry',
        `shell command name must be non-empty and path-free, received: ${JSON.stringify(command.name)}`,
      );
    }
    if (seen.has(command.name)) {
      throw new InvalidBodyRuntimeOptionsError('shell-registry', `duplicate shell command name: ${JSON.stringify(command.name)}`);
    }
    seen.add(command.name);
  }
}

/** The built-in deterministic command registry: echo, cat, ls, pwd, test, exit. */
export function builtinShellCommands(): ShellCommand[] {
  return [
    {
      name: 'echo',
      run: (args) => shellOk(args.join(' ')),
    },
    {
      name: 'cat',
      run: (args, context) => {
        const path = args[0];
        if (path === undefined) {
          return shellErr(2, 'cat: missing file operand');
        }
        const content = context.readWorkspaceFile(path);
        if (content === null) {
          return shellErr(1, `cat: ${path}: no such file`);
        }
        return shellOk(content);
      },
    },
    {
      name: 'ls',
      run: (_args, context) => shellOk(context.listWorkspaceFiles().join('\n')),
    },
    {
      name: 'pwd',
      run: () => shellOk('/workspace'),
    },
    {
      name: 'test',
      run: (args, context) => {
        if (args.length === 2 && args[0] === '-f') {
          return context.readWorkspaceFile(args[1]!) === null ? shellErr(1, '') : { exit_code: 0, stdout: '', stderr: '' };
        }
        return shellErr(2, 'test: unsupported expression (only -f <path> is simulated)');
      },
    },
    {
      name: 'exit',
      run: (args) => {
        const code = Number(args[0] ?? '0');
        return { exit_code: Number.isInteger(code) ? code : 0, stdout: '', stderr: '' };
      },
    },
  ];
}

/**
 * The shell simulator: deterministic dispatch of one command onto the
 * injected registry. An unknown command answers exit code 127 (command
 * not found) — the same truthful convention as a real shell.
 */
export class ShellSimulator {
  private readonly commands: ReadonlyMap<string, ShellCommand>;

  constructor(commands: readonly ShellCommand[] = builtinShellCommands()) {
    assertValidShellCommandRegistry(commands);
    this.commands = new Map(commands.map((command) => [command.name, command]));
  }

  exec(command: string, args: readonly string[], context: ShellCommandContext): ShellCommandResult {
    if (typeof command !== 'string' || command.length === 0) {
      return shellErr(2, 'empty command');
    }
    const entry = this.commands.get(command);
    if (entry === undefined) {
      return shellErr(127, `command not found: ${command}`);
    }
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
      return shellErr(2, `invalid arguments for ${command}`);
    }
    return entry.run(args, context);
  }

  /** The registry's command names (deterministic order — audit). */
  commandNames(): readonly string[] {
    return [...this.commands.keys()];
  }
}
