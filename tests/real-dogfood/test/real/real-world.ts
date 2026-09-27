/**
 * The REAL dogfood suite's ambient process boundary (Work Order P19) —
 * the ONE impure boundary of the env-gated real suite: the environment
 * snapshot (env NAMES only in every output), the real wall clock, the
 * real sleep, the evidence writer and the honest RUN_REAL gate. Every
 * credential VALUE flows onward into the real adapters and is never
 * echoed here.
 */

export const RUN_REAL = process.env['RUN_REAL'] === '1';

/** The ambient environment snapshot (the caller-owned read; names only in outputs). */
export function ambientSource(): Readonly<Record<string, string>> {
  const source: Record<string, string> = {};
  for (const name of ['PAYSWAP_GITHUB_TOKEN', 'GITHUB_ACCESS_TOKEN', 'OPENROUTER_API_KEY', 'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'SOS_DOGFOOD_BODY_MODEL', 'DATABASE_URL']) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) {
      source[name] = value;
    }
  }
  return source;
}

/** The credential env NAMES present in the ambient source (never the values). */
export function credentialEnvNames(source: Readonly<Record<string, string>>): readonly string[] {
  return Object.keys(source).sort();
}

/** A REAL wall clock — real evidence timestamps (live-store Clock shape). */
export const realClock: { nowEpochMs(): number } = {
  nowEpochMs: () => Date.now(),
};

/** The real sleep (deployment readiness polls). */
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
