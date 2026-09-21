# P13 — Mission-to-Implementation Autonomous Pipeline

Dependencies: P4, P6, P7, P8, P9  
Owned paths: packages/implementation-orchestrator, packages/greenfield-runtime, packages/project-realization, tests/mission-to-repo  
Worker: assigned in wave 5

## Goal

Deliver the flagship product journey: a user provides a mission and an empty GitHub repository and SOS can drive a complete evidence-gated implementation using temporary bodies.

## Scope

- mission -> executable task graph
- capability/architecture plan -> implementation plan
- worker decomposition
- repository initialization and workspace provisioning
- body selection and task assignment
- iterative implementation/evaluation/repair loop
- Git branches/commits/PRs
- deployment integration
- completion/evidence report
- ASK when authority or evidence is insufficient

## Acceptance

A clean test account can:

1. create a mission in the web product;
2. connect an empty GitHub repository;
3. approve required authority;
4. let SOS run without the user's computer remaining online;
5. observe the task and evidence timeline;
6. receive a repository containing the implemented system;
7. see exact source revisions, evaluation results and remaining uncertainty;
8. reproduce the completion record.

The worker/body may not declare success without the independent completion gate.
