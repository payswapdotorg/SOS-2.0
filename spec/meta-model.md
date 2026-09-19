# SOS 2.0 Meta-Model

STATUS: FROZEN

Artifact envelope:
id, kind, version, status, authority_ref, provenance, created_at, supersedes.

Core entities:
Constitution
Mission
ValueModel
Context
SystemState
ArchitectureGraph
ImplementationModel
Evidence
CausalHypothesis
CandidateState
AssuranceCase
Experiment
Decision
Package
PackageComposition
ArchitectureMemory
Evaluation
AuthorityGrant
AskRequest

Typed traces:
SATISFIES, REALIZES, REFINES, CONSTRAINS, IMPLEMENTS, VERIFIES, OBSERVES, SUPPORTS, CONTRADICTS, CAUSED_BY, CAUSED, DERIVED_FROM, COMPATIBLE_WITH, CONFLICTS_WITH, COMPOSES, SPECIALIZES, GENERALIZES

Evidence truth states:
SUCCESS, FAILURE, UNKNOWN, UNAVAILABLE, UNSUPPORTED, PARTIAL

Confidence:
Numeric confidence is valid only where calibration exists. Otherwise use a qualitative uncertainty class.
Never treat an LLM self-reported confidence value as calibrated truth.
