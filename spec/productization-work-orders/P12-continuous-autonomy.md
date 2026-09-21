# P12 — Continuous Autonomy, Body Lifecycle + Recovery

Dependencies: P6, P7, P8, P9, P11  
Owned paths: packages/autonomy-runtime, packages/task-runtime, apps/task-runner, tests/autonomy  
Worker: assigned in wave 5

## Goal

Make SOS a persistent Spirit that can continue long-running work while bodies are disposable.

## Scope

- durable task/work-graph state
- checkpoints and resumable execution
- body lease lifecycle
- body loss/provider outage recovery
- retry/backoff and re-planning
- worker heartbeat and cancellation
- task cost/resource accounting
- body replacement without losing semantic identity
- user-visible task timeline

## Acceptance

- killing a body does not lose the task
- task resumes from a verified checkpoint
- expired/revoked authority stops execution
- provider outage becomes truthful uncertainty/unavailability
- body replacement preserves task/artifact identity
- user can leave the website while eligible cloud work continues
- task cannot silently mutate canonical state outside its authority
