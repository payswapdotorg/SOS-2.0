# SOS 2.0 Research Basis

Research refresh: 2026-09-19

Requirements traceability:
2025 systematic review found lifecycle-wide traceability methods remain incomplete and industrial evaluation comparatively sparse.
https://doi.org/10.1145/3672608.3707952
2024 empirical study examined state-of-the-art requirement-to-code traceability recovery.
https://doi.org/10.1016/j.jksuci.2024.102118
Implication: stable IDs, typed trace links and continuous recovery are preferable to manual trace documents.

Continuous assurance:
Dynamic assurance research shows assurance justifications should be evaluated as system context and performance change.
https://ntrs.nasa.gov/citations/20230018233
https://www.sciencedirect.com/science/article/pii/S0925753525001900
https://arxiv.org/abs/2511.14805
Implication: assurance cases need validity conditions and runtime evidence.

Architecture/LLM integration:
A 2025 systematic literature review reports growing LLM use in software architecture but notes architecture-to-code and conformance remain underexplored.
https://arxiv.org/abs/2505.16697
Emerging work combines LLM-assisted instrumentation with conformance checking for runtime anomaly detection.
https://arxiv.org/abs/2511.10876
Implication: use LLMs for proposal/mapping, not architectural truth.

Quality-Diversity:
Quality-Diversity searches for collections of high-performing but behaviorally different solutions.
https://quality-diversity.github.io/
2024 and 2025 Bayesian QD work targets expensive, constrained and conditional search spaces.
https://quality-diversity.github.io/papers
https://doi.org/10.1016/j.engappai.2024.108118
Implication: retain a repertoire, not one global architecture winner.

Goal-oriented/self-adaptive systems:
https://link.springer.com/article/10.1007/s00766-017-0280-z
https://research.monash.edu/en/publications/software-engineering-for-self-adaptive-systems-a-research-roadmap/
https://publications.aston.ac.uk/id/eprint/37117/
Implication: mission/goals and live system models should remain explicit.

Many-objective software optimization:
https://www.sciencedirect.com/science/article/pii/S0164121218302759
Implication: preserve conflicting objectives and Pareto alternatives.

Causal reasoning:
https://arxiv.org/abs/2011.04216
Implication: intervention evidence is distinct from correlation; causal claims retain assumptions and refutation evidence.

Open problems:
mission-to-architecture causality, scalable safe architecture search, continuous assurance of self-evolving software, calibrated autonomous authority, package transfer, and safe meta-evolution remain active research problems.
