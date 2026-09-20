# @sos-2/ask

SOS 2.0 Structured ASK (Work Order W10, parallel slot A). The
**routing/presentation layer** on top of @sos-2/authority's first-class
AskRequest contract (consumed, never redefined):
the **AskQueue** (ordered, deduplicated by input digest), **escalation
context assembly**, and **resolution handling** — an ASK resolved by a
human/authority decision produces a DecisionRecord through
@sos-2/decision's record machinery with the provenance of who resolved it
(spec/architecture.md §3, §5, §18; spec/requirements.md R16).

**ASK IS A SUCCESS STATE**: an AskRequest is a valid first-class outcome,
never an exception — enqueueing a valid ask never throws (pinned by unit
and property tests).

## What lives here

| Export | Purpose |
| --- | --- |
| `composeAskContent` | derives the AskContent from an ASK decision record: the EXACT decision string, the documented default TYPED alternative sets per escalation code, the derived qualitative evidence quality (NONE/WEAK/MODERATE/STRONG), the uncertainty statement, deterministic trade-offs, the typed risk, and the authority-insufficiency reason — all caller-overridable |
| `assembleEscalationContext` | what the decider needs to see: the decision request + typed alternatives + evidence summary with CURRENT freshness (re-evaluated through @sos-2/evidence at the presentation instant; missing records reported truthfully) + uncertainty + risk + the authority-insufficiency reason + the originating rule trace |
| `AskQueue` | ordered (severity first: SEVERE > HIGH > MODERATE > LOW, then FIFO, then id) and deduplicated by the ORIGIN decision's exact input digest — the same escalated input is queued exactly once (idempotent enqueue; only a changed input, i.e. a different digest, produces a new ask) |
| `AskQueue.resolve` | mints the resolution DecisionRecord via `@sos-2/decision`'s `mintResolutionDecision` (provenance of who resolved it; bound to the origin's exact input digest) and marks the entry RESOLVED — terminal, at most once |

## The golden workflow

```text
engine evaluate(request) ──ASK──> DecisionRecord (escalation block)
        │
        ├─ composeAskContent(record) ──> AskContent
        │        └─ @sos-2/authority createAskRequest ──> AskRequestArtifact
        │
        ├─ AskQueue.enqueue({ ask, origin_decision }) ──> entry (dedup by digest)
        │
        ├─ assembleEscalationContext({ ask, decision, evidence, now }) ──> context
        │
        └─ queue.resolve(entry.id, { resolved_by, chosen_alternative_id, note, ... })
                 └─ DecisionRecord via @sos-2/decision (provenance of who resolved it)
```

The AskRequest contract (exact decision, typed alternatives, evidence
quality, uncertainty, trade-offs, risk, authority insufficiency — and the
no-numeric-confidence policy) is @sos-2/authority's, consumed as-is. See
ARCHITECTURE-DELTA.json for the full delta record.
