# @sos-2/search

SOS 2.0 Candidate Search (Work Order W7; requirements R11, R12, R28, R29;
spec/architecture.md §9, §10). Engines are replaceable reasoning mechanisms
behind a stable contract — never authorities (the reference stack: "search/
optimization engines implement candidate-search contracts").

## The contract: `CandidateSearchEngine`

```typescript
interface CandidateSearchEngine {
  readonly name: string;
  search(request: SearchRequest): SearchResult;
}
```

Two implementations ship:

- **`createLadderSearchEngine({ facade, patternSource?, novelSource?, synthesisSource? })`**
  — the default. Registry rungs (validated composition / validated package /
  package adaptation) come from the injected `RetrievalFacade` over
  `@sos-2/registry`; the lower rungs (architecture pattern / novel
  architecture / low-level synthesis) come from pluggable candidate
  generators.
- **`createFixedAltitudeEngine({ altitude, source })`** — a single-rung
  alternative (e.g. a pattern-first engine), demonstrating the swap.

## The reasoning-altitude ladder (§10, machine-enforced)

Candidate generation **starts at `VALIDATED_COMPOSITION`** (the highest safe
validated abstraction) and **descends one rung at a time** — validated
package → package adaptation → architecture pattern → novel architecture →
low-level synthesis — **only when the higher rung cannot satisfy mission +
constraints**. The result records the altitude used (`final_altitude`) and
the full descent trace; `assertValidLadderTrace` rejects unjustified
descents, skipped rungs, ascents and traces continuing past a satisfied
rung. The ladder vocabulary and its order are imported from
`@sos-2/registry` (through `@sos-2/retrieval`) — never redefined.

## Hard constraints filter BEFORE evaluation

The typed constraint set is consumed from mission/value-shaped views
(duck-typed `HardConstraintView` — real `@sos-2/mission`
`MissionConstraint` objects satisfy it directly; proven in the integration
test; no sibling packages modified):

- only **HARD** constraints machine-filter (soft constraints are
  preferences — never vetoes);
- only **bounded** constraints (axis + direction + limit) are
  machine-checkable; unbounded ones are carried as prose;
- a candidate's **estimated measures** (predictions, not evaluation
  results) are checked per axis; a missing estimate is **UNCHECKED** —
  distinct from satisfied and violated, never conflated;
- survivors have no VIOLATED check; every rejection carries its violated
  checks.

## Exploration/exploitation is EXPLICIT

The typed policy is **required** — there is no implicit default:

- `GREEDY` — pure exploitation (calibrated probability, then uncertainty
  class, then sample size, then id);
- `EPSILON_GREEDY { epsilon, seed }` — seeded deterministic RNG (mulberry32);
  exploration draws are reproducible;
- `UCB { exploration_constant }` — optimistic bandit: calibrated arms score
  `p + c·√(ln N / n)`; unquantified arms head the order (highest
  information value — no numbers are invented for them).

The policy **orders and annotates** (`EXPLOIT`/`EXPLORE` with reasons) — it
never drops candidates; the diverse set is preserved (family
representatives always survive `maxCandidates` caps).

## Uncertainty preserved end-to-end

Every candidate carries its applicability estimate's uncertainty — the
qualitative class, sample size, context-match basis, and the calibrated
probability with its §12 companions (sample size, window, calibration ref)
— through the result. An uncertainty-stripped candidate is rejected loudly.

## Export discipline

The §10 ladder comes from `@sos-2/registry` via `@sos-2/retrieval` (the
registry stays the data authority); the uncertainty-class vocabulary comes
from `@sos-2/evidence; applicability/context types from
`@sos-2/packages`; spine ids and canonical serialization from
`@sos-2/semantic-spine`. Nothing here duplicates an authority.
