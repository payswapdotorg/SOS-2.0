# W3 — Evidence + Telemetry + Provenance

Dependencies: W0.5
Owned paths: packages/evidence, packages/telemetry, packages/provenance
Parallel slot: C

Goal:
Create the Evidence Graph and telemetry ingestion contracts.

Acceptance:
- SUCCESS, FAILURE, UNKNOWN, UNAVAILABLE, UNSUPPORTED and PARTIAL preserved
- exact source/deployment revision and time/context
- observation/intervention distinction
- OpenTelemetry-compatible adapter behind interface
- stale evidence detectable
- evidence traceable to System State
