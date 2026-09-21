# SOS 2.0 Productization + Autonomous Execution Roadmap

STATUS: POST-W18 IMPLEMENTATION PROGRAM

W0-W18 is complete and frozen. P0 below closes the productization/execution contract; all subsequent work is implementation.

## Dependency graph

```text
                                   P0 ✓
                                    |
                    +---------------+---------------+
                    |               |               |
                   P1              P2              P3
                 Web shell     Live/API/Obs      Deployment
                    |               |               |
                    +-------+-------+-------+-------+
                            |               |
                           P4              P5              P10
                       Onboarding      Execution Fabric   Product workspaces
                            |               |               |
                            |               +-------+-------+
                            |                       |
                            +----------+------------+ 
                                       |
                                      P6
                              Spirit Orchestrator
                               /        |        \
                              /         |         \
                             P7        P8          |
                         Observation  Bodies        |
                              \        /            |
                               \      /             |
                                +----+--------------+
                                     |
                                    P9              P11
                              Actions/Evaluation   Local Companion
                                     |              /
                                     +------+-------+
                                            |
                                  +---------+---------+ 
                                  |         |         |
                                 P12       P13       P14
                              Continuous   Mission    Hardening
                              autonomy     -> repo    + safety
                                  \         |         /
                                   \        |        /
                                    +-------+-------+
                                            |
                                           P15
                                      Full dogfood
                                            |
                                           P16
                                      Release gate
```

## Wave dispatch

### Wave 1
Worker A -> P1
Worker B -> P2
Worker C -> P3

### Wave 2
Worker A -> P4
Worker B -> P5
Worker C -> P10

### Wave 3
Worker A -> P7
Worker B -> P8
Worker C -> P6

### Wave 4
Worker A -> P9
Worker B -> P11
Worker C -> cross-stream architect review/tests only; no unscoped implementation

### Wave 5
Worker A -> P12
Worker B -> P13
Worker C -> P14

### Wave 6
All 3 workers -> P15 in separate owned test/evidence lanes

### Final
Architect -> P16

## Work Order rules

- One Work Order = one branch/PR.
- Owned paths must be disjoint inside a wave.
- Unmerged siblings are never dependencies.
- Frozen W0-W18 contracts are read-only.
- Workers stop at WAITING_FOR_ARCHITECT on semantic/frozen-contract questions.
- Every body/harness/provider integration is an adapter.
- User-device availability is never a hidden dependency for cloud work.
- A body is leased to a durable task and may be replaced.
- Continuous observation does not require an active body.
- Independent evaluation gates completion.
- P13 is not complete because a coding agent says "done"; it is complete only when the evidence gate passes.

## Program loop

```text
Mission
  -> Current System State
  -> Observation / Evidence
  -> Shortfall / Opportunity
  -> Candidate Architecture
  -> Assurance
  -> Durable Task Graph
  -> Worker
  -> Body Lease
  -> Execution
  -> Independent Evaluation
  -> Decision / ASK
  -> Promotion / Rollback
  -> Evidence
  -> Learning
  -> Package / Repertoire update
  -> Meta-Evolution
```
