# SOS 2.0 Productization Requirements

STATUS: POST-W18 PRODUCTIZATION BASELINE

The W0-W18 core is complete and frozen. This layer productizes the proven core without changing its semantic architecture.

## Product goals

P1 Production web console.
P2 Live durable state.
P3 Free-tier validation deployment.
P4 Progressive greenfield/brownfield onboarding.
P5 GitHub/project integration.
P6 Continuous observation without a permanent body.
P7 Persistent Spirit orchestration with up to three concurrent workers.
P8 Replaceable reasoning-provider broker; managed default, BYO optional.
P9 Replaceable harness/body broker.
P10 Cloud-first execution that works when the user's computer is off.
P11 Optional local companion/browser/IDE bridges.
P12 Authority-gated real-world actions.
P13 Independent evaluation and evidence-backed completion.
P14 Durable long-running tasks, checkpoints and body replacement.
P15 Mission -> empty GitHub repo -> complete implementation flagship journey.
P16 Package/history/self-evolution production workspaces.
P17 Security, cost, isolation, observability and recovery.
P18 Human ASK remains first-class.

## Product rules

- Production UI never treats demo fixture as live state.
- Current Mission, System State, Evidence, development state and task state come from authoritative stores.
- Demo fixtures are explicitly DEMO/SIMULATED.
- No score hides uncertainty, evidence quality or context.
- Every consequential surface exposes what, why, evidence, uncertainty, authority and next allowed action.
- Authentication identity and SOS authority grants remain separate.
- Harness/provider identities are not semantic identities.
- Bodies cannot mint or widen authority.
- Redis/queues are never canonical.
- LLM output is never authoritative evidence or authorization.
- A worker/body cannot certify its own mission success.
- Cloud work continues when the user's device is offline.
- Local-only work queues safely while the device is offline.
- Provider outages remain truthful unknown/unavailable states.
- Every completed autonomous task records exact source/deployment revisions and evaluation evidence.
- Providers remain adapters.

## Architectural boundary

The execution fabric is a productization architecture layer over the frozen core. Do not reopen W0-W18 unless an explicit Architecture Change Request is approved.
