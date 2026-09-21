# SOS 2.0 User Journey Simulation and UX Findings

Research inputs:
- apps/console W11 implementation/tests
- W18 dogfood/final-gate evidence
- ShareNet UI architecture
- post-W18 Spirit/Body/Observation product model

## Existing console

apps/console is a real runnable human console with 12 journeys, navigation, deterministic rendering, mission creation, system import, rationale pages and HTTP smoke coverage.

It remains a deterministic reference harness, not the production product.

## Productization findings

The original 12-journey simulation remains valid. Additional journeys discovered after the Spirit/Body model are mandatory.

## Journey 13: mission -> empty GitHub repository -> implementation

Desired flow:
Mission -> GitHub connection -> architecture/candidate -> assurance -> worker task graph -> body -> implementation -> independent evaluation -> PR/push -> deployment -> completion evidence.

UX requirement:
The user should see progress and evidence, not raw agent transcripts. "Done" must mean evidence-gated completion.

## Journey 14: continuous monitoring without a body

Desired flow:
GitHub/CI/runtime/deployment events -> Observation -> Evidence -> System State -> opportunity/shortfall.

UX requirement:
Show "SOS is watching" separately from "a body is working." No permanent worker indicator should be implied.

## Journey 15: body interruption

Desired flow:
task running -> body lost/provider outage -> checkpoint -> re-plan/select another body -> resume.

UX requirement:
Task state persists. The body is presented as an interchangeable execution resource.

## Journey 16: user's computer is off

Desired flow:
cloud body continues -> user closes website/laptop -> task timeline continues -> user returns to completed/evidence-backed state.

UX requirement:
Never imply local-device availability is required for cloud execution.

## Journey 17: optional local body

Desired flow:
user grants local companion -> SOS receives capability set -> local-only task -> device disconnect -> queue -> reconnect -> reconcile -> resume.

UX requirement:
Clearly distinguish cloud execution from local-device access and show exact scope.

## Existing journey adaptations

Mission onboarding:
Progressive formalization, not an engineering form.

Brownfield:
Repository/runtime wizard first; raw JSON only advanced.

Reality:
Hero + architecture/reality diff + evidence drawers, not table-first.

Evidence:
Subject/context/time/intervention/provenance/freshness/support/contradiction are primary.

Candidates:
Shortfall -> target capability -> candidate set -> predicted effects -> constraints -> evidence -> assurance.

Assurance:
Objections expose resolve/request-evidence/verify/reject/ASK next actions.

Experiment:
Design -> approve -> shadow -> canary -> monitor -> stop/rollback/promote.

ASK:
Actionable inbox with human resolution and provenance.

Packages:
Composition workspace with independent composition evidence.

History:
Timeline + revision diff.

Self-evolution:
Canonical live state only; fixture clearly marked DEMO.

## Global product requirement

Every consequential screen answers:
What is happening?
Why does SOS believe this?
What evidence supports it?
What remains uncertain?
What authority is required?
What can happen next?
