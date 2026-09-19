# SOS 2.0 Current State

Informational projection.

Repository: payswapdotorg/SOS-2.0
Status: ACTIVE — first parallel wave eligible
Current frontier: W1, W2, W3 (disjoint owned paths, dispatch concurrently)

Merged:
- W0 bootstrap (initial governance/spec repository)
- W0.5 Semantic Spine + Architecture/Implementation Integrity
  (merge adf3156c904a7fbbb3214a2036396ec5a1d67212, PR #1 squash):
  @sos-2/contracts (normative types, frozen vocabularies: 17 trace types,
  6 truth states, 19 artifact kinds, 7 conformance classes, schema loader)
  and @sos-2/semantic-spine (identity minting, envelope lifecycle, trace
  store, canonical JSON + deterministic round trips, Architecture Delta
  builder/validator, conformance classifier, golden fixtures).
  spec/contracts extended additively with implementation-model.schema.json
  and deltas/W0.5.architecture-delta.json.

Next dispatch: Worker A -> W1, Worker B -> W2, Worker C -> W3
(base for each = merged W0.5 head; consume @sos-2/semantic-spine, never
invent core identifiers).

After the first wave: eligible pool = W4 (W2,W3), W5 (W1,W3), W6 (W1,W2,W3),
W8 (W2,W3); W9 is intentionally independent against frozen contracts.

Recompute eligibility from live Git history and machine state before dispatch.
