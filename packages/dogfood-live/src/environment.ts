/**
 * The P19 environment registry — the env-only credential discipline
 * (names only, never values) applied exactly the way the merged
 * adapters define it. This package NEVER reads the ambient environment:
 * the caller injects a raw source record at the composition boundary
 * (the process boundary reads the environment; library code never does).
 *
 * The registry (§2 of the P19 task packet, binding):
 *   - the GitHub PAT: PAYSWAP_GITHUB_TOKEN (the @sos-2/real-github
 *     operational name) with GITHUB_ACCESS_TOKEN (the P4 registry name)
 *     accepted as the alternate — the merged adapter's exact names;
 *   - OPENROUTER_API_KEY      the @sos-2/real-bodies model-credential name;
 *   - VERCEL_TOKEN            the @sos-2/deployment-providers token name;
 *   - VERCEL_ORG_ID           the team/org scope (public identity);
 *   - SOS_DOGFOOD_BODY_MODEL  the optional model override for the
 *     hosted coding body (default qwen/qwen3-coder-flash).
 */

/** The env variable NAMES this harness understands (names only — never values). */
export const DOGFOOD_ENVIRONMENT_VARIABLES = {
  /** The P17-B operational GitHub credential (the program PAT). */
  githubOperationalToken: 'PAYSWAP_GITHUB_TOKEN',
  /** The P4 registry GitHub credential name (alternate). */
  githubRegistryToken: 'GITHUB_ACCESS_TOKEN',
  /** The hosted-model credential (OpenRouter). */
  openRouterApiKey: 'OPENROUTER_API_KEY',
  /** The Vercel deployment token. */
  vercelToken: 'VERCEL_TOKEN',
  /** The Vercel team/org id (public identity). */
  vercelOrgId: 'VERCEL_ORG_ID',
  /** The optional dogfood body-model override (§1 IMPLEMENTING). */
  dogfoodBodyModel: 'SOS_DOGFOOD_BODY_MODEL',
  /** The optional canonical durable-store credential (Neon; absent in the P19 runtime). */
  databaseUrl: 'DATABASE_URL',
} as const;

/** The injected raw environment source record (never the ambient environment). */
export type DogfoodRawEnvironmentSource = Readonly<Record<string, string>>;

/** The honest resolution of the dogfood environment slice (env NAMES only in outputs). */
export interface DogfoodEnvironmentResolution {
  readonly github: {
    /** The token VALUE (flows onward into the transport; never echoed). */
    readonly token: string | null;
    /** The env NAME the token came from, or null. */
    readonly credentialEnv: string | null;
  };
  readonly openRouter: {
    readonly apiKey: string | null;
    readonly credentialEnv: string | null;
  };
  readonly vercel: {
    readonly token: string | null;
    readonly credentialEnv: string | null;
    readonly orgId: string | null;
    readonly orgIdEnv: string | null;
  };
  /** The body model override (env NAME + value are both non-secret; the value is a model id). */
  readonly bodyModel: string | null;
  readonly bodyModelEnv: string | null;
  readonly databaseUrl: string | null;
  readonly databaseUrlEnv: string | null;
  /** One honest sentence about this resolution. */
  readonly note: string;
}

function optional(source: DogfoodRawEnvironmentSource, name: string): string | null {
  const value = source[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Resolve the dogfood environment slice from an injected source record (names only in outputs). */
export function resolveDogfoodEnvironment(source: DogfoodRawEnvironmentSource): DogfoodEnvironmentResolution {
  const githubOperational = optional(source, DOGFOOD_ENVIRONMENT_VARIABLES.githubOperationalToken);
  const githubRegistry = optional(source, DOGFOOD_ENVIRONMENT_VARIABLES.githubRegistryToken);
  const openRouterKey = optional(source, DOGFOOD_ENVIRONMENT_VARIABLES.openRouterApiKey);
  const vercelToken = optional(source, DOGFOOD_ENVIRONMENT_VARIABLES.vercelToken);
  const vercelOrgId = optional(source, DOGFOOD_ENVIRONMENT_VARIABLES.vercelOrgId);
  const bodyModel = optional(source, DOGFOOD_ENVIRONMENT_VARIABLES.dogfoodBodyModel);
  const databaseUrl = optional(source, DOGFOOD_ENVIRONMENT_VARIABLES.databaseUrl);
  const github = githubOperational !== null
    ? { token: githubOperational, credentialEnv: DOGFOOD_ENVIRONMENT_VARIABLES.githubOperationalToken }
    : githubRegistry !== null
      ? { token: githubRegistry, credentialEnv: DOGFOOD_ENVIRONMENT_VARIABLES.githubRegistryToken }
      : { token: null, credentialEnv: null };
  return {
    github,
    openRouter: {
      apiKey: openRouterKey,
      credentialEnv: openRouterKey === null ? null : DOGFOOD_ENVIRONMENT_VARIABLES.openRouterApiKey,
    },
    vercel: {
      token: vercelToken,
      credentialEnv: vercelToken === null ? null : DOGFOOD_ENVIRONMENT_VARIABLES.vercelToken,
      orgId: vercelOrgId,
      orgIdEnv: vercelOrgId === null ? null : DOGFOOD_ENVIRONMENT_VARIABLES.vercelOrgId,
    },
    bodyModel,
    bodyModelEnv: bodyModel === null ? null : DOGFOOD_ENVIRONMENT_VARIABLES.dogfoodBodyModel,
    databaseUrl,
    databaseUrlEnv: databaseUrl === null ? null : DOGFOOD_ENVIRONMENT_VARIABLES.databaseUrl,
    note:
      'The dogfood credentials resolve from the injected source by NAME only ' +
      `(${DOGFOOD_ENVIRONMENT_VARIABLES.githubOperationalToken} or ${DOGFOOD_ENVIRONMENT_VARIABLES.githubRegistryToken}, ` +
      `${DOGFOOD_ENVIRONMENT_VARIABLES.openRouterApiKey}, ${DOGFOOD_ENVIRONMENT_VARIABLES.vercelToken}, ` +
      `${DOGFOOD_ENVIRONMENT_VARIABLES.vercelOrgId}; optional ${DOGFOOD_ENVIRONMENT_VARIABLES.dogfoodBodyModel}). ` +
      'Values never appear in outcomes, notes, telemetry or evidence; a resolved credential is PREPARED, never CONNECTED — ' +
      'connection requires the real authenticated probes.',
  };
}

/** The default dogfood body model (§1 IMPLEMENTING; the P17-B verified default). */
export const DOGFOOD_DEFAULT_BODY_MODEL = 'qwen/qwen3-coder-flash';
