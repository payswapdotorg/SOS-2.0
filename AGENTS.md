# SOS 2.0 Agent Operating Contract

STATUS: FROZEN

1. Source of truth
The repository is the sole durable authority. Conversation history, agent memory, PR prose, and unstored plans are non-authoritative.

2. Mandatory bootstrap
Read AGENTS.md, ARCHITECT_START_HERE.md, spec/architecture.md, spec/architecture-lock.md, spec/meta-model.md, spec/requirements.md, spec/implementation-roadmap.md, machine state, and the selected Work Order. Inspect live main, open PRs, recent merges, CI, and evidence.

3. One Work Order = one PR
Unmerged sibling work is never a dependency. A worker may not create successor work outside the Work Order.

4. Semantic Spine
Every consequential domain object uses a stable SOS identity and typed trace links. No second semantic registry is permitted.

5. Architecture/code rule
Architecture is a versioned semantic contract. Code is a realization. Architecture-relevant PRs declare an Architecture Delta or explicitly identify implementation-only change.

6. Test and evidence discipline
Use failing behavioral/property tests where practical. Verify the exact head. Persist evidence with exact revisions and provenance.

7. No silent autonomy
Workers may propose, implement and test within scope. They may not rewrite authority, raise autonomy, bypass assurance, promote production, self-approve, self-merge, or treat model output as evidence.

8. Package discipline
Packages are validated capabilities/subgraphs, not arbitrary snippets. Package composition has its own evidence. Negative evidence and liabilities are retained.

9. Diversity
Do not collapse the solution repertoire into a single global winner when materially different solution families are useful.

10. Exact-head rule
Review and evidence bind to the exact Git head SHA.

11. Completion
Architect gate passed -> exact reviewed head merged -> canonical state reconciled.

12. Recovery
live main -> roadmap -> machine state -> Work Order -> merged dependencies -> implementation -> verification/evidence -> review findings -> exact head -> reconciliation -> frontier.
