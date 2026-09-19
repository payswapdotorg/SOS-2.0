# SOS 2.0 Implementation Roadmap

STATUS: FROZEN IMPLEMENTATION SEQUENCE 2.0

True dependency DAG:

W0
 -> W0.5
 -> {W1, W2, W3}

After the first parallel wave, the eligible pool expands to:
- W4 depends on W2,W3
- W5 depends on W1,W3
- W6 depends on W1,W2,W3
- W8 depends on W2,W3

Therefore the lead should dispatch any three eligible independent Work Orders rather than wait for a formal stage boundary.

Downstream:
W7 depends on W4,W5,W6
W9 depends on W2,W3,W6
W10 depends on W1,W8,W9
W11 depends on W1,W2,W8,W10
W12 depends on W2,W3,W8,W10
W13 depends on W5,W6,W7
W14 depends on W1,W2,W6,W10,W11,W12
W15 depends on W4,W5,W7,W8,W9,W10,W12,W13
W16 depends on W9,W10,W13,W15
W17 depends on W11,W12,W13,W14,W15,W16
W18 depends on W17

Three-worker strategy:
1. Keep up to three eligible Work Orders active.
2. Prefer disjoint owned paths.
3. Prefer prerequisite-building Work Orders that unlock additional independent work.
4. Do not wait for a sibling unless the dependency is explicit.
5. Use contract fixtures/stubs when a Work Order is intentionally independent of a future implementation.
6. Reconcile frontier after every merge.

First recommended dispatch:
Worker A -> W1
Worker B -> W2
Worker C -> W3

Then maintain a rolling pool from the true DAG. A worker finishing early may take W4/W5/W6/W8 without waiting for the other first-wave workers if its dependencies are merged.

W9 is intentionally independent of W7/W8 source code. It uses the frozen CandidateState, AssuranceCase and Evidence contracts plus contract fixtures; final cross-system integration is validated later.

Work Order completion:
acceptance criteria satisfied -> exact-head evidence -> Architect gate -> actual Git merge -> state reconciliation.

No Work Order becomes eligible because a branch exists or an agent claims readiness. Dependency eligibility requires authoritative merged Git evidence.
