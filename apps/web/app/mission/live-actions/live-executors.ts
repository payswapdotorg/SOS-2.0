/**
 * THE LIVE ACTION EXECUTORS (Work Order P18-B — the composition-boundary
 * adapters behind the frozen executor seam).
 *
 * The merged ActionGateway's executor seam is SYNCHRONOUS (typed
 * operation records in, typed results out — the P8 discipline: "the
 * async -> sync bridge therefore lives at the COMPOSITION boundary").
 * The host (host.ts) therefore prefetches the REAL provider facts
 * (asynchronously, at action time, AFTER a current-authority pre-check)
 * and the executors below answer SYNCHRONOUSLY from those facts:
 *
 *   - RealBodyLifecycleExecutor — a body-lifecycle `start` bound to a REAL
 *     OpenRouter model probe: the session record carries the provider
 *     facts (response id, served model, usage) or the action FAILS
 *     (PROVIDER_UNAVAILABLE — never a fabricated RUNNING).
 *   - RealRecordsExecutor — promotion / rollback / deployment bound to the
 *     REAL Vercel deployment records: the promoted/rolled-back revision
 *     MUST exist as a really-deployed revision (exact source_revision_sha
 *     match — fail-closed NO_REAL_DEPLOYMENT_FOR_SHA otherwise), the
 *     environment-pointer ledger records the transition with the real
 *     deployment ids, and the receipt's deploymentRevision is the REAL
 *     `dpl_…` id.
 *   - ProviderUnavailableExecutor — the honest fail-closed executor when
 *     a provider was configured but its real read failed (UNAVAILABLE —
 *     no fake confirmations).
 *   - RealRecordsRollbackVerifier — the rollback verification against the
 *     REAL records read at action time (VERIFIED / FAILED / UNKNOWN from
 *     real data — the reference verifier's honesty, real data).
 */

import type { ActionFamily } from '@sos-2/action-gateway';
import type { ActionOperation, ActionExecutor, ExecutionContext, ExecutionResult } from '@sos-2/action-gateway';
import type { RollbackVerifier, RollbackVerifierObservation } from '@sos-2/action-gateway';
import type { VercelDeploymentIdentity } from '@sos-2/deployment-providers';
import type { OpenRouterProbeResult } from './adapters/openrouter-probe';
import { findByCommitSha } from './adapters/vercel-records';

// ---------------------------------------------------------------------------
// The real body-lifecycle executor (OpenRouter-backed sessions)
// ---------------------------------------------------------------------------

/** One real body session (the process-local registry — the lease state is durable elsewhere; this is the console's live view). */
export interface BodySessionRecord {
  readonly bodyId: string;
  readonly state: 'RUNNING' | 'PAUSED' | 'CANCELLED' | 'REPLACED';
  readonly provider: string | null;
  readonly modelResponseId: string | null;
  readonly servedModel: string | null;
  readonly usageTotalTokens: number | null;
  readonly finishReason: string | null;
  readonly startedAt: string;
}

function bodyOk(bodyId: string, session: BodySessionRecord): ExecutionResult {
  return {
    status: 'ok',
    output: {
      produced: {
        bodyId,
        state: session.state,
        provider: session.provider ?? 'reference',
        ...(session.modelResponseId !== null ? { modelResponseId: session.modelResponseId } : {}),
        ...(session.servedModel !== null ? { servedModel: session.servedModel } : {}),
        ...(session.usageTotalTokens !== null ? { usageTotalTokens: String(session.usageTotalTokens) } : {}),
      },
    },
  };
}

/**
 * The real body-lifecycle executor: `start` requires the provider probe to
 * have ANSWERED (CONNECTED) — an UNAVAILABLE provider is an honest FAILED
 * action, never a fabricated RUNNING session.
 */
export class RealBodyLifecycleExecutor implements ActionExecutor {
  readonly families: readonly ActionFamily[] = ['body-lifecycle'];

  constructor(
    private readonly sessions: Map<string, BodySessionRecord>,
    private readonly probe: OpenRouterProbeResult,
    private readonly nowRfc3339: string,
  ) {}

  execute(operation: ActionOperation, context: ExecutionContext): ExecutionResult {
    const op: string = operation.op;
    if (!('bodyId' in operation)) {
      return { status: 'error', errorType: 'UNEXPECTED_OPERATION', message: `expected a body-lifecycle operation`, retryable: false };
    }
    const bodyId = operation.bodyId;
    switch (op) {
      case 'body.start': {
        if (this.probe.state === 'UNAVAILABLE') {
          return {
            status: 'error',
            errorType: 'PROVIDER_UNAVAILABLE',
            message: `the body's hosted model provider did not answer (${this.probe.error?.kind ?? 'unknown'}: ${this.probe.error?.message ?? this.probe.detail}) — the body was NOT summoned (never a fabricated RUNNING)`,
            retryable: true,
          };
        }
        if (this.probe.state === 'UNKNOWN') {
          return {
            status: 'error',
            errorType: 'PROVIDER_UNCONFIGURED',
            message: 'the body-lifecycle real executor was composed without a provider probe result',
            retryable: false,
          };
        }
        const session: BodySessionRecord = {
          bodyId,
          state: 'RUNNING',
          provider: 'openrouter',
          modelResponseId: this.probe.response?.id ?? null,
          servedModel: this.probe.response?.model ?? null,
          usageTotalTokens: this.probe.response?.usage?.total_tokens ?? null,
          finishReason: this.probe.response?.finish_reason ?? null,
          startedAt: this.nowRfc3339,
        };
        this.sessions.set(bodyId, session);
        return bodyOk(bodyId, session);
      }
      case 'body.pause':
      case 'body.resume':
      case 'body.cancel':
      case 'body.replace': {
        const current = this.sessions.get(bodyId) ?? null;
        if (current === null) {
          return { status: 'error', errorType: 'UNKNOWN_BODY', message: `body ${bodyId} has no live session on this console instance`, retryable: false };
        }
        const nextState: BodySessionRecord['state'] =
          op === 'body.pause' ? 'PAUSED' : op === 'body.cancel' ? 'CANCELLED' : op === 'body.replace' ? 'REPLACED' : 'RUNNING';
        const next: BodySessionRecord = { ...current, state: nextState };
        this.sessions.set(bodyId, next);
        return bodyOk(bodyId, next);
      }
      default:
        return { status: 'error', errorType: 'UNEXPECTED_OPERATION', message: `unexpected body-lifecycle operation ${op}`, retryable: false };
    }
  }
}

// ---------------------------------------------------------------------------
// The real deployment-records executor (Vercel-bound promotion/rollback)
// ---------------------------------------------------------------------------

/** One environment-pointer transition recorded against REAL deployment ids. */
export interface EnvironmentPointerRecord {
  readonly environment: string;
  readonly deploymentId: string;
  readonly sourceSha: string;
  readonly since: string;
  readonly rolledBackFrom: string | null;
  readonly provider: 'vercel';
  readonly apiRevision: string;
}

function noRealDeployment(sha: string): ExecutionResult {
  return {
    status: 'error',
    errorType: 'NO_REAL_DEPLOYMENT_FOR_SHA',
    message: `no real deployment record is bound to source revision ${sha} — the console never promotes or rolls back a revision that was never really deployed (fail-closed)`,
    retryable: false,
  };
}

/**
 * The real records executor: every transition binds to a REAL deployment
 * record (exact source_revision_sha match). The receipt's
 * deploymentRevision is the real `dpl_…` id; the environment-pointer
 * ledger (process-local) records the transition with the previous
 * pointer.
 */
export class RealRecordsExecutor implements ActionExecutor {
  readonly families: readonly ActionFamily[] = ['promotion', 'rollback', 'deployment'];

  constructor(
    private readonly records: readonly VercelDeploymentIdentity[],
    private readonly pointers: Map<string, EnvironmentPointerRecord>,
    private readonly initialProduction: VercelDeploymentIdentity | null,
    private readonly nowRfc3339: string,
  ) {}

  execute(operation: ActionOperation, context: ExecutionContext): ExecutionResult {
    switch (operation.op) {
      case 'promotion.apply':
      case 'deployment.apply': {
        const environment = 'environment' in operation ? operation.environment : 'toEnvironment' in operation ? operation.toEnvironment : 'unknown';
        const sourceSha = 'sourceSha' in operation ? operation.sourceSha : 'unknown-sha';
        const real = findByCommitSha(this.records, sourceSha);
        if (real === null) {
          return noRealDeployment(sourceSha);
        }
        const previous = this.current(environment);
        const pointer: EnvironmentPointerRecord = {
          environment,
          deploymentId: real.id,
          sourceSha,
          since: this.nowRfc3339,
          rolledBackFrom: null,
          provider: 'vercel',
          apiRevision: 'vercel.v6',
        };
        this.pointers.set(environment, pointer);
        return {
          status: 'ok',
          output: {
            produced: {
              deploymentId: real.id,
              sourceSha,
              environment,
              previousDeploymentId: previous?.deploymentId ?? 'none',
              provider: 'vercel',
              apiRevision: 'vercel.v6',
              physicalAliasMutated: 'no — the console records the environment pointer; it does not mutate the provider alias',
            },
          },
        };
      }
      case 'rollback.apply': {
        const target = findByCommitSha(this.records, operation.toSourceSha);
        if (target === null) {
          return noRealDeployment(operation.toSourceSha);
        }
        const current =
          this.records.find((entry) => entry.id === operation.deploymentId) ??
          (operation.deploymentId === 'current-production' ? this.initialProduction : null);
        if (current === null) {
          return {
            status: 'error',
            errorType: 'UNKNOWN_DEPLOYMENT',
            message: `the deployment being rolled back (${operation.deploymentId}) was not observed in the real records read at action time`,
            retryable: false,
          };
        }
        const environment = this.pointers.get('production')?.environment ?? current.target ?? 'production';
        const pointer: EnvironmentPointerRecord = {
          environment,
          deploymentId: target.id,
          sourceSha: operation.toSourceSha,
          since: this.nowRfc3339,
          rolledBackFrom: current.id,
          provider: 'vercel',
          apiRevision: 'vercel.v6',
        };
        this.pointers.set(environment, pointer);
        return {
          status: 'ok',
          output: {
            produced: {
              deploymentId: target.id,
              sourceSha: operation.toSourceSha,
              rolledBackFromDeploymentId: current.id,
              environment,
              provider: 'vercel',
              apiRevision: 'vercel.v6',
              physicalAliasMutated: 'no — the console records the rollback pointer; it does not mutate the provider alias',
            },
          },
        };
      }
      default:
        return { status: 'error', errorType: 'UNEXPECTED_OPERATION', message: `unexpected records operation ${operation.op}`, retryable: false };
    }
  }

  private current(environment: string): EnvironmentPointerRecord | null {
    const pointer = this.pointers.get(environment) ?? null;
    if (pointer !== null) {
      return pointer;
    }
    if (environment === 'production' && this.initialProduction !== null) {
      return {
        environment: 'production',
        deploymentId: this.initialProduction.id,
        sourceSha: this.initialProduction.commitSha ?? 'unknown-sha',
        since: this.initialProduction.createdAt !== null ? new Date(this.initialProduction.createdAt).toISOString() : 'unknown',
        rolledBackFrom: null,
        provider: 'vercel',
        apiRevision: 'vercel.v6',
      };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// The fail-closed + verification adapters
// ---------------------------------------------------------------------------

/** The honest fail-closed executor when a configured provider could not be read (UNAVAILABLE — no fake confirmations). */
export class ProviderUnavailableExecutor implements ActionExecutor {
  constructor(
    readonly families: readonly ActionFamily[],
    private readonly errorType: string,
    private readonly message: string,
  ) {}

  execute(_operation: ActionOperation, _context: ExecutionContext): ExecutionResult {
    return { status: 'error', errorType: this.errorType, message: this.message, retryable: true };
  }
}

/** The rollback verification against the REAL records read at action time. */
export class RealRecordsRollbackVerifier implements RollbackVerifier {
  constructor(private readonly records: readonly VercelDeploymentIdentity[]) {}

  verify(deploymentId: string, expectedSourceSha: string): RollbackVerifierObservation {
    const deployment = this.records.find((entry) => entry.id === deploymentId) ?? null;
    if (deployment === null) {
      return { verdict: 'UNKNOWN', observedSourceSha: null, limitation: `deployment ${deploymentId} was not in the real records read at action time` };
    }
    if (deployment.commitSha !== null && deployment.commitSha === expectedSourceSha) {
      return { verdict: 'VERIFIED', observedSourceSha: deployment.commitSha, limitation: null };
    }
    return {
      verdict: 'FAILED',
      observedSourceSha: deployment.commitSha,
      limitation: `observed ${deployment.commitSha ?? 'no sha'} on the real record, expected ${expectedSourceSha}`,
    };
  }
}
