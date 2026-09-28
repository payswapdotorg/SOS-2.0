# P21 — Live Provider Re-verification & Final-Head Deployment Refresh

Dependencies: P20  
Owned paths: docs/evidence/production-release/p21-live-reverification/**  
Owner: Architect  
Status origin: appended by the architect AFTER the P0–P20 program reconcile — the operator
supplied live provider credentials (GitHub PAT + Composio-managed Vercel/Neon accounts),
lifting the P20 release record's NOT-REDEPLOYED-NO-CREDENTIALS condition. This work order
converts that deferred honest state into fresh live evidence.

## Gate

- Provider re-verification: live, current-time probes against every provider that now has
  a working credential channel (GitHub via the operator's PAT; Vercel and Neon via the
  Composio-managed connected accounts). Exact timestamps, revisions, account identifiers,
  and the exact channel used (API path / SDK / MCP / action id) recorded per provider.
- Deployment refresh: a NEW production deployment of the exact release head (f7774c7) is
  created and bound to the release evidence — deployment id, url, readyState, commit sha,
  project id, runtime verification (manifest byte-exact vs the deployed tree).
  If a provider's deploy path is genuinely unreachable through the available channel,
  the blocker is recorded with full attempt evidence (BLOCKED-PATH with the exact API
  responses) — never faked, never silently skipped.
- Persistence lane re-check: Neon was UNAVAILABLE (DNS) in the P17A/P19 era; with the
  Composio-managed Neon account, re-probe and record the current honest state.
- Honesty invariants (unchanged from P19/P20): credential VALUES never appear in any
  file, transcript, or record — environment-variable NAMES and Composio account IDs only;
  dual-redaction before serialization; secrets audit of all new evidence = 0 findings;
  no provider becomes an SOS semantic dependency; frozen W0–W18 core untouched
  (967c066dd716..HEAD: 0 modified / 0 deleted in spec/contracts and packages/contracts);
  deterministic reference-mode suites remain green.

## Machine backbone (unchanged discipline)

verify:repo PASS + verify:productization PASS (frontier [P21]) on the exact base; full
workspace build EXIT 0; deterministic test suite green (4308 passed / 0 failed expected —
matching the P20-gate baseline); frozen-core diff 0/0; zero provider SDK dependencies
added to the deterministic surface.

## Deliverables (owned path only)

- `p21-provider-reverification.json` — machine record (P16 audit-record schema): per-
  provider probe results, channel descriptions, timestamps, revisions, honest states.
- `p21-deployment-record.json` — the new deployment bound to the release head, or the
  fully evidenced BLOCKED-PATH record.
- `p21-secrets-audit.json` — 0-findings audit of every new file, pattern ids + file +
  line only.
- `backbone-log.md` — the machine backbone execution log.
- Architect approval is requested by the record (PENDING-ARCHITECT), granted only after
  the dispatching lead's independent re-verification.

## Completion

Architect approval + actual merge + productization machine-state reconciliation
(P21 COMPLETE + mergedAs, frontier []).

**Honest-state discipline is the completion criterion: real probes, real records, real
blockers where they exist. No fabricated CONNECTED anywhere.**
