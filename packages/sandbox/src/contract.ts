/**
 * THE SANDBOX CONTRACT (Work Order P8) — the bounded-environment boundary
 * every P8 reference body executes within.
 *
 * Surfaces:
 *
 *   filesystem.read/write/list  workspace-scoped file access (scope +
 *                               budgets enforced; violations typed-denied)
 *   network.netCall             an authorized network exchange record —
 *                               the host must be admitted by the egress
 *                               policy and, when a credential NAME is
 *                               supplied, the closure must hold it; the
 *                               credential VALUE is resolved only inside
 *                               the closure and never surfaces
 *   secrets.names               credential NAMES only (values live inside
 *                               the closure; there is deliberately NO
 *                               value-revealing operation on this contract)
 *   budget.consume/report       the injected resource-envelope budgets
 *   end/ended                   dispose the sandbox; every later operation
 *                               refuses with SANDBOX_ENDED
 *
 * The sandbox answers the merged P5 BoundedEnvironmentDescription through
 * describe() — the same typed vocabulary the runtime capability envelopes
 * carry (filesystem scope, network egress policy, isolation level,
 * limits, environment variable NAMES only).
 */

import type { BoundedEnvironmentDescription } from '@sos-2/runtime-contracts';
import type { SandboxBudgetCounter, SandboxPolicy } from './policy.js';
import type { SandboxDenial, SandboxResult } from './denials.js';

/** One authorized network exchange — a typed record, never real egress. */
export interface NetworkExchange {
  /** Deterministic exchange id (sequence). */
  readonly exchange_id: string;
  /** The admitted host. */
  readonly host: string;
  /** The requested path. */
  readonly path: string;
  /** The credential NAME used, or null (never the value). */
  readonly credential: string | null;
  /**
   * Honest delivery marker: the reference sandbox records the authorized
   * exchange only — real egress attaches later through provider-backed
   * sandboxes without contract change.
   */
  readonly delivered: false;
}

/** One budget counter's deterministic report. */
export interface SandboxBudgetCounterReport {
  readonly counter: SandboxBudgetCounter;
  /** The injected limit, or null when unbounded. */
  readonly limit: number | null;
  /** Units consumed so far. */
  readonly used: number;
  /** Remaining units, or null when unbounded. */
  readonly remaining: number | null;
}

/** The full deterministic budget report (audit — never carries secret values). */
export interface SandboxBudgetReport {
  readonly counters: readonly SandboxBudgetCounterReport[];
}

/** The workspace-scoped filesystem surface. */
export interface SandboxFilesystemSurface {
  /** Read one workspace file (out-of-scope access is a typed denial). */
  read(path: string): SandboxResult<{ readonly content: string }>;
  /** Write one workspace file (scope + fileWrites/fileBytes budgets enforced). */
  write(path: string, content: string): SandboxResult<{ readonly bytes: number }>;
  /** List workspace file paths (deterministic sorted order). */
  list(): SandboxResult<{ readonly paths: readonly string[] }>;
}

/** The network egress surface. */
export interface SandboxNetworkSurface {
  /**
   * Request one network exchange: the host must be admitted by the egress
   * policy; a credential NAME (when supplied) must be held by the closure
   * and consumes a secretReveals budget unit; the exchange consumes a
   * networkCalls budget unit. The credential VALUE never surfaces.
   */
  netCall(host: string, path: string, credentialName: string | null): SandboxResult<NetworkExchange>;
}

/** The secrets surface — NAMES only (values never leave the closure). */
export interface SandboxSecretsSurface {
  /** The declared credential NAMES (never values). */
  names(): readonly string[];
  /** How many credential resolutions the closure has performed (audit). */
  resolutions(): number;
}

/** The resource-envelope budget surface. */
export interface SandboxBudgetSurface {
  /** Consume budget units (an overrun is a typed denial). */
  consume(counter: SandboxBudgetCounter, units: number): SandboxResult<{ readonly used: number; readonly remaining: number | null }>;
  /** The deterministic budget report. */
  report(): SandboxBudgetReport;
}

/** THE SANDBOX — the bounded environment contract. */
export interface Sandbox {
  /** The injected policy (data — no ambient reads). */
  policy(): SandboxPolicy;
  /** The P5 bounded-environment description (consumed vocabulary; NAMES only). */
  describe(): BoundedEnvironmentDescription;
  readonly filesystem: SandboxFilesystemSurface;
  readonly network: SandboxNetworkSurface;
  readonly secrets: SandboxSecretsSurface;
  readonly budget: SandboxBudgetSurface;
  /** Dispose the sandbox; every later operation refuses with SANDBOX_ENDED. */
  end(reason: string): void;
  /** Has the sandbox been disposed? */
  ended(): boolean;
  /** Why the sandbox ended, when it has (audit; null while live). */
  endReason(): string | null;
}

/** A sandbox factory: bodies create one bounded environment per task session. */
export type SandboxFactory = (taskRef: string) => Sandbox;
