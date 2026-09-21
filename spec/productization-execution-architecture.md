# SOS 2.0 Execution Fabric & Spirit/Body Architecture

STATUS: POST-W18 PRODUCTIZATION ARCHITECTURE ADDENDUM

This document extends the productization architecture without reopening the frozen W0-W18 semantic contracts.

## 1. Core model

SOS is the persistent **Spirit**:

- mission and constitution-aware control
- persistent System State and semantic memory
- planning, search, assurance, authority and decision
- observation and evidence interpretation
- task decomposition and worker coordination
- learning and package evolution

A **reasoning provider** is a replaceable brain/mechanism:

- managed SOS reasoning is the default product path;
- bring-your-own provider is optional;
- provider/model outputs remain non-authoritative;
- model identity/version is retained as provenance.

A **harness/body** is a replaceable execution mechanism:

- terminal and filesystem access
- repository operations
- browser/UI interaction
- runtime/cloud APIs
- IDE or desktop interaction
- deployment operations

The body is normally ephemeral. A task owns a body lease; the task, evidence and state survive body replacement.

## 2. Control topology

```text
                         SOS SPIRIT
                             |
            +----------------+----------------+
            |                |                |
        System State      Observation      Orchestrator
            |                |                |
            +----------------+----------------+
                             |
                       Body Broker
                             |
          +------------------+------------------+
          |                  |                  |
      Cloud body         Remote body        Local body
      sandbox/harness    private runner     companion/harness
          |                  |                  |
          +------------------+------------------+
                             |
                         Real world
                             |
                 evidence / outcomes / events
                             |
                             +------> SOS
```

## 3. Body selection

SOS chooses a body from declared capabilities, not vendor identity.

A body advertises:

- capabilities
- isolation level
- network policy
- filesystem scope
- browser capability
- shell capability
- git capability
- runtime/cloud integrations
- supported task lifecycle
- evidence/artifact capture
- cost and resource envelope

The broker may suspend, replace or release a body without losing the task.

## 4. Harness integration order

Use the highest available control surface:

1. native API / SDK / app server
2. MCP or equivalent tool protocol
3. local companion / service bridge
4. browser or IDE extension
5. UI automation as a last resort

SOS must never require an extension when an equivalent safe API is available.

## 5. Observation without a body

Continuous governance does not require a permanent coding agent.

The Observation Plane consumes:

- GitHub webhooks and repository events
- CI/build/test/security events
- deployment events
- runtime logs/metrics/traces
- incidents and provider health signals
- scheduled repository/runtime probes
- explicit user observations

Observation updates System State and Evidence through adapters. Redis/queues may coordinate delivery, but canonical semantics remain in durable stores.

A body is summoned only when active inspection, planning, implementation, remediation, deployment or another consequential operation is required.

## 6. Task durability

Every long-running task persists:

- task identity and mission link
- current plan/work graph
- owned workspace/repository revision
- authority context
- body lease, when any
- checkpoints
- produced artifacts
- observations/evidence
- unresolved uncertainty
- retries/recovery state
- cost/resource consumption
- final verification record

A body crash, provider outage, browser closure or user computer shutdown must not erase the task.

## 7. User device model

The user's machine is optional.

- Cloud/remote bodies continue while the user's computer is off.
- Local bodies run only while their host is reachable.
- Local tasks queue when the device is offline.
- A local companion may expose private files, desktop apps, IDEs and local tools.
- Browser/IDE extensions are optional adapters, not semantic authorities.

## 8. Reasoning-provider model

Users do not have to bring an LLM just to use SOS.

Product behavior:

- default: SOS-managed reasoning provider;
- optional: connect a user's own provider;
- provider routing is capability/cost/context driven;
- changing the model must not change semantic authority;
- all model-produced analysis is explicitly non-authoritative until independently evidenced.

## 9. Execution contract

The Harness Contract must expose, where supported:

```text
identity()
capabilities()
createTask()
resumeTask()
pauseTask()
cancelTask()

workspace.read()
workspace.write()
shell.exec()
browser.open()
browser.interact()

git.status()
git.diff()
git.commit()
git.push()
git.createBranch()
git.createPullRequest()

artifacts.capture()
observations.emit()
events.subscribe()
```

Not every body must support every operation. Unsupported capabilities remain explicit.

## 10. Completion discipline

A worker/body may report completion, but it may not certify mission success by itself.

Completion requires evidence appropriate to the mission, which may include:

- tests
- static/contract checks
- browser journeys
- deployment evidence
- runtime observations
- security checks
- mission metrics
- exact source/deployment revisions
- rollback/recovery readiness
- retained uncertainty and limitations

## 11. Greenfield flagship journey

The first flagship autonomous journey is:

```text
user mission
  -> connect GitHub repo
  -> SOS formalizes mission
  -> architecture/capability plan
  -> candidate + assurance
  -> worker task graph
  -> summon cloud body
  -> implementation
  -> independent evaluation
  -> repair/retry or ASK
  -> commit/PR/push
  -> deployment
  -> runtime verification
  -> evidence-backed completion report
```

The journey must continue without the user's computer remaining online when all required resources are remote.

## 12. Brownfield journey

```text
connect existing repository/runtime
  -> observe
  -> recover competing architecture hypotheses
  -> identify shortfalls
  -> retrieve proven packages
  -> candidate
  -> assure
  -> experiment
  -> summon body when action is required
  -> verify
  -> promote / rollback / ASK
```

## 13. Non-negotiable boundaries

- The frozen W0-W18 core remains authoritative.
- Harnesses cannot redefine SOS semantics.
- Bodies cannot grant themselves authority.
- LLM output is never authoritative evidence or authorization.
- The broker cannot silently escalate authority.
- Redis/queues cannot become semantic authorities.
- Provider outages remain UNKNOWN/UNAVAILABLE where appropriate.
- User device availability cannot be a hidden prerequisite for cloud work.
- Demo fixtures are never production state.
