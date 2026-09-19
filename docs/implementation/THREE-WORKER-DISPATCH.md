# Three-Worker Dispatch Playbook

At most three workers are active concurrently.

First wave after W0.5:
Worker A -> W1
Worker B -> W2
Worker C -> W3

Later, dynamically dispatch any three eligible Work Orders with disjoint owned paths.

Concurrency requires:
- authoritative merged dependencies
- disjoint owned paths
- frozen shared contracts
- independent verification

Communication is through Work Orders, Semantic Spine IDs, Git branches/PRs and persisted evidence.

Avoid shared drive-by refactors, unrelated formatting, silent schema changes and undocumented cross-worker coupling.

After each merge:
reconcile state -> recompute frontier -> dispatch next independent work.
