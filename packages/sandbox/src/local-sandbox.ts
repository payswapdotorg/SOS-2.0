/**
 * The reference LOCAL SANDBOX (Work Order P8): a deterministic, in-process
 * bounded environment used by tests and local development. It performs NO
 * real filesystem access, NO real network access and NO ambient reads —
 * an in-memory workspace tree, an in-memory egress gate over host NAMES,
 * an in-memory credential closure and deterministic budget counters.
 *
 * SECRETS ISOLATION: the injected credential values live only inside the
 * closure (a private Map). They are resolved internally for authorized
 * network exchanges and are NEVER returned, echoed, logged or serialized:
 * describe() carries NAMES only; denials carry NAMES only; budget reports
 * carry counters only. There is deliberately no value-revealing operation
 * on the contract.
 *
 * Honest reference limits (typed INVALID at construction, loud):
 *   - filesystem mode "host" is never granted by the in-process reference
 *     environment (host scope belongs to real provider environments with
 *     account isolation — the P3 pairing rule);
 *   - egress "open" is never granted by the in-process reference
 *     environment (bounded by design).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env anywhere;
 * exchange ids are deterministic sequences.
 */

import { InvalidSandboxPolicyError } from './errors.js';
import { sandboxDenied, sandboxDenial, sandboxOk } from './denials.js';
import type { SandboxDenial, SandboxResult } from './denials.js';
import { assertValidSandboxPolicy } from './policy.js';
import type { SandboxBudgetCounter, SandboxPolicy } from './policy.js';
import { SANDBOX_BUDGET_COUNTERS } from './policy.js';
import type {
  NetworkExchange,
  Sandbox,
  SandboxBudgetCounterReport,
  SandboxBudgetReport,
} from './contract.js';
import type { BoundedEnvironmentDescription } from '@sos-2/runtime-contracts';

/** Dependencies: the validated policy + the credential values injected INTO the closure. */
export interface LocalSandboxDeps {
  readonly policy: SandboxPolicy;
  /**
   * Credential values keyed by NAME — injected into the closure. Keys MUST
   * be declared in the policy's secrets list (an undeclared value is a
   * typed INVALID at construction — loud, never a hidden credential).
   */
  readonly secrets?: Readonly<Record<string, string>>;
}

const NAMESPACE = 'local-sandbox';

/** A path segment is clean when it is a plain name (no separators/escapes). */
function isCleanRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.includes('\r') || path.includes('\n')) {
    return false;
  }
  const segments = path.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** Normalize a workspace-relative path (rejects escapes — returns null when unclean). */
function normalizeWorkspacePath(path: string): string | null {
  if (!isCleanRelativePath(path)) {
    return null;
  }
  return path
    .split('/')
    .map((segment) => segment.trim())
    .join('/');
}

/**
 * Create the reference local sandbox — deterministic, in-process, offline.
 */
export function createLocalSandbox(deps: LocalSandboxDeps): Sandbox {
  if (typeof deps !== 'object' || deps === null) {
    throw new InvalidSandboxPolicyError(NAMESPACE, 'local sandbox requires a deps object');
  }
  assertValidSandboxPolicy(deps.policy);
  const policy = deps.policy;

  // Honest reference limits: the in-process environment grants neither
  // host filesystem scope nor open egress (bounded by design).
  if (policy.filesystem.mode === 'host') {
    throw new InvalidSandboxPolicyError(
      NAMESPACE,
      'the reference local sandbox never grants filesystem mode "host" — host scope belongs to real provider environments with account isolation (the P3 pairing rule)',
    );
  }
  if (policy.network.egress === 'open') {
    throw new InvalidSandboxPolicyError(
      NAMESPACE,
      'the reference local sandbox never grants egress "open" — the in-process environment is bounded by design (use "none" or an "allowlist")',
    );
  }

  const declaredSecrets = new Set<string>(policy.secrets);
  const secretValues = new Map<string, string>();
  if (deps.secrets !== undefined) {
    if (typeof deps.secrets !== 'object' || Array.isArray(deps.secrets)) {
      throw new InvalidSandboxPolicyError(NAMESPACE, 'local sandbox secrets must be a name -> value record');
    }
    for (const [name, value] of Object.entries(deps.secrets)) {
      if (!declaredSecrets.has(name)) {
        throw new InvalidSandboxPolicyError(
          NAMESPACE,
          `secret value injected under undeclared name ${JSON.stringify(name)} — every credential must be declared by NAME in the policy before its value enters the closure`,
        );
      }
      if (typeof value !== 'string' || value.length === 0) {
        throw new InvalidSandboxPolicyError(NAMESPACE, `secret ${JSON.stringify(name)} must be a non-empty string value`);
      }
      secretValues.set(name, value);
    }
  }

  // The closure state (private — files, budgets, credential resolutions).
  const files = new Map<string, string>();
  const used: Record<SandboxBudgetCounter, number> = {
    fileWrites: 0,
    fileBytes: 0,
    shellCommands: 0,
    networkCalls: 0,
    secretReveals: 0,
  };
  let credentialResolutions = 0;
  let exchangeSequence = 0;
  let disposed = false;
  let disposedReason: string | null = null;

  function endedDenial(): SandboxDenial {
    return sandboxDenial(
      'SANDBOX_ENDED',
      'sandbox',
      `the sandbox has been disposed${disposedReason === null ? '' : ` (${disposedReason})`} — every operation on an ended sandbox refuses (fail closed)`,
    );
  }

  function filesystemDisabledDenial(path: string): SandboxDenial {
    return sandboxDenial(
      'SANDBOX_FILESYSTEM_OUT_OF_SCOPE',
      path,
      'the filesystem scope of this sandbox is "none" — no file access is granted (the honest declaration)',
    );
  }

  function outOfScopeDenial(path: string): SandboxDenial {
    return sandboxDenial(
      'SANDBOX_FILESYSTEM_OUT_OF_SCOPE',
      path,
      `the path escapes the workspace scope rooted at ${JSON.stringify(policy.filesystem.root)} — only clean relative paths inside the workspace are granted`,
    );
  }

  function budgetDenial(counter: SandboxBudgetCounter, limit: number): SandboxDenial {
    return sandboxDenial(
      'SANDBOX_BUDGET_EXCEEDED',
      counter,
      `the ${counter} budget is exhausted (limit ${String(limit)} consumed ${String(used[counter])}) — the resource envelope refuses further work (injected limits are binding)`,
    );
  }

  function consume(counter: SandboxBudgetCounter, units: number): SandboxDenial | null {
    const limit = policy.budgets[counter];
    if (limit === null) {
      used[counter] += units;
      return null;
    }
    if (used[counter] + units > limit) {
      return budgetDenial(counter, limit);
    }
    used[counter] += units;
    return null;
  }

  function counterReport(counter: SandboxBudgetCounter): SandboxBudgetCounterReport {
    const limit = policy.budgets[counter];
    return {
      counter,
      limit,
      used: used[counter],
      remaining: limit === null ? null : Math.max(0, limit - used[counter]),
    };
  }

  return {
    policy(): SandboxPolicy {
      return policy;
    },
    describe(): BoundedEnvironmentDescription {
      // NAMES only — secret values are never serialized (the P3/P5 discipline).
      return {
        filesystem: { mode: policy.filesystem.mode, root: policy.filesystem.root },
        network: policy.network,
        isolation: 'process',
        limits: {
          maxDurationMs: policy.resourceEnvelope.maxDurationMs,
          maxMemoryMb: policy.resourceEnvelope.maxMemoryMb,
        },
        environmentVariables: [...policy.secrets],
      };
    },
    filesystem: {
      read(path: string): SandboxResult<{ content: string }> {
        if (disposed) {
          return sandboxDenied(endedDenial());
        }
        if (policy.filesystem.mode === 'none') {
          return sandboxDenied(filesystemDisabledDenial(path));
        }
        const normalized = normalizeWorkspacePath(path);
        if (normalized === null) {
          return sandboxDenied(outOfScopeDenial(path));
        }
        const content = files.get(normalized);
        if (content === undefined) {
          return sandboxDenied(
            sandboxDenial(
              'SANDBOX_FILESYSTEM_OUT_OF_SCOPE',
              path,
              `no such file in the workspace scope: ${JSON.stringify(normalized)}`,
            ),
          );
        }
        return sandboxOk({ content });
      },
      write(path: string, content: string): SandboxResult<{ bytes: number }> {
        if (disposed) {
          return sandboxDenied(endedDenial());
        }
        if (policy.filesystem.mode === 'none') {
          return sandboxDenied(filesystemDisabledDenial(path));
        }
        const normalized = normalizeWorkspacePath(path);
        if (normalized === null) {
          return sandboxDenied(outOfScopeDenial(path));
        }
        if (typeof content !== 'string') {
          throw new InvalidSandboxPolicyError(NAMESPACE, 'sandbox write content must be a string (typed contract violation)');
        }
        const bytes = content.length;
        const writeDenied = consume('fileWrites', 1);
        if (writeDenied !== null) {
          return sandboxDenied(writeDenied);
        }
        const previous = files.get(normalized);
        const bytesDenied = consume('fileBytes', Math.max(bytes - (previous?.length ?? 0), 0));
        if (bytesDenied !== null) {
          // Roll the fileWrites consumption back? No — consumed budget units
          // stay consumed (the attempt happened); the write is refused.
          return sandboxDenied(bytesDenied);
        }
        files.set(normalized, content);
        return sandboxOk({ bytes });
      },
      list(): SandboxResult<{ paths: readonly string[] }> {
        if (disposed) {
          return sandboxDenied(endedDenial());
        }
        if (policy.filesystem.mode === 'none') {
          return sandboxDenied(filesystemDisabledDenial(''));
        }
        return sandboxOk({ paths: [...files.keys()].sort() });
      },
    },
    network: {
      netCall(host: string, path: string, credentialName: string | null): SandboxResult<NetworkExchange> {
        if (disposed) {
          return sandboxDenied(endedDenial());
        }
        if (typeof host !== 'string' || host.length === 0 || /\s/.test(host)) {
          return sandboxDenied(
            sandboxDenial('SANDBOX_NETWORK_EGRESS_DENIED', String(host), 'a network host must be a non-empty whitespace-free name'),
          );
        }
        if (policy.network.egress === 'none') {
          return sandboxDenied(
            sandboxDenial(
              'SANDBOX_NETWORK_EGRESS_DENIED',
              host,
              'the egress policy of this sandbox is "none" — no network access is granted',
            ),
          );
        }
        // allowlist (open was rejected at construction).
        const allowed = policy.network.egress === 'allowlist' ? policy.network.allowedHosts : [];
        if (!allowed.includes(host)) {
          return sandboxDenied(
            sandboxDenial(
              'SANDBOX_NETWORK_EGRESS_DENIED',
              host,
              `host is not admitted by the egress allowlist [${allowed.join(', ')}] — a network call to a denied host is a typed denial`,
            ),
          );
        }
        if (credentialName !== null) {
          if (!declaredSecrets.has(credentialName)) {
            return sandboxDenied(
              sandboxDenial(
                'SANDBOX_SECRET_UNAVAILABLE',
                credentialName,
                `credential name ${JSON.stringify(credentialName)} is not declared by this sandbox — an undeclared credential is never fabricated`,
              ),
            );
          }
          if (!secretValues.has(credentialName)) {
            return sandboxDenied(
              sandboxDenial(
                'SANDBOX_SECRET_UNAVAILABLE',
                credentialName,
                `credential ${JSON.stringify(credentialName)} is declared but no value was injected into the closure — the resolution refuses (never fabricated)`,
              ),
            );
          }
          const revealDenied = consume('secretReveals', 1);
          if (revealDenied !== null) {
            return sandboxDenied(revealDenied);
          }
          // The value is resolved INSIDE the closure only — it never surfaces.
          credentialResolutions += 1;
        }
        const callDenied = consume('networkCalls', 1);
        if (callDenied !== null) {
          return sandboxDenied(callDenied);
        }
        exchangeSequence += 1;
        const exchange: NetworkExchange = {
          exchange_id: `netex-${String(exchangeSequence).padStart(4, '0')}`,
          host,
          path,
          credential: credentialName,
          delivered: false,
        };
        return sandboxOk(exchange);
      },
    },
    secrets: {
      names(): readonly string[] {
        return [...policy.secrets];
      },
      resolutions(): number {
        return credentialResolutions;
      },
    },
    budget: {
      consume(counter: SandboxBudgetCounter, units: number): SandboxResult<{ used: number; remaining: number | null }> {
        if (disposed) {
          return sandboxDenied(endedDenial());
        }
        if (!SANDBOX_BUDGET_COUNTERS.includes(counter)) {
          throw new InvalidSandboxPolicyError(
            NAMESPACE,
            `unknown budget counter ${JSON.stringify(counter)} (vocabulary: ${SANDBOX_BUDGET_COUNTERS.join(', ')})`,
          );
        }
        if (!Number.isInteger(units) || units <= 0) {
          throw new InvalidSandboxPolicyError(NAMESPACE, `budget consumption units must be a positive integer, received: ${JSON.stringify(units)}`);
        }
        const denial = consume(counter, units);
        if (denial !== null) {
          return sandboxDenied(denial);
        }
        const limit = policy.budgets[counter];
        return { status: 'OK', value: { used: used[counter], remaining: limit === null ? null : Math.max(0, limit - used[counter]) } };
      },
      report(): SandboxBudgetReport {
        return { counters: SANDBOX_BUDGET_COUNTERS.map(counterReport) };
      },
    },
    end(reason: string): void {
      if (typeof reason !== 'string' || reason.length === 0) {
        throw new InvalidSandboxPolicyError(NAMESPACE, 'sandbox disposal requires a non-empty reason');
      }
      disposed = true;
      disposedReason = reason;
      // The credential closure dies with the sandbox — values never outlive it.
      secretValues.clear();
      files.clear();
    },
    ended(): boolean {
      return disposed;
    },
    endReason(): string | null {
      return disposedReason;
    },
  };
}
