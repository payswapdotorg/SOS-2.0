# P22 — Final-Head Deployment Completion (the P21 blocked path, closed)

Dependencies: P21  
Owned paths: docs/evidence/production-release/p22-deployment-completion/**  
Owner: Architect (architect-implemented per the P16/P12 precedent: a surgical, evidence-only
completion executed directly by the architect under the operator's directive)  
Status origin: appended by the architect after the P21 reconcile. P21's deployment refresh
ended in a fully-evidenced BLOCKED-PATH (provider HTTP 402 api-deployments-free-per-day,
100/100 consumed, reset 2026-09-29T07:42:31.436Z, exact retry recipe recorded). The operator
then supplied a raw Vercel account token (env VERCEL_TOKEN) among a wider credential bundle,
directing their use for the project. This work order closes the blocked path: execute the
deployment directly through the Vercel REST API with the raw token, bind the exact
program-complete head to production, runtime-verify, and record everything honestly.

## Gate

- Deployment: a NEW production deployment of the current program-complete head (main,
  which contains f7774c7 — the P20 release head — plus the P21 evidence and reconcile)
  created through the direct Vercel API channel, with the full request/response/polling
  trail recorded verbatim (including any rejected first attempt — honest, never smoothed).
- Runtime verification: the deployment serves the SOS Console (HTTP 200), the API-recorded
  gitSource sha equals the deployed head exactly (the P17-A sha-echo pattern), and the
  production alias serves byte-identical content to the deployment URL (md5 on both).
- Credential inventory: every credential channel the operator supplied is live-verified
  or honestly statused (unresolvable hostname, invalid-for-endpoint, staged-unprobed) in
  an inventory record — environment-variable NAMES and account/project identifiers ONLY;
  credential VALUES appear in no file, transcript, or record.
- Honesty invariants (unchanged): dual redaction discipline; secrets audit of all new
  evidence = 0 findings; no provider becomes an SOS semantic dependency; frozen core
  untouched (967c066dd716..HEAD: 0 modified / 0 deleted); deterministic suites green
  (the diff is evidence-only; the P21-gated tree is the code identity base).

## Delivery

- docs/evidence/production-release/p22-deployment-completion/deployment-completion-record.json
- docs/evidence/production-release/p22-deployment-completion/credential-inventory.json
- docs/evidence/production-release/p22-deployment-completion/p22-architect-approval.json

The merge chain (PR, squash-merge, gov reconcile P22 COMPLETE, final verify) is executed
by the architect after the gate passes — the P20/P21 pattern.
