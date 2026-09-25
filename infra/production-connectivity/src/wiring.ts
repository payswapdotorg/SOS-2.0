/**
 * The P17-A production-connectivity wiring harness — the composition
 * layer that assembles the REAL free-tier persistence + deployment
 * stack from an injected environment source at the process boundary
 * (the infra/deployment harness precedent, realized for the P17-A
 * owned packages):
 *
 *   - credentials resolve ONLY from the injected source (env-only; the
 *     ambient environment is the caller's business — this module never
 *     reads the ambient environment);
 *   - ONE FetchPort per provider flows through the transcript-recording
 *     wrappers (every real round-trip becomes redacted evidence);
 *   - the persistence stack composes per
 *     @sos-2/real-persistence's composition boundary; the Vercel
 *     deployment provider composes per
 *     @sos-2/deployment-providers;
 *   - `startupProbes()` runs the REAL probes of every attached adapter
 *     (Neon SQL ping, Upstash PING, R2 HeadBucket, Vercel /v2/user) and
 *     records honest outcomes — UNKNOWN before a probe,
 *     CONNECTED/UNAVAILABLE/DEGRADED after, never fabricated;
 *   - absent credentials leave an adapter UNATTACHED and its state
 *     honestly UNKNOWN (never fabricated).
 *
 * Determinism discipline: inject a scripted FetchPort + ManualClock +
 * instant sleep and the whole harness runs offline, run-to-run
 * identical (the deterministic wiring tests do exactly that). The
 * default fetch/sleep bindings are the documented impure process
 * boundary.
 */

import type { Clock, ProviderHealthReport } from '@sos-2/live-store';
import { createRealPersistenceStack } from '@sos-2/real-persistence';
import type { RealPersistenceStack } from '@sos-2/real-persistence';
import {
  DeploymentProbeLedger,
  DeploymentTranscriptRecorder,
  RealVercelDeploymentProvider,
  REAL_DEPLOYMENT_ENVIRONMENT_VARIABLES,
  bindGlobalFetch,
  resolveRealDeploymentEnvironment,
} from '@sos-2/deployment-providers';
import type { RealDeploymentProviderStateReport, RealVercelDeploymentProvider as RealVercelDeploymentProviderType, Sleep } from '@sos-2/deployment-providers';
import type { RealPersistenceProviderStateReport } from '@sos-2/real-persistence';

/** The default real sleep (the impure process boundary: a real timer). */
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The outcome of one provider's startup probe. */
export interface StartupProbeOutcome {
  /** The provider ('neon' | 'upstash' | 'r2' | 'vercel'). */
  readonly provider: string;
  /** Was the adapter attached (credentials resolved)? */
  readonly attached: boolean;
  /** Did the probe run? (unattached adapters are honestly not probed). */
  readonly probed: boolean;
  /** The probe outcome (false on failure; false when not probed — never fabricated). */
  readonly ok: boolean;
}

export interface ProductionConnectivityHarnessOptions {
  /** The injected raw environment source (env-only credentials; the caller owns the ambient read). */
  readonly source: Readonly<Record<string, string>>;
  /** The environment tier (namespace/prefix scope — the isolation seam). */
  readonly tier: 'local' | 'preview' | 'production';
  /** The injected clock (probe/transcript instants; no hidden time). */
  readonly clock: Clock;
  /** The injectable sleep for the Vercel readiness polls (default: the real timer). */
  readonly sleep?: Sleep;
  /** The Vercel team id scope, or null to use the account default. */
  readonly vercelTeamId?: string | null;
  /** The inner network FetchPort (reference-mode compositions inject a scripted port instead of the global-fetch default). */
  readonly fetch?: import('@sos-2/real-persistence').FetchPort;
}

/** The composed production-connectivity surface. */
export interface ProductionConnectivityHarness {
  /** The REAL persistence stack behind the frozen P2 ports. */
  readonly persistence: RealPersistenceStack;
  /** The REAL Vercel deployment provider behind the frozen deployment contracts, or null when VERCEL_TOKEN is absent. */
  readonly vercel: RealVercelDeploymentProviderType | null;
  /** The Vercel-side redacted transcript recorder. */
  vercelTranscript(): DeploymentTranscriptRecorder;
  /**
   * Run the REAL startup probes of every attached adapter (Neon SQL
   * ping, Upstash PING, R2 HeadBucket, Vercel /v2/user). Honest
   * outcomes — a provider failure is recorded, never fabricated.
   */
  startupProbes(): Promise<readonly StartupProbeOutcome[]>;
  /** The frozen P2 aggregate health report (persistence providers). */
  health(): ProviderHealthReport;
  /** The P17-A honest provider-state reports (all four providers). */
  providerStates(): readonly (RealPersistenceProviderStateReport | RealDeploymentProviderStateReport)[];
}

/** Compose the full production-connectivity harness from the injected environment. */
export function createProductionConnectivityHarness(options: ProductionConnectivityHarnessOptions): ProductionConnectivityHarness {
  const fetch = options.fetch ?? bindGlobalFetch();
  const persistence = createRealPersistenceStack({
    source: options.source,
    tier: options.tier,
    clock: options.clock,
    fetch,
  });

  const deploymentResolution = resolveRealDeploymentEnvironment(options.source);
  const vercelTranscript = new DeploymentTranscriptRecorder({
    credentialReference: deploymentResolution.vercel.tokenEnv ?? REAL_DEPLOYMENT_ENVIRONMENT_VARIABLES.vercelToken,
  });
  const vercelLedger = new DeploymentProbeLedger();
  const vercel =
    deploymentResolution.vercel.token !== null
      ? new RealVercelDeploymentProvider({
          token: deploymentResolution.vercel.token,
          teamId: options.vercelTeamId ?? deploymentResolution.vercel.orgId,
          fetch,
          clock: options.clock,
          ledger: vercelLedger,
          credentialEnv: deploymentResolution.vercel.tokenEnv,
          sleep: options.sleep ?? realSleep,
        })
      : null;

  return {
    persistence,
    vercel,
    vercelTranscript: () => vercelTranscript,
    async startupProbes(): Promise<readonly StartupProbeOutcome[]> {
      const outcomes: StartupProbeOutcome[] = [];
      if (persistence.postgres !== null) {
        outcomes.push({ provider: 'neon', attached: true, probed: true, ok: await persistence.postgres.probe() });
      } else {
        outcomes.push({ provider: 'neon', attached: false, probed: false, ok: false });
      }
      if (persistence.redis !== null) {
        outcomes.push({ provider: 'upstash', attached: true, probed: true, ok: await persistence.redis.probe() });
      } else {
        outcomes.push({ provider: 'upstash', attached: false, probed: false, ok: false });
      }
      if (persistence.objectStore !== null) {
        outcomes.push({ provider: 'r2', attached: true, probed: true, ok: await persistence.objectStore.probe() });
      } else {
        outcomes.push({ provider: 'r2', attached: false, probed: false, ok: false });
      }
      if (vercel !== null) {
        const user = await vercel.probe();
        outcomes.push({ provider: 'vercel', attached: true, probed: true, ok: user !== null });
      } else {
        outcomes.push({ provider: 'vercel', attached: false, probed: false, ok: false });
      }
      return outcomes;
    },
    health(): ProviderHealthReport {
      return persistence.health();
    },
    providerStates() {
      const states = [...persistence.providerStates()];
      if (vercel !== null) {
        states.push(vercel.providerState());
      } else {
        states.push({
          state: 'UNKNOWN',
          provider_id: 'vercel',
          probed_at: null,
          credential_env: null,
          api_revision: null,
          last_error: null,
          probes: [],
          note: 'no VERCEL_TOKEN configured in the injected source (the honest state is UNKNOWN — never fabricated)',
        });
      }
      return states;
    },
  };
}
