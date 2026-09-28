# P21 Backbone Log — raw machine-backbone record

The machine backbone of the P21 work order (spec/productization-work-orders/
P21-live-provider-reverification.md), executed at the dispatched delivery
worker's station on the exact mandated base head. Every command, exit code,
key output line and duration, plus the environment notes. Companion of
`p21-provider-reverification.json` (machine record), `p21-deployment-record.json`
(the deployment-refresh outcome) and `p21-secrets-audit.json` (the 0-findings
audit).

## 0. Environment

- Executor: P21-delivery-worker (dispatched session).
- Date (UTC): 2026-09-28, backbone 07:14–07:30 UTC; live provider probes
  07:31–07:45 UTC (every probe timestamped in the machine records).
- node v24.21.0; git 2.47.3; curl 8.14.1; pnpm 10.0.0 (`pnpm: command not found`
  at start — installed via `npm i -g pnpm`, matching the repo-pinned
  `packageManager: pnpm@10.0.0`).
- Machine: 2 CPUs, 4.1 GiB RAM, no swap. Linux (container).
- Network: public HTTPS egress works — github.com (clone), api.github.com,
  backend.composio.dev and api.vercel.com all answer from this station;
  **api.neon.tech still fails DIRECT DNS from this station** (`curl: (6) Could
  not resolve host: api.neon.tech` — recorded verbatim, the P17-A/P19
  precedent): the Neon lane is reached THROUGH the Composio credential channel,
  never through station egress. Honest distinction, recorded in the provider
  record.
- Credentials: supplied by the operator for this work order as environment
  values only (`GITHUB_ACCESS_TOKEN`, `COMPOSIO_API_KEY`,
  `COMPOSIO_MCP_API_KEY`). They are held ONLY in an uncommitted env file
  OUTSIDE the repo tree (mode 600) and in process environments of the
  transient probe scripts; they NEVER appear in any committed file, record,
  transcript or log — every record below references credential NAMES and
  Composio connected-account IDs only. The MCP key channel was not needed
  (the v3 REST channel answered everything); it is recorded by name only.
- Station constraint (the P20 precedent): the sandbox reaps background
  processes at session boundaries, so the deterministic suite runs as
  SEQUENTIAL CHUNKS — recorded exactly as it ran (§3.2).
- Probes run as transient scripts under `/home/z/.p21-work/` (outside the
  repo tree): plain `node`/`curl` processes, never imports into the SOS
  package surface — no provider became a semantic dependency (§3.4).

## 1. Setup — public main at the exact base

```
$ git clone https://github.com/payswapdotorg/SOS-2.0
  Cloning into 'SOS-2.0'...                            [ok — directory name
                                                        SOS-2.0, the shape the
                                                        frozen schema-loader
                                                        test asserts
                                                        (/SOS-2\.0$/)]
$ git rev-parse HEAD
  45e53731a2378aab41e326fded8168046d42b513            [matches the mandated
                                                        base "45e5373" —
                                                        "gov: append P21 …
                                                        frontier [P21]"]
$ git checkout -b wo/p21-live-reverification
  Switched to a new branch 'wo/p21-live-reverification'
$ pnpm --version
  pnpm: command not found                              [as the packet predicted]
$ npm i -g pnpm
  pnpm 10.0.0
$ pnpm install
  Progress: resolved 105, downloaded 105, added 105, done.
  Done in 6.8s                                         [exit 0]
  note: "The following dependencies have build scripts that were ignored:
  esbuild" (inert for the suite — the platform binary ships as an optional
  dependency; the deterministic run below proves the point; the identical
  note appears in the P20 backbone log)
```

## 2. Baseline gates (run FIRST, both must PASS — both did)

```
$ node scripts/verify-repo.mjs
  SOS 2.0 repository contract check: PASS
  Work Orders discovered: 19
  Frontier:
  EXIT=0

$ node scripts/verify-productization.mjs
  SOS productization repository contract check: PASS
  Productization Work Orders: 27
  Frontier: P21
  Owned paths: 92
  All dependency edges, owned paths and machine state are consistent.
  EXIT=0
```

Both gates match the dispatch packet exactly (19 WOs / 27 WOs, frontier
[P21], 92 owned paths) on the exact base head. The backbone did not start
until both PASSed.

## 3. The machine backbone

### 3.1 Full workspace build

```
$ pnpm -r --if-present build
  EXIT=0  DURATION=157s   (2026-09-28T07:14:36Z → 07:17:13Z)
  BUILT=109  FAILED=0     # 115 workspace projects; 6 declare no build
                          # script and are skipped by --if-present
  last line: "apps/web build: Done"
```

### 3.2 Deterministic test suite — every test-bearing package exactly once

115 workspace projects; 114 declare a test script
(`@sos-2/web-live-data` — apps/web/live-data — does not and is skipped by
`--if-present`; the P20-gate baseline shape). Executed as **4 sequential
chunks** (the sandbox reaps background processes, making a single >10-minute
foreground run infeasible): the 114 test-bearing package names were listed
from the pnpm workspace, split by workspace root in topological order
(packages first, then apps + infra, then tests), and each chunk ran as one
foreground `pnpm --filter <names…> run test` invocation:

```
chunk-1 (39 pkgs — packages/*, @sos-2/action-gateway … @sos-2/live-store):
  EXIT=0  DURATION=115s  (07:22:29Z → 07:24:24Z)
  passed=1404 failed=0   # 35 vitest summaries, 124 test files
chunk-2 (38 pkgs — packages/*, @sos-2/local-companion … @sos-2/worker-runtime):
  EXIT=0  DURATION=130s  (07:24:39Z → 07:26:49Z)
  passed=1461 failed=0   # 38 vitest summaries, 132 test files
chunk-3 (14 pkgs — apps/* + infra/*):
  EXIT=0  DURATION=39s   (07:27:03Z → 07:27:42Z)
  passed=343 failed=0    # 13 vitest summaries, 31 test files
chunk-4 (23 pkgs — tests/*):
  EXIT=0  DURATION=146s  (07:27:49Z → 07:30:15Z)
  passed=1100 failed=0   # 24 vitest summaries (incl. the 4 custom
                         # run-tests.mjs dispatchers), 167 test files

TOTAL: 114 packages ran, 114 exited 0,
       4308 tests passed / 0 failed
       (1404 + 1461 + 343 + 1100 = 4308 — EXACTLY the P20-gate baseline;
        110 vitest "Tests" summary lines + 4 custom run-tests.mjs suites
        = the 114 test-bearing packages, each exactly once)
```

Counting method (recorded exactly): every vitest `Tests  N passed` summary
line in the four chunk logs was summed; per-chunk exit codes and per-package
`Done` lines (39 + 38 + 14 + 23 = 114) cross-checked the package coverage.

All 5 env-gated real suites printed their honest exit-0 skip lines inside
the run (RUN_REAL not set; nothing real ran uninvited, nothing fabricated
green):

```
tests/live-ux/data-plane : "[tests-live-ux-data-plane] running the deterministic
                            reference-mode suite (RUN_REAL not set — the real
                            suite stays OFF)"
tests/live-ux/actions    : "RUN_REAL is not set — the real-integration suite
                            stays OFF (deterministic reference-mode only)."
tests/live-ux/integration: "RUN_REAL is not set — the real-integrated suite
                            stays OFF (deterministic integrated suite only)."
tests/real-observation   : "RUN_REAL is not set — the real-provider integration
                            suite stays OFF (deterministic reference-mode only)."
tests/real-dogfood       : "RUN_REAL is not set — the real-dogfood suite stays
                            OFF (deterministic integrated suite only)."
```

No environmental failure occurred this run (the P20 clone-directory incident
was avoided from the start — the checkout was created as `SOS-2.0`); no test
was weakened, skipped or edited; the first full execution was the clean one.

### 3.3 Frozen core (W0–W18 untouched)

```
$ git diff --stat 967c066dd716..HEAD -- spec/contracts packages/contracts
  28 files changed, 2380 insertions(+)
$ git diff --name-status 967c066dd716..HEAD -- spec/contracts packages/contracts
  28 A / 0 M / 0 D
```

0 modified / 0 deleted — every change is a pure ADDITION from the W-series
core-establishment commits themselves (the identical result the P16/P20
records hold; zero commits after the W18 final gate touched either path).
Note (the P20 record's observation applies): the dispatch packet's
abbreviated base `967c066a` does not resolve; the intended base is
`967c066dd71691314df39abdcc56e289aca88fb6` — the form used above resolves
cleanly at this station.

### 3.4 Zero provider SDK dependencies (no provider became a semantic dependency)

```
$ node <transient scan>   # every package.json under packages/ apps/ infra/ tests/
  ZERO provider SDK dependencies anywhere in the workspace
  (no @neon*/@upstash*/@vercel*/openai/@octokit*/@aws-sdk*/composio* in any
   dependency/devDependency/peerDependency of any of the 115 projects)
$ node infra/production-connectivity/scripts/check-zero-deps.mjs
  zero-external-deps check: PASS (infra/production-connectivity declares
  workspace:* @sos-2/* + the established toolchain only; no external
  registry dependencies)
  EXIT=0
```

All provider probes (GitHub REST, Composio v3 REST) ran as transient
scripts outside the repo tree — nothing was added to the deterministic
package surface; the tracked tree below proves it.

### 3.5 Tracked tree drift

```
$ git status --porcelain   # after the backbone, before authoring evidence
  (empty — the tracked tree at 45e5373 is byte-identical to the clone)
```

The only files added afterwards are the four evidence files of THIS owned
path (`docs/evidence/production-release/p21-live-reverification/**`), which
is exactly the P21 owned surface.

## 4. Live provider probes (summary — the machine records carry the detail)

Executed immediately after the backbone, every probe timestamped (UTC):

- **github** — CONNECTED @ 2026-09-28T07:31:31Z–07:31:47Z:
  `GET /user` (login payswapdotorg, HTTP 200), `GET /repos/payswapdotorg/
  SOS-2.0` (default branch main, HTTP 200), `GET /repos/…/branches/main`
  (head 45e53731a2378aab41e326fded8168046d42b513 — the exact P21 base,
  HTTP 200), `GET /rate_limit` (core 5000 limit / 666 used / 4334
  remaining, HTTP 200). Channel: api.github.com REST with the operator PAT
  (env name `GITHUB_ACCESS_TOKEN`, `Authorization: Bearer` header by name,
  `X-GitHub-Api-Version: 2022-11-28` requested; media type `github.v3;
  format=json`).
- **composio** — CONNECTED @ 2026-09-28T07:32:01Z: `GET
  https://backend.composio.dev/api/v3/connected_accounts?limit=50`
  (X-API-Key header by name) → HTTP 200, 6 accounts; vercel
  `ca_31iruA2qEdfl` ACTIVE (API_KEY scheme), neon `ca_Ktgm5irkMl1T` ACTIVE
  (API_KEY scheme). The CURRENT v3 action-execution endpoint was discovered
  from the live OpenAPI spec (`GET /api/v3/openapi.json` → 200, 74 paths):
  `POST /api/v3/tools/execute/{tool_slug}` with `{connected_account_id,
  user_id, arguments}` (user_id `default` required — the first probe without
  it failed with code 1811 and is recorded honestly).
- **vercel** — CONNECTED through the Composio channel @
  2026-09-28T07:35:08Z–07:44:02Z: VERCEL_LIST_TEAMS (2 teams),
  VERCEL_GET_PROJECT ×2 (sos-dogfood-r2 prj_WESDjCys33YVQ97idvJNVvgz9mLn;
  sos-2-0 prj_ad9K6nw6F4zlpg4bmlZi9HQyNhvQ — repo-connected to
  payswapdotorg/SOS-2.0, repoId 1377439399), VERCEL_LIST_ALL_DEPLOYMENTS ×2
  (1 dogfood deployment; 20 sos-2-0 deployments — NONE at f7774c7),
  VERCEL_GET_DEPLOYMENT_DETAILS ×2 (both READY). Runtime HTTP re-verified:
  the current production deployment serves the SOS Console (HTTP 200) and
  the P19 run-2 dogfood manifest is STILL byte-exact (details in the
  deployment record).
- **neon** — CONNECTED through the Composio channel @
  2026-09-28T07:36:33Z–07:37:20Z (lifting the P17-A/P19 UNAVAILABLE-DNS
  state FOR THE CHANNEL; the station's own direct api.neon.tech egress
  still fails DNS, recorded verbatim): NEON_GET_CURRENT_USER_INFORMATION,
  NEON_GET_USER_ORGANIZATIONS (2 orgs), NEON_RETRIEVE_PROJECTS_LIST ×3
  (the first honestly recorded org_id-required refusal, then 10 + 2
  projects), NEON_GET_BRANCHES_FOR_PROJECT (main branch), and
  NEON_ACCESS_PROJECT_DETAILS_BY_ID (pg 18, aws-us-east-1).
- **deployment refresh** — BLOCKED-PATH @ 2026-09-28T07:37:48Z–07:42:31Z:
  the clean git-source path on the repo-connected project sos-2-0 pinned to
  the exact release head f7774c731019e8e700f6357a144e1c78082ef67a was
  composed correctly through the Composio channel (after the honest
  mapping-discovery trail, 8 attempts recorded) and the PROVIDER refused it
  with HTTP 402 `api-deployments-free-per-day` (100/100 consumed, 0
  remaining, reset 2026-09-29T07:42:31.436Z). NO deployment at f7774c7 was
  created and none is claimed — the full evidence trail and the exact
  post-reset retry recipe are in `p21-deployment-record.json`.

## 5. Honest closing notes

- The backbone numbers match the P20-gate baseline EXACTLY (109 built / 4308
  passed / 0 failed / frozen-core 0-mod-0-del / zero provider SDKs) on the
  P21 base head — the deterministic surface did not move.
- Credential VALUES appear in no file of this owned path; the secrets audit
  (`p21-secrets-audit.json`) scanned all four deliverable files through the
  repo's source-scan corpus plus a P21-added Composio-prefix corpus and the
  fail-closed dual-redaction (deployment corpus then observation corpus)
  proved a no-op on every file: 0 findings.
- The one BLOCKED-PATH (deployment refresh) is a provider-side quota
  refusal on a fully-working channel — recorded with every attempt, never
  faked, never smoothed. Honest blockers are acceptable outcomes; fakes
  are not.
