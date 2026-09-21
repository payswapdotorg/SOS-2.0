# P11 — Local Companion + Browser/IDE Bridges

Dependencies: P3, P5, P8  
Owned paths: apps/companion, packages/local-companion, packages/browser-bridge, packages/ide-bridge, docs/local-execution, tests/local-bridges  
Worker: B in wave 4

## Goal

Support private/local bodies when work requires a user's local machine, while keeping the cloud body path independent.

## Scope

- authenticated local companion
- private workspace/file access
- local shell/process integration
- optional browser bridge
- optional IDE bridge
- offline queueing
- reconnect and state reconciliation

## Acceptance

- cloud tasks do not require the companion
- local-only tasks queue while device is offline
- companion cannot exceed granted scope
- local observations are provenance-labelled
- browser/IDE extensions are adapters, not SOS authorities
- reconnect does not duplicate or lose task events
