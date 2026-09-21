# P8 — Harness Adapters + Cloud/Remote Bodies

Dependencies: P5  
Owned paths: packages/harness-adapters, packages/body-runtimes, packages/sandbox, apps/worker-runtimes, tests/harness-adapters  
Worker: B in wave 3

## Goal

Provide the first real execution bodies, prioritizing cloud/remote operation so SOS can work while the user's computer is off.

## Required reference bodies

- disposable cloud coding/shell body
- browser/evaluator body
- GitHub-aware project body

Optional adapters:

- private remote runner
- local companion
- IDE/browser integrations

## Acceptance

- at least one cloud body can be leased and released
- body can access an isolated workspace
- task continues when the user's computer is offline
- filesystem/network/secrets are bounded
- body emits observations and artifacts
- body provider can be replaced without changing task semantics
