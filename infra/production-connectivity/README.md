# @sos-2/infra-production-connectivity — Production-Connectivity Wiring Harness (Work Order P17-A)

The wiring harness/scripts per the `infra/deployment` precedent — the
composition layer that assembles the REAL free-tier persistence +
deployment stack **from the environment at the process boundary**:

- **`src/wiring.ts`** — `createProductionConnectivityHarness({source,
  tier, clock, fetch?, sleep?})`: env-only resolution (P3 registry
  names; the caller owns the ambient read) → the
  `@sos-2/real-persistence` stack behind the frozen P2 ports + the
  `@sos-2/deployment-providers` Vercel provider behind the frozen
  deployment contracts; `startupProbes()` runs every attached
  adapter's REAL probe (Neon SQL ping, Upstash PING, R2 HeadBucket,
  Vercel `/v2/user`) with honest outcomes; `health()` returns the
  frozen `ProviderHealthReport`; `providerStates()` returns the P17-A
  honest reports for all four providers. Absent credentials leave an
  adapter UNATTACHED and honestly UNKNOWN — never fabricated.
- **`src/evidence.ts`** — machine-readable evidence record builders:
  every record is serialized through BOTH lane redaction corpora before
  it can reach a file, and `assertEvidenceIsRedacted` fails closed on
  residual secret-shaped material (pattern ids only — never matched
  text).
- **`src/secrets-audit.ts`** — the lane secrets audit (the combined
  persistence + deployment corpora; findings carry pattern ids +
  positions only).
- **`scripts/check-zero-deps.mjs`** — workspace-only dependency
  declaration check (the P3 zero-dep discipline, adapted to the lane
  rule: `workspace:*` `@sos-2/*` + the established toolchain only — no
  external registry dependencies; the lockfile change from this lane
  is importer addition only).
- **`scripts/secret-scan.mjs`** — scans the P17-A owned paths for
  secret-shaped values (exits 1 naming file/line/column/pattern-id —
  never the matched value). Scan scope: the lane's src/scripts, the
  evidence package itself, and the tests package's non-test files
  (the deterministic test corpus intentionally contains SYNTHETIC
  secret-shaped fixtures to prove detection/redaction).

## Why this package declares workspace dependencies (not zero-dep)

`infra/deployment` declares ZERO dependencies because it is a pure
configuration-contract package whose discipline keeps `pnpm-lock.yaml`
byte-identical. This harness is the **composition root** of the
production-connectivity lane (the P17-C `composition.ts` precedent
lifted into `infra/`): a wiring harness that cannot import the
adapters it wires would be theater. It therefore declares
`@sos-2/real-persistence` and `@sos-2/deployment-providers`
(`workspace:*` only) plus the established toolchain — zero external
registry dependencies, so the lockfile change from the lane remains
importer addition only (pinned by `scripts/check-zero-deps.mjs`).

## Determinism

No ambient env, no hidden clocks, no ambient network in src: inject a
scripted FetchPort + `ManualClock` + instant sleep and the whole
harness runs offline, run-to-run identical (`test/wiring.test.ts` does
exactly that). The default fetch/sleep bindings are the documented
impure process boundary.

The real journeys run through `tests/real-persistence`
(`RUN_REAL=1`) and write the evidence package at
`docs/evidence/production-connectivity/persistence-deployment/`.
