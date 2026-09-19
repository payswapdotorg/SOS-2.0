# SOS 2.0 Architecture Specification

VERSION: 2.0.0
STATUS: FROZEN FOR IMPLEMENTATION

1. Mission
SOS makes software continuously better over time while making software systems easier for humans to understand and reason about.

2. System thesis
SOS is a mission-governed evolutionary control plane for software systems.
It combines goal-oriented requirements, live system modeling, provenance, causal reasoning, bounded architecture evolution, reusable package composition, multi-objective and quality-diversity search, assurance, experimentation, authority-aware autonomy, architecture/code reconciliation and meta-adaptation.

LLMs, planners, search algorithms and optimizers are replaceable reasoning mechanisms. They are never authorities.

3. Authority
Constitution > Mission > approved Value commitments > hard constraints > assurance policy > architecture hypothesis > candidate > implementation detail.

Mission revision is explicit, versioned and authority-controlled.

4. Semantic Spine
All consequential artifacts have stable identity, kind, version, lifecycle status, provenance and authority reference.
Typed trace links include SATISFIES, REALIZES, REFINES, CONSTRAINS, IMPLEMENTS, VERIFIES, OBSERVES, SUPPORTS, CONTRADICTS, CAUSED_BY, CAUSED, DERIVED_FROM, COMPATIBLE_WITH, CONFLICTS_WITH, COMPOSES, SPECIALIZES and GENERALIZES.

5. Models
Constitution: authority, autonomy limits, assurance rules.
Mission: purpose, goals, outcomes, stakeholders, measures, assumptions, ambiguities, constraints and revision history.
Value Model: economic objectives, budgets, incentives, opportunities and typed constraints.
Context: user/cohort, platform, device, environment, workload, geography, time and regulatory context.
System State: architecture, implementation, configuration, deployment, policy, environment relationships, active experiments and package realizations.
Architecture Graph: typed nodes and edges representing capabilities, components, interfaces, data stores, deployment, trust, policies, models, adapters and dependencies.
Implementation Model: source artifacts, interfaces, dependency graph, tests, builds, deployments and runtime mappings.
Evidence Graph: observations, tests, runtime telemetry, experiments, deployments, outcomes, incidents and rollback with exact provenance.
Causal Knowledge: hypotheses about interventions, mechanisms and outcomes.
Candidate State: bounded subgraph replacement with explicit invariants and predicted effects.
Assurance Case: claims, assumptions, hazards, controls, evidence, validity conditions, objections and verdict.
Experiment: treatment/control or alternatives, population, allocation, metrics, guardrails, stopping and rollback criteria.
Decision: ACT, EXPERIMENT, GATHER_EVIDENCE, ASK, REJECT or ROLLBACK.
Package: validated reusable capability/subgraph plus contracts, applicability, evidence, failures, assurance obligations and learned limitations.
Package Composition: first-class reusable composition with independent evidence.
Architecture Memory: predictions, observations, outcomes, failures, liabilities, rollback and learned rules.
Evaluation: benchmark/scenario/protocol/results for both product systems and SOS itself.

6. Architecture and implementation
Architecture is a versioned projection/hypothesis over System State, not a copy of source code.
Implementation is a realization of architecture.
Architecture-relevant changes produce Architecture Deltas.
Code-to-architecture recovery may produce multiple competing hypotheses.
Differences are classified as IMPLEMENTATION_DETAIL, EXPECTED_VARIATION, PRESERVING_REFINEMENT, INTENTIONAL_EVOLUTION, DRIFT, UNKNOWN or CONTRADICTION.

7. Architecture as executable constraint
Where practical, architecture invariants are machine checked by static dependency checks, interface/contract checks, property tests, runtime conformance monitors and deployment policy.

8. Evolution operators
Candidates may add/remove/split/merge/replace components, change interfaces, data stores, deployment topology, policies, models, queues, orchestration, or package composition.

9. Search
Candidate selection supports hard constraints, Pareto sets, uncertainty-aware evaluation, contextual priors, quality-diversity repertoires and deliberate exploration/exploitation.
Never use a single global architecture score as the sole authority.

10. Package retrieval
Search starts at the highest safe validated reasoning altitude:
validated composition -> validated package -> package adaptation -> architecture pattern -> novel architecture -> low-level synthesis.

11. Diversity
Maintain high-performing alternatives across meaningful behavioral dimensions such as cost, latency, resilience, privacy, resource footprint, topology, operational complexity, customization and human comprehensibility.

12. Probabilistic semantics
Package/candidate performance is context-conditioned.
Preserve sample size, uncertainty and calibration.
Do not infer composition success by multiplying member probabilities unless independence is justified.

13. Assurance
Candidate generation is untrusted relative to a trusted assurance boundary. Assurance can combine static analysis, tests, property checks, replay, simulation, fault injection, runtime verification, shadow, canary and controlled experiments.
Live changes require bounded recovery unless a governed exception defines another containment mechanism.

14. Experimentation
Promotion is evidence gated. A passing test suite is not equivalent to a successful mission outcome.

15. Greenfield and brownfield
Greenfield starts from mission. Brownfield starts from mission plus existing-system evidence and recovers competing architecture hypotheses. Both converge on System State.

16. Self-evolution
SOS applies the same loop to itself. Meta-adaptation cannot disable the mechanism that judges meta-adaptation.

17. Platform neutrality
Platforms and vendors are adapters or contexts. They do not redefine SOS semantics.

18. Fundamental invariants
Constitution outranks optimization.
Mission outranks architecture.
Hard constraints outrank preferences.
Evidence outranks assertion about system reality.
Intervention evidence outranks observational correlation for strong causal claims.
Unknown, failed, unavailable and unsupported remain distinct.
LLM output is never authoritative evidence or authorization.
Packages require evidence.
Compositions require their own evidence.
Diversity is intentional.
Every promoted change is reproducible from exact revisions and evidence.
