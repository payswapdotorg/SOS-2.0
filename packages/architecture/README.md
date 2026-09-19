# @sos-2/architecture

The SOS 2.0 **Architecture Graph model** (Work Order W2, owned path 2 of 3):
typed nodes and edges over the ten `spec/architecture.md` §5 categories,
architecture as a versioned hypothesis over an exact SystemState revision,
deterministic graph diffs with strict application, and bounded
LocalCandidate subgraph replacement.

> **Architecture Delta**: the W2 Architecture Delta record for all three W2
> packages lives at
> [`packages/system-state/W2.architecture-delta.json`](../system-state/W2.architecture-delta.json)
> (the first W2 owned path; `spec/**` is outside W2 ownership).

## Spec alignment

| Aspect | Authority |
| --- | --- |
| Architecture Graph: typed nodes/edges for capabilities, components, interfaces, data stores, deployment, trust, policies, models, adapters and dependencies | `spec/architecture.md` §5 |
| "Architecture is a versioned projection/hypothesis over System State, not a copy of source code" | `spec/architecture.md` §6 |
| Architecture as executable constraint (invariant checking itself lives in `@sos-2/conformance`) | `spec/architecture.md` §7 |
| Evolution operators: add/remove/split/merge/replace components; change interfaces, data stores, deployment topology, policies, models | `spec/architecture.md` §8 |
| Architecture as hypothesis + executable constraint | `spec/requirements.md` R8 |
| Envelope, identity, canonical serialization | `@sos-2/semantic-spine` (imported, never duplicated) |

## Model

- **Node kinds** (extensible registry, seeded with nine §5 categories):
  `Capability`, `Component`, `Interface`, `DataStore`, `Deployment`, `Trust`,
  `Policy`, `Model`, `Adapter`.
- **Edge kinds** (extensible registry, seeded with eight canonical kinds):
  `Dependency` (the §5 "dependencies" category), `Provides`, `Consumes`,
  `Owns`, `DeploysTo`, `Trusts`, `Constrains`, `Realizes`.
- Both registries follow the spine's kind-registry pattern
  (`createKindRegistry`): explicit registration (`registerNodeKind` /
  `registerEdgeKind`), no unregister, sorted deterministic listing,
  PascalCase names.
- `GraphNode` = `{ id, kind, criticality, attributes }`; `GraphEdge` = the
  `(source, target, kind)` identity triple plus `criticality` and
  `attributes` (plain JSON). Node ids are slug-like so edge keys stay
  unambiguous.
- `ArchitectureGraphContent` = `{ projects_system_state, nodes, edges }` —
  `projects_system_state` is an EXACT SystemState revision reference
  (`{ system_state_id, version }`); content is always stored canonically
  sorted (nodes by id, edges by edge key).
- `createArchitectureGraph` mints a deterministic, content-addressed
  `sos://ArchitectureGraph/…` identity via the spine (same discipline as
  W0.5/W1).

## Deterministic diffs

- `diffGraphs(a, b)` → `{ added/removed/modified } × { nodes/edges }` with
  stable ordering (nodes by id, edges by key), byte-identical output on
  re-run (`canonicalGraphDiffText`), and structural asymmetry
  (`diff(A,B)` vs `diff(B,A)` swap added/removed and before/after).
- `applyGraphDiff(base, diff)` is STRICT: every removed/modified element must
  exist in the base exactly as recorded; every added element must be a new
  identity — apply never silently invents or drops elements.
  `apply(a, diff(a, b)) === b` is pinned by unit AND property tests.

## LocalCandidate (§8, scoped)

`LocalCandidate = { baseGraphRef, boundedSubgraph, replacement,
invariants[], predictedEffects[] }` with ten typed operators:
`ADD_COMPONENT`, `REMOVE_COMPONENT`, `SPLIT_COMPONENT`, `MERGE_COMPONENTS`,
`REPLACE_COMPONENT`, `CHANGE_INTERFACE`, `CHANGE_DATA_STORE`,
`CHANGE_TOPOLOGY`, `CHANGE_POLICY`, `CHANGE_MODEL`.

Bounding is machine-enforced (`applyLocalCandidate`):
- the base artifact must match `baseGraphRef` exactly (id + version);
- every removed or modified base element — INCLUDING edges incident to a
  removed node — must be declared in `boundedSubgraph`;
- additions must be new identities (re-adding an existing id is rejected);
- `CHANGE_*` targets must be of the required node kind;
- `CHANGE_TOPOLOGY` only adds/removes `DeploysTo` edges;
- `invariants` must be non-empty (Architecture Delta discipline).

The result carries the resulting content plus the deterministic
base → result diff. Promotion to a new ACTIVE graph revision is the
caller's (governed) decision; `applyLocalCandidate` never mints artifacts.
