# Code -> Architecture Reconciliation

Input sources:
- repository source/dependency graph
- interfaces/contracts
- configuration
- deployment graph
- runtime traces
- infrastructure state
- tests
- human assertions

Pipeline:
Observed implementation -> normalized ImplementationModel -> competing architecture hypotheses -> compare with declared ArchitectureGraph -> classify differences.

Difference classes:
IMPLEMENTATION_DETAIL
EXPECTED_VARIATION
PRESERVING_REFINEMENT
INTENTIONAL_EVOLUTION
DRIFT
UNKNOWN
CONTRADICTION

Brownfield recovery must preserve multiple hypotheses when evidence is ambiguous.

Drift itself becomes Evidence and may trigger remediation, evidence gathering, ASK or incident handling.

The console should explain:
what we declared, what we observed, what differs, and why the difference is believed to be detail, variation, drift, unknown or intentional evolution.
