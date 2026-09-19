# SOS 2.0 Implementation Process

Authority order:
1 actual Git history and live main
2 canonical machine state
3 frozen architecture and lock
4 governing Work Order
5 implementation roadmap
6 detailed design
7 implementation/tests/evidence
8 PR prose and summaries

Lifecycle:
ELIGIBLE -> DISPATCHED -> ACTIVE -> CHECKPOINTED -> WAITING_FOR_ARCHITECT -> APPROVED -> MERGING -> MERGED -> RECONCILING -> COMPLETE

For each Work Order:
read authority -> inspect code -> establish behavioral/property test -> implement bounded change -> verify -> evidence -> Architecture Delta -> checkpoint -> review.

One Work Order per PR. Unmerged sibling work is never a dependency.

Every evidence record includes Work Order, base SHA, head SHA, dependency SHAs, commands, environment, timestamp and result.

Findings remain on the same PR.

Workers may declare review-ready, not complete. Completion requires Architect gate, actual merge and reconciliation.
