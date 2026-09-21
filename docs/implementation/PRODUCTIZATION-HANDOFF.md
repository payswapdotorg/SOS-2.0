# SOS 2.0 Final Productization + Autonomous Execution Handoff

W0-W18 is COMPLETE and frozen. Do not reopen the core for ordinary product work.

## Source of truth

Use these in order:

1. AGENTS.md
2. ARCHITECT_START_HERE.md
3. frozen core specs/evidence
4. spec/productization-requirements.md
5. spec/productization-execution-architecture.md
6. spec/productization-roadmap.md
7. spec/productization-state/implementation-state.json
8. spec/productization-work-orders/*
9. deployment/UX docs

## Product identity

SOS is the persistent Spirit/control plane.

Reasoning providers are replaceable brains/mechanisms.

Harnesses and body runtimes are replaceable execution bodies.

Observation/event adapters let SOS continuously understand systems without a permanent body.

The user computer is optional for cloud/remote execution.

## Target user journey

```text
User mission
  -> connect GitHub
  -> greenfield or brownfield onboarding
  -> formalize mission
  -> recover/plan architecture
  -> candidates + assurance
  -> durable worker task graph
  -> summon capability-matching body
  -> execute in bounded environment
  -> independent evaluation
  -> repair/retry/ASK
  -> commit/PR/push
  -> deploy
  -> observe runtime
  -> verify mission outcome
  -> package learning
```

## Current product surfaces

- apps/console = deterministic reference harness only
- apps/web = production target
- live API/store = canonical product state boundary
- Observation Plane = webhooks/telemetry/CI/scheduled probes
- Execution Fabric = Harness Contract + Body Broker + sandbox/runtime adapters
- Spirit Orchestrator = durable task graph + up to three concurrent worker lanes
- GitHub adapter = project/workspace bridge
- cloud bodies = primary autonomous execution path
- local companion/IDE/browser = optional private/local body path
- independent evaluator = completion gate

## First dispatch

After P0 is accepted/completed:

Wave 1: P1 / P2 / P3
Wave 2: P4 / P5 / P10
Wave 3: P7 / P8 / P6
Wave 4: P9 / P11 + architect review/tests
Wave 5: P12 / P13 / P14
Wave 6: P15
Final: P16

## External platforms

Do not hard-code SOS to Codex, Claude, VS Code, a browser, Vercel or another vendor.

Use capability-based adapters.

Preferred integration order:
1. native API/SDK/app-server
2. MCP/equivalent protocol
3. local companion
4. browser/IDE extension
5. UI automation last

## LLM connection

A user does not need to connect their own LLM just to start.

The deployed product should provide a managed reasoning-provider route, with optional BYO provider connections. Every provider result carries model/version provenance and remains non-authoritative.

## Body availability

Cloud/remote bodies can operate while the user's computer is off.

Local-only tasks queue until the local body reconnects.

## Continuous monitoring

No permanent body is required for ongoing governance.

GitHub events, CI, deployment events, runtime telemetry, provider health and scheduled probes feed Evidence/System State. Bodies are summoned only for active work.

## Release standard

A task is not complete because a body returns success.

Completion requires appropriate independent evidence, exact source/deployment revisions, authority checks, retained uncertainty and reproducibility.

P16 requires the exact tested head and production deployment revision, plus the complete productization evidence bundle.
