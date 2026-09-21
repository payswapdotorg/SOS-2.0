# SOS 2.0 Productization Requirements

STATUS: POST-W18 PRODUCTIZATION BASELINE

The W0-W18 core program is complete and frozen. This layer productizes that proven core without changing its semantic architecture.

## Goals

P1 Turn the proven W11 console into a production web application.
P2 Preserve the Semantic Spine and domain packages as the only semantic authority.
P3 Make all major SOS capabilities discoverable through task-oriented navigation.
P4 Replace fixture-only presentation with durable live state and evidence adapters.
P5 Deploy with free-tier-compatible providers for validation and personal use.
P6 Make consequential actions visibly authority-gated and evidence-backed.
P7 Preserve apps/console as the deterministic reference harness.
P8 Use progressive disclosure: outcome first, rationale/evidence on demand.
P9 Explain the system to humans without requiring SOS-internal knowledge.
P10 Keep providers replaceable behind adapters.

## Product rules

- Production UI never treats the demo fixture as live state.
- Current Mission, System State, Evidence and development state come from authoritative stores.
- Demo fixtures are explicitly labelled DEMO or SIMULATED.
- No user-facing score hides uncertainty, evidence quality or context.
- Every consequential surface exposes what, why, evidence, uncertainty, authority and next allowed action.
- Authentication identity and SOS authority grants remain separate.
- ShareNet is a visual/interaction reference, not a semantic source.
