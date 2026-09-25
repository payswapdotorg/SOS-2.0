# P17-B — Real GitHub + Execution Connectivity

Dependencies: P16  
Owned paths: packages/real-github, packages/real-bodies, tests/real-github, tests/real-bodies, docs/evidence/production-connectivity/github-execution  
Lane of P17 (GitHub/execution); Workers deliver, Architect gates

## Goal

Turn the existing provider-neutral GitHub contract into a real authenticated repository
integration and connect at least one real cloud/remote execution body behind the existing
Body/Harness interfaces.

## Scope

- Real GitHub integration behind the existing contracts: GitHub OAuth/App, repository
  discovery/import, branch/PR operations.
- At least one real body provider behind the Body/Harness interfaces (cloud sandbox, hosted
  coding harness, or private runner).
- The body abstraction remains unchanged. No vendor becomes part of SOS semantics.
- Cloud execution must not require the user's computer. The user computer remains optional.
- Bodies remain replaceable and cannot mint/widen authority or self-certify completion.

## Evidence requirements

- Real authenticated operations against a real repository (discovery, import, branch, PR)
  with exact API revisions and identifiers.
- A durable task executed end-to-end by a real body: lease, checkpoint, evidence emission,
  independent evaluation — transcripts with exact timestamps and revisions.
- Honest provider states (`CONNECTED` / `UNKNOWN` / `UNAVAILABLE` / `DEGRADED`).

## Acceptance

Repository import and PR operations work for real through the contract surface; a real
cloud body completes a durable task while the user's computer is not required; body leases,
replacement and independent evaluation behave per the frozen execution-fabric rules;
deterministic reference-mode tests remain green; real-provider integration tests recorded
separately.

## Completion

Branch + independent architect gate + PR + CI + squash-merge + machine-state reconcile.
Workers stop at WAITING_FOR_ARCHITECT on contract ambiguity or vendor lock-in risk.
