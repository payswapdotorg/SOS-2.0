# P6 — Spirit Orchestrator + Worker/Task Runtime

Dependencies: P2, P5  
Owned paths: packages/orchestrator, packages/task-graph, packages/worker-runtime, packages/reasoning-broker, apps/api/orchestrator, tests/orchestration  
Worker: C in wave 3

## Goal

Turn SOS from a semantic pipeline into a persistent control loop that can coordinate workers and interchangeable bodies.

## Scope

- mission-aware task decomposition
- architect role as a governed SOS control function
- up to three concurrent worker lanes
- durable task graph
- worker assignment and handoff
- reasoning-provider broker
- default managed reasoning path
- optional BYO LLM provider adapters
- model/version provenance
- pause/resume/cancel
- ASK escalation
- worker result ingestion
- no self-approval of worker output

## Acceptance

- workers can be dispatched concurrently on disjoint owned paths
- every task has mission and authority references
- LLM/provider output is non-authoritative
- user does not need to connect a personal LLM to start
- worker crashes do not corrupt the task graph
- orchestrator never silently bypasses assurance or authority
