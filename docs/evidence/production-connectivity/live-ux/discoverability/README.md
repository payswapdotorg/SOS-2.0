# P18-C Evidence — UX Discoverability + End-to-End Journey Instrumentation

Work Order: **P18-C** (Live UX, lane C of 3 — UX discoverability + journey
instrumentation). Base: `3717b6c`. Lane branch: `wo/p18c-ux-discoverability`.

This directory records what a FRESH USER can and CANNOT discover in the
product on this branch — with the actual UI evidence (rendered strings,
link targets, honest states) — and the journey-spec instrumentation that
verifies discoverability end to end. Gaps are recorded honestly: they are
findings for the architect's integration pass, never delivery blockers,
and never fabricated as done.

## What this lane delivered

1. **The root first-user surface** (`apps/web/app/page.tsx` +
   `apps/web/app/start-surface.tsx`): `/` now opens with
   **"What are you trying to accomplish?"** — the three accomplishment
   paths (start something new → `/onboarding/greenfield`; bring an
   existing system → `/onboarding/brownfield`; resume or watch current
   work → `/mission`), **onboarding as a first-class entry** (the P18
   structural fix, `/onboarding`), and **the five first-run
   understandings** (progressive disclosure via native
   `details`/`summary`, zero client JavaScript): SOS watches continuously;
   SOS can summon bodies; the user's computer is optional; SOS asks when
   authority or evidence is insufficient; completion requires independent
   verification. The P1 overview composition (hero, below-hero cards,
   active autonomous work) is KEPT below the discovery surface for
   returning users — strengths preserved, discovery gaps fixed.
2. **The journey + discoverability suites** (`tests/live-ux/journeys/**`):
   root-page and onboarding discoverability specs (run fully on this
   branch), twelve component-level journey specs over the P17-C
   `LiveMissionPage` with scripted honest DTO states (built through the
   DTO producer helpers), and route-level full-path specs
   (mission route → live observed state → consequential action → receipt
   → evidence) that are **capability-gated**: while the P18-B mounts are
   absent on this branch they skip with the explicit reason
   `requires-p18b-mount`; at integration they MUST all be enabled and
   green before P18 completes.

## Records

| File | What it records |
| --- | --- |
| `ARCHITECTURE-DELTA.json` | the architecture delta for the lane (validated against `spec/contracts/architecture-delta.schema.json`, `work_order: P18-C`) |
| `discoverability-record.json` | per journey: what a fresh user CAN discover today (rendered strings, link targets, honest states) and what remains non-discoverable (the honest gap list) |
| `journey-spec-index.json` | the spec inventory: which suites run on-branch vs capability-gated, and the integration contract for enabling the gated suites |
| `secrets-audit.json` | the secrets audit (trivial for this lane — stated, with the scan) |

## The honesty rules this lane held

- **No fabricated discoverability**: the root links only REAL routes that
  exist on this branch (machine-checked against `apps/web/app` by suite
  `00`). The live mission route is NOT linked as live because it does not
  exist until the P18-B mount — the gap is recorded below and in the
  record, not papered over.
- **No fabricated pass states**: the route-level suites skip with the
  explicit reason `requires-p18b-mount` while the mount is absent; an
  always-run capability probe reports the gate state in the suite output.
- **Server-rendered only**: the root surface is a pure server component
  (no `use client`, no client fetches, no scripts in the output — pinned
  structurally by suite `00`; the Next build prerenders `/` as static
  content).
- **Progressive disclosure, never loss of provenance or uncertainty**: the
  five understandings are collapsed by default but their full text is in
  the server-rendered markup; every surface they link renders its own
  honest states, LIVE/DEMO badges and the six product review questions.
- **Base suites stay green**: the FULL repository suite passes exactly as
  at base (see reproduction below).

## The frozen thin-wrapper constraint (recorded for the architect)

`apps/web/shell/test/navigation.test.ts` (frozen, shell-owned) pins every
shell route — including `apps/web/app/page.tsx` — to a thin wrapper of ≤ 11
non-empty lines importing from `shell/`. The discovery surface therefore
lives in **`apps/web/app/start-surface.tsx`**, a COLOCATED non-route file
beside the route (the Next.js colocation pattern; it creates no route and
modifies nothing outside this lane's owned root surface), and `page.tsx`
is again a thin wrapper (10 non-empty lines, importing `PageShell` from
the shell). This is the minimal deviation from the literal owned-path
list ("`apps/web/app/page.tsx`") required BY a frozen contract; suite `00`
independently pins the thin-wrapper contract so the integration head
cannot regress it.

## How to reproduce

```bash
corepack pnpm install --prefer-offline
node scripts/verify-repo.mjs
node scripts/verify-productization.mjs
pnpm install --frozen-lockfile
pnpm -r --if-present build
pnpm -r --if-present test          # the FULL suite — green exactly as at base
pnpm --filter @sos-2/tests-live-ux test   # this lane's suites alone:
                                        # 15 files, 119 passed | 6 skipped
                                        # (the skip reason is requires-p18b-mount,
                                        #  reported by the always-run capability probe)
```

No credentials are required (reference-mode UI journeys only); nothing
here performs real provider calls.
