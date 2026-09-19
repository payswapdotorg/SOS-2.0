# W1 — Mission / Value / Context / Authority

Dependencies: W0.5
Owned paths: packages/mission, packages/value, packages/context, packages/authority
Parallel slot: A

Goal:
Implement versioned mission/value/context models, authority grants, autonomy policy and ASK contracts.

Acceptance:
- explicit mission revision workflow
- typed Value constraints subordinate to Mission
- extensible Context dimensions
- scoped authority grants with expiry and revocation
- ASK carries exact decision, alternatives, evidence, uncertainty and trade-offs
- invalid authority transitions fail
- all artifacts use Semantic Spine IDs
