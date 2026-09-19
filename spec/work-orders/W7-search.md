# W7 — Candidate Search + Bayesian/Quality-Diversity Retrieval

Dependencies: W4, W5, W6
Owned paths: packages/search, packages/optimization, packages/retrieval
Parallel slot: A

Goal:
Search from validated packages toward novel architecture while preserving uncertainty and diversity.

Acceptance:
- reusable package search precedes novel synthesis
- hard constraints filter candidates
- uncertainty preserved
- Pareto and QD repertoire supported
- exploration/exploitation explicit
- composition outcomes learned independently
- search engine swappable behind a stable interface
