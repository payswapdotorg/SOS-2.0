# @sos-2/value

The SOS 2.0 **Value Model** (Work Order W1): economic objectives, budgets,
incentives, opportunities and typed constraints — as versioned artifacts
**deterministically subordinate to Mission**.

## Spec alignment

| Aspect | Authority |
| --- | --- |
| Value Model fields (objectives, budgets, incentives, opportunities, typed constraints) | `spec/architecture.md` §5 "Value Model" |
| "Constitution > Mission > approved Value commitments > hard constraints > …" | `spec/architecture.md` §3 Authority (frozen; realized 1:1 in `precedence.ts`) |
| "Hard constraints outrank preferences" | `spec/architecture.md` §18 |
| Separate Value Model | `spec/requirements.md` R4 |
| Value precedence frozen | `spec/architecture-lock.md` |

## Model

`ValueModelContent` (exact field set): `objectives`
(MAXIMIZE/MINIMIZE/MAINTAIN a metric), `budgets` (resource + limit + unit —
an implicit MAX bound on the resource axis), `incentives` (aligned with
objectives), `opportunities` (optional expected value), `constraints`
(**typed** — see below) and `approved` (only approved value commitments enter
the §3 precedence tier).

**Typed constraints**: a `ValueConstraint` names a type from an explicit
constraint-type registry (built-ins: `BUDGET_LIMIT`, `SERVICE_LEVEL`,
`RISK_TOLERANCE` — bounded; `PREFERENCE` — unbounded/soft). Extensions go
through `registerValueConstraintType` / isolated registries. Unknown types
are rejected at construction. (This registry is a W1 domain extension point,
not a second Semantic Spine registry — spine identities/kinds/trace types
remain solely in `@sos-2/contracts`/`@sos-2/semantic-spine`.)

## Mission subordination (deterministic, machine-checked)

Rule (total and documented, in `subordination.ts`): a typed value constraint
or budget **conflicts** with a **hard** mission constraint iff both carry
bounds, axes are equal, directions are equal, and the value bound exceeds
what the mission permits (MAX: `value > mission`; MIN: `value < mission`).
Cross-direction bounds on one axis (ceiling + floor) coexist. Soft mission
constraints never machine-veto value. Budgets are implicit MAX bounds on
their resource axis.

Construction policies against a mission surface:

- **REJECT** (default): any conflict throws `ValueModelError` — rejected at
  construction.
- **FLAG**: construction proceeds; conflicts are carried by a
  **CONFLICTS_WITH** trace link (value model artifact → mission artifact,
  one of the 17 frozen types) with per-conflict provenance.

In both policies the mission constraint stands (`MISSION_PREVAILS`); value
can never outrank mission — asserted in unit, negative and property tests,
including against **real `@sos-2/mission` artifacts** (test-only
devDependency; runtime dependency surface is `@sos-2/semantic-spine` only).

## Artifacts and identity

`ValueModelArtifact = { envelope, content }`; envelopes from the spine,
content-addressed deterministic ids over the exact creation address (same
discipline as `@sos-2/mission`). `reviseValueModel` re-checks subordination
at revision time (missions evolve).

## Verification

- `pnpm run build` — TypeScript strict-mode compile (`dist/`)
- `pnpm test` — unit, negative, property (fast-check, seed 424242:
  determinism/totality of the subordination check, compatible limits never
  conflict, exceeding limits always conflict, canonical round trips) and
  real-mission integration tests
