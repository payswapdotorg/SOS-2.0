# @sos-2/mission

The SOS 2.0 **Mission model** (Work Order W1): versioned, authority-controlled
mission artifacts with progressive formalization, an explicit revision
workflow, and complete/queryable revision history.

> **Architecture Delta**: the W1 Architecture Delta record for all four W1
> packages lives at [`W1.architecture-delta.json`](./W1.architecture-delta.json)
> (this package is the first owned path of Work Order W1; `spec/**` is outside
> W1 ownership, so the record lives here).

## Spec alignment

| Aspect | Authority |
| --- | --- |
| Mission fields (purpose, goals, outcomes, stakeholders, measures, assumptions, ambiguities, constraints, revision history) | `spec/architecture.md` §5 "Mission" |
| "Mission revision is explicit, versioned and authority-controlled" | `spec/architecture.md` §3 Authority |
| Progressive formalization | `spec/requirements.md` R2; R3 (explicit mission evolution) |
| Envelope, identity, trace links, canonical serialization | `@sos-2/semantic-spine` (imported, never duplicated) |

## Model

`MissionContent` carries the eight §5 elements with an **exact field set**:
`purpose` (mandatory — the single semantic anchor) plus seven collections
(`goals`, `outcomes`, `stakeholders`, `measures`, `assumptions`,
`ambiguities`, `constraints`), all of which may start empty (progressive
formalization). Elements carry **local ids** (lowercase slugs, unique across
the whole content) that are deliberately distinct from Semantic Spine
artifact ids — the mission artifact as a whole carries the `sos://` identity.

Machine-checked invariants (enforced at construction and validation):

- a goal marked `MEASURABLE` or `ACHIEVED` must reference at least one
  **existing** measure (progressive formalization invariant);
- every goal measure reference and outcome goal reference resolves;
- mission constraints are `{ id, statement, hard, bound }`; `hard` marks the
  §18 authority surface; `bound` is the optional machine-checkable
  formalization `{ axis, direction: MAX|MIN, limit }` that typed Value
  constraints are checked against by `@sos-2/value`.

## Artifacts and identity

`MissionArtifact = { envelope, content }`. Envelopes come from the spine
(`createEnvelope`, kind `Mission`); ids are minted by the spine
(`deriveDeterministicArtifactId`) over the exact creation address
(all envelope fields except `id`, plus the content). Same creation input →
same id, forever (pinned by tests). Identity is preserved across lifecycle
transitions by the spine.

## Revision workflow (explicit, versioned, authority-controlled)

- `reviseMission(current, input)` / `MissionStore.revise(id, input)`:
  only an **ACTIVE** mission can be revised (DRAFT/SUPERSEDED/RETIRED → loud
  `MissionError`; the chain can never branch);
- a revision **requires an AuthorityGrant reference** — a well-formed
  `sos://AuthorityGrant/<32 hex>` id. Deep grant semantics (validity, expiry,
  revocation, scope, permission) belong to `@sos-2/authority`; the two
  packages compose (composed workflow proven in
  `test/integration.authority.test.ts`, a test-only dependency);
- the revision is a new versioned artifact: `version + 1`, `supersedes` the
  previous id, status `ACTIVE`, `authority_ref` = the authorizing grant;
- lineage is recorded as a **DERIVED_FROM** trace link (one of the 17 frozen
  types) from the revision to its predecessor;
- `MissionStore.history(id)` returns the complete root → head chain, ordered
  by strictly contiguous versions — `put()` rejects dangling supersedes
  targets and version jumps, so history is complete by construction.

## Verification

- `pnpm run build` — TypeScript strict-mode compile (`dist/`)
- `pnpm test` — unit, negative, property (fast-check, seed 424242; randomized
  revision chains round-trip through the canonical serializer) and composed
  authority-integration tests
