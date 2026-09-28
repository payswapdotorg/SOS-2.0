# P20 Backbone Log — raw machine-backbone record

The §3 machine backbone of the P20 release gate, executed at the dispatched
release-worker's station on the exact main head. Every command, exit code,
key output line and duration, plus the environment notes. Companion of
`p20-release-audit-record.json` (machine) and `p20-release-gate-audit.md`
(narrative).

## 0. Environment

- Executor: P20-release-worker (dispatched Tech-Lead session).
- Date (UTC): 2026-09-27, ~22:59–23:29 UTC.
- node v24.21.0; pnpm 10.0.0 (the repo-pinned `packageManager`; installed
  via npm -g after corepack was unavailable in the sandbox).
- Machine: 2 CPUs, 4.1 GiB RAM, no swap. Linux (container).
- Network: public HTTPS egress works (git clone from github.com
  succeeded); **no provider credentials in the environment** — env scan
  for GITHUB*/OPENROUTER*/VERCEL*/NEON*/UPSTASH*/R2_*/PAYSWAP* found
  nothing; the ambient `DATABASE_URL` is a `file:` URL (36 chars) — NOT a
  provider credential.
- Station constraint (recorded honestly): the sandbox **reaps every
  background process at shell-session boundaries** (verified with a
  detached heartbeat process — dead at the next session). Any command
  longer than one tool session (~10 min) must be chunked; the full-suite
  execution below is chunked and recorded exactly as it ran.

## 1. Setup — public main at the exact base

```
$ git clone https://github.com/payswapdotorg/SOS-2.0.git sos-2.0-p20
  Cloning into 'sos-2.0-p20'...                       [ok]
$ git checkout 3bfc469a58ff4a4fbc5e7d653cb49f759b04e73d
  HEAD is now at 3bfc469 gov: reconcile state after P19 merge — P19 COMPLETE (PR #45); frontier P20 READY
$ git rev-parse HEAD
  3bfc469a58ff4a4fbc5e7d653cb49f759b04e73d            [matches the mandated base]
BASE=3bfc469a58ff4a4fbc5e7d653cb49f759b04e73d
$ pnpm install
  Progress: resolved 105, downloaded 105, added 105, done.
  Done in 6.8s                                       [exit 0]
  note: "dependencies with build scripts that were ignored: esbuild"
  (inert for the suite — the platform binary ships as an optional
  dependency; the deterministic run below proves the point)
```

## 2. Baseline gates (run FIRST, both must PASS)

```
$ pnpm verify:repo
  SOS 2.0 repository contract check: PASS
  Work Orders discovered: 19
  Frontier:
  EXIT=0  DURATION=0s

$ pnpm verify:productization
  SOS productization repository contract check: PASS
  Productization Work Orders: 26
  Frontier: P20
  Owned paths: 91
  All dependency edges, owned paths and machine state are consistent.
  EXIT=0  DURATION=0s
```

Honest note: the dispatch packet expected "23 productization tasks"; the
verifier's authoritative count at this head is **26 work orders** (26 task*entries in the machine state: P0..P16 + P17-A/B/C  +P18-A/B/C/INT + P19 =
25 COMPLETE + P20 READY). Both gates PASS with frontier [P20] — the
packet's count was stale, not a gate discrepancy. Recorded, not smoothed.

## 3. The machine backbone

### 3.1 / 3.2 Verifiers (also re-run at the END of the backbone, bound to the same head)

Final binding runs (identical to §2):

```
$ pnpm verify:repo        → exit 0, "SOS 2.0 repository contract check: PASS", 19 WOs, frontier empty.  DURATION=1s
$ pnpm verify:productization → exit 0, PASS, 26 WOS, frontier P20, 91 owned paths.                     DURATION=0s
```

### 3.3 Deterministic suite

**(a) Full workspace build** (the repo's documented order: build, then
test — the P17-A README reproduce block and the P16 backbone both build
first; the test scripts themselves re-run `pnpm run build`):

```
$ pnpm -r --if-present build
  EXIT=0  DURATION=142s
  BUILT=109  FAILED=0        # 115 workspace projects; 6 declare no build script
  last lines: "apps/web build: Done" / "tests/product-dogfood build: Done"
```

Execution note (honest): the build was first executed chunk-by-chunk (4
topological chunks + 1 single-package completion, all exit 0: 22s + 30s +
37s + 63s) after the sandbox's background-process reaping was discovered;
the numbers above are the clean SINGLE foreground pass over the whole
workspace at the final (renamed) checkout. One chunking bug was found and
fixed mid-way: the chunk files lacked trailing newlines so a `while read`
loop dropped the last entry (packages/conformance) — it was built
explicitly (exit 0) and the full pass above supersedes the chunks.

**(b) Deterministic test suite — every test-bearing package exactly once.**
Executed as 4 sequential topological chunks (the sandbox reaps background
processes, making a single >10-min foreground run infeasible — recorded
exactly as it ran):

```
chunk-1 (28 pkgs): EXIT=0  DURATION=73s   passed=1077 failed=0
chunk-2 (29 pkgs): EXIT=0  DURATION=105s  passed=1413 failed=0
chunk-3 (29 pkgs): EXIT=0  DURATION=98s   passed=707  failed=0
chunk-4 (29 pkgs): EXIT=0  DURATION=163s  passed=1111 failed=0   # 28 ran; 1 pkg has no test script
TOTAL: 114 packages ran, 114 exited 0, 4308 tests passed / 0 failed
       (104 vitest "Tests" summary lines; 115 projects total;
        @sos-2/web-live-data (apps/web/live-data) declares no test script
        and is skipped by --if-present)
```

All 5 env-gated real suites printed their honest exit-0 skip lines inside
the run:

```
tests/live-ux/actions test:      RUN_REAL is not set — the real-integration suite stays OFF (deterministic reference-mode only).
tests/live-ux/data-plane test:  [tests-live-ux-data-plane] running the deterministic reference-mode suite (RUN_REAL not set — the real suite stays OFF)
tests/live-ux/integration test: RUN_REAL is not set — the real-integration suite stays OFF (deterministic integrated suite only).
tests/real-dogfood test:        RUN_REAL is not set — the real-dogfood suite stays OFF (deterministic integrated suite only).
tests/real-observation test:    RUN_REAL is not set — the real-provider integration suite stays OFF (deterministic reference-mode only).
```

**Environmental incident (recorded verbatim, resolved, full re-run):**
the FIRST full-suite attempt (clone directory `/home/z/sos-2.0-p20`)
failed exactly one test in frozen-core `packages/contracts`:

```
packages/contracts test: FAIL test/schema-loader.test.ts > schema loader (spec/contracts)
  > finds the repository root by walking up from the working directory
  AssertionError: expected '/home/z/sos-2.0-p20' to match /SOS-2\.0$/
  Tests  1 failed | 39 passed (40)
```

The frozen test asserts the checkout directory is NAMED `SOS-2.0` — a
station artifact of the clone directory name, not a code regression. Fix:
renamed the checkout to `/home/z/SOS-2.0` (the shape the test asserts),
re-ran the ENTIRE build (109/109, exit 0) and ALL 4 test chunks clean
(4308/0). No test was weakened, skipped, or edited; the failure and its
cause are recorded here rather than hidden.

### 3.4 Frozen-core check

```
$ git diff --stat 967c066dd71691314df39abdcc56e289aca88fb6..HEAD -- spec/contracts packages/contracts
  28 files changed, 2380 insertions(+)
$ git diff --name-status 967c066dd716..HEAD -- spec/contracts packages/contracts | awk '{print $1}' | sort | uniq -c
  28 A          # 28 Additions, 0 Modified, 0 Deleted
```

- modified = **0**, deleted = **0** (expected 0/0 — GREEN).
- All 28 additions come from the W-series core-establishment commits
  themselves: c4d2e20 ("gov: establish work orders, contracts and
  implementation guardrails"), adf3156 (W0.5, PR #1), e6be279 (W18 Final
  Architect Gate). **Zero commits after the W18 final gate touched either
  path** — the P0–P19 program left the frozen core completely untouched.
- Packet note: the dispatch's abbreviated base `967c066a` does NOT
  resolve (the actual commit's 7th char is `d`); the intended base is
  `967c066dd71691314df39abdcc56e289aca88fb6` ("arch: establish SOS 2.0
  semantic architecture and research basis") — the same commit the P16
  record cites as `967c066`. Used throughout.

### 3.5 Reproducibility spot-check (reference mode)

The P19 dogfood scripted-world journey — the non-real (scripted /
deterministic) mode of `tests/real-dogfood` (its documented default;
`pnpm test` = build + `vitest run` + the honest RUN_REAL gate):

```
$ pnpm --filter @sos-2/tests-real-dogfood run test
  EXIT=0  DURATION=12s
   ✌ test/journey.test.ts (10 tests) 1945ms
   ✓ test/reproducibility.test.ts (3 tests) 906ms
      ✓ both runs COMPLETE with the SAME outcome classes (stage sequence, verdict classes, store mode)
      ✓ the equivalence record is honest: the differences are recorded, never fabricated into equality
   ✓ test/repair-ask.test.ts (3 tests) 439ms
   ✓ test/evidence-shape.test.ts (3 tests) 343ms
   ✓ test/authority.test.ts (2 tests) 33ms
   ✓ test/idempotency.test.ts (1 test) 17ms
   ✓ test/structure.test.ts (6 tests) 6ms
   Test Files  7 passed (7)
        Tests  28 passed (28)
  RUN_REAL is not set — the real-dogfood suite stays OFF (deterministic integrated suite only).
```

The REAL mode (`RUN_REAL=1 … pnpm run test:real`, fresh external
repositories): **BLOCKED-NO-CREDENTIALS** at this station — the required
GITHUB_ACCESS_TOKEN / OPENROUTER_API_KEY / VERCEL_TOKEN / VERCEL_ORG_ID
do not exist in this environment (env verified empty of provider
credentials). Never attempted with fake credentials, never marked green.

### 3.6 Supporting scans (gate points 5–6)

```
$ node infra/production-connectivity/scripts/check-zero-deps.mjs
  zero-external-deps check: PASS (…no external registry dependencies)   EXIT=0

$ grep for provider SDKs (@neon|@upstash|@vercel|openai|@octokit|@aws-sdk) in every package.json
  → ZERO matches across packages/, apps/, infra/, tests/

$ semantic-core dependency review (contracts, semantic-spine, authority, mission,
  value, context, system-state, architecture, provenance, telemetry)
  → every one declares only @types/node / ajv / fast-check / typescript / vitest
    (+ workspace:* @sos-2/*); no provider package in any semantic closure
```

### 3.7 Tree integrity

```
$ git status --porcelain   → (empty)
$ git rev-parse HEAD       → 3bfc469a58ff4a4fbc5e7d653cb49f759b04e73d
```

The tracked tree at the executed head is byte-identical to the clone; the
only filesystem additions are this evidence directory
(`docs/evidence/production-release/`), created inside the
owned surface.

## 4. Command count

Commands logged in this backbone: 19 numbered/atomic entries above
(clone, checkout, rev-parse ×2, install, verify ×2 (×2 runs), build
(single pass; chunks recorded as notes), 4 test chunks, rename + rebuild,
frozen-core diff ×2, reproducibility spot-check, zero-deps check, SDK
scan, semantic-core scan, credentials scan, status check, heartbeat
probe). Every exit code is recorded; every gap is named.
