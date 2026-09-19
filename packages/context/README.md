# @sos-2/context

The SOS 2.0 **Context model** (Work Order W1): typed, extensible context
dimensions with an explicit registry — unknown dimensions rejected, values
machine-checked against their dimension type.

## Spec alignment

| Aspect | Authority |
| --- | --- |
| Context dimensions (user/cohort, platform, device, environment, workload, geography, time, regulatory) | `spec/architecture.md` §5 "Context" |
| Extensible, explicit-API dimension registry | Work Order W1 acceptance |
| Contextual realization | `spec/requirements.md` R5, R17 |

## Dimensions

The **eight built-in dimensions** from §5 are seeded:
`user_cohort`, `platform`, `device` (text), `environment`
(enum: development/test/staging/production), `workload`, `geography`, `time`
(text), `regulatory` (string-list).

Every dimension is **typed** — values must satisfy the dimension's value
type from the frozen vocabulary `text | number | boolean | enum |
string-list` (text = non-empty string; number = finite; boolean = boolean;
enum = member of the dimension's unique non-empty enumValues; string-list =
non-empty list of unique non-empty strings).

Extensions go through the explicit API — `registerContextDimension` (default
process-wide registry) or `createDimensionRegistry()` for isolated
registries. Duplicate/invalid registrations throw. There is no unregister:
the built-ins cannot be silently removed. **Unknown dimensions are rejected**
at construction and validation.

This registry is a W1 domain extension point, not a second Semantic Spine
registry (AGENTS.md §4 concerns spine identities/kinds/trace types, which
remain solely in `@sos-2/contracts`/`@sos-2/semantic-spine`).

## Artifacts

`ContextArtifact = { envelope, content }`, content = `{ dimensions }` (exact
field sets). Envelopes and identities come from the spine; ids are
content-addressed over the exact creation address (same discipline as the
other W1 packages). Contexts are per-situation snapshots — evolution flows
through new artifacts (R5), not mutation.

## Verification

- `pnpm run build` — TypeScript strict-mode compile (`dist/`)
- `pnpm test` — unit, negative and property tests (fast-check, seed 424242)
