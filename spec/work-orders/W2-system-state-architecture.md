# W2 — System State + Architecture Graph + Executable Invariants

Dependencies: W0.5
Owned paths: packages/system-state, packages/architecture, packages/conformance
Parallel slot: B

Goal:
Implement typed System State, Architecture Graph, boundary contracts, subgraph replacement and executable architecture invariants.

Acceptance:
- typed/versioned nodes and edges
- exact implementation/deployment/configuration revisions referenced
- graph diffs deterministic
- local candidate subgraph replacement representable
- invariants machine-checkable
- conformance results linked to semantic IDs
