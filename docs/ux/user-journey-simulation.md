# SOS 2.0 User Journey Simulation and UX Findings

Research inputs:
- apps/console W11 implementation and tests
- W18 dogfood and final-gate evidence
- pectoraux/ShareNet UI architecture

## Existing console

apps/console is a real runnable human console with 12 journeys, navigation, deterministic rendering, mission creation, system import, rationale pages and HTTP smoke coverage.

It is intentionally zero-network and fixture-backed. That makes it an excellent reference harness, but not the production product.

## Journey 1: first-time mission owner

Overview -> Mission.

What works:
Mission, revision history, provenance, goals, measures, constraints and ambiguities are visible. Creation uses domain validation.

Finding:
A large engineering form is less natural than progressive formalization.

Change:
Mission wizard: purpose -> outcomes -> stakeholders -> measures -> hard constraints -> ambiguities -> review -> authority confirmation.

## Journey 2: existing-system owner

Overview -> System import.

What works:
ImplementationModel validation, System State projection and reconciliation all appear together.

Finding:
JSON paste is an engineering test surface, not onboarding.

Change:
Repository/runtime import wizard with JSON as advanced mode.

## Journey 3: understand current reality

Overview -> Reconciliation -> Evidence.

What works:
Declared versus observed, frozen conformance classes, classifier reasons and drift evidence are explicit.

Finding:
Dense tables are cognitively expensive.

Change:
System health hero, architecture/reality diff, then drill-down tables/drawers. Provide investigate, gather-evidence and create-candidate next actions.

## Journey 4: evidence

Overview -> Evidence.

What works:
Six truth states stay distinct; provenance and LLM non-authority are visible; filtering exists.

Finding:
Causal/intervention meaning and freshness are not yet the dominant mental model.

Change:
Filters and tabs for subject, context, time, observation/intervention, freshness, provenance, support and contradiction.

## Journey 5: candidates

Overview -> Candidates.

What works:
Side-by-side candidate comparison, uncertainty, evidence context and diversity without a single winner.

Finding:
The relationship to the current mission shortfall is implicit.

Change:
Shortfall -> target capability -> candidate set -> predicted effects -> constraints -> evidence -> assurance readiness -> next decision.

## Journey 6: assurance

Candidates -> Assurance.

What works:
Claims, objections, validity and derived verdict are preserved.

Finding:
Objections lack an obvious next-action workflow.

Change:
Resolve, request evidence, run verification, reject, or ASK.

## Journey 7: experiment

Assurance -> Experiments.

What works:
Lifecycle, guardrails, stopping triggers, rollback triggers and honest simulation marking.

Finding:
The demo is read-only.

Change:
Design -> approve -> shadow -> canary -> monitor -> stop/rollback/promote.

## Journey 8: ASK

Candidate/Assurance -> ASK.

What works:
Exact decision, alternatives, evidence quality, uncertainty, trade-offs, risk, authority insufficiency and rule trace are visible.

Finding:
This is one of the strongest existing surfaces.

Change:
Turn ASK into an actionable inbox with authorized human resolution and provenance.

## Journey 9: rollback

Experiment -> Rollback.

What works:
Mechanism, trigger, authority, evidence and promotion linkage are explicit.

Finding:
Read-only in demo.

Change:
Make execution available only when an AuthorityGrant covers rollback. Show exact target revision and expected blast radius.

## Journey 10: packages

Overview -> Packages.

What works:
Families, diversity dimensions, contextual applicability, uncertainty, evidence, limitations, failures and assurance obligations.

Finding:
Inspection stops short of composition.

Change:
Composition workspace with compatibility/conflict, context-conditioned estimate, assurance preview, save and experiment.

## Journey 11: history

Overview -> History.

What works:
Identity-preserving supersedes chains.

Finding:
Good audit surface but not yet reasoning-oriented.

Change:
Timeline of mission, architecture, system-state, evidence, experiment, outcome and learned package; allow revision diff.

## Journey 12: self-evolution

Overview -> Self-evolution.

What works:
Read-only machine-state projection.

Important issue:
The demo fixture contains an intentionally frozen W11/W12 machine-state snapshot while the real program is now W18 COMPLETE. This is correct for deterministic testing but would be misleading if presented as live production state.

Change:
Production self-evolution must read canonical current state. Keep the fixture clearly marked DEMO.

## Global conclusions

1. Keep apps/console as deterministic reference harness.
2. Build a production web console with task-oriented navigation.
3. Landing page must answer current mission, current system condition, current shortfall/opportunity, current SOS activity and next action.
4. Use progressive disclosure: outcome -> rationale -> evidence -> raw artifact.
5. Every consequential action exposes what, why, evidence, uncertainty, authority and next action.
6. Use ShareNet-inspired sparse warm-light shell, strong state hero, restrained cards, timeline/topology views, desktop left rail, mobile bottom navigation and detail drawers.
7. Do not copy ShareNet domain language or brand identity.
