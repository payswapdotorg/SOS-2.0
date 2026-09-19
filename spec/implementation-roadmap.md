# SOS 2.0 Implementation Roadmap

STATUS: FROZEN IMPLEMENTATION SEQUENCE 2.0

DAG:
W0 Governance
 -> W0.5 Semantic Spine + architecture/code integrity
 -> parallel W1 Mission, W2 Architecture, W3 Evidence
 -> parallel W4 Recovery, W5 Causal/Memory, W6 Package Core
 -> parallel W7 Search, W8 Assurance, W9 Experiment
 -> W10 Autonomy/ASK
 -> parallel W11 Console, W12 Adapters, W13 Package Ecology
 -> W14 Greenfield
 -> W15 Brownfield
 -> W16 SOS Self-Evolution
 -> W17 Integrated Dogfood
 -> W18 Final Gate

Three-worker strategy:
After W0.5, workers A/B/C take W1/W2/W3.
Later, dispatch the three eligible independent Work Orders at each frontier. W7, W8 and W9 are intentionally parallel: W9 consumes the frozen Candidate/Assurance contract and may use stubs until W7/W8 implementations merge. Owned paths must be disjoint.
Integration work is explicit and never hidden in a feature PR.

Work Order completion:
acceptance criteria satisfied -> exact-head evidence -> Architect gate -> actual Git merge -> machine state reconciliation.

No Work Order becomes eligible because a branch exists or an agent claims readiness. Dependency eligibility requires authoritative merged Git evidence.
