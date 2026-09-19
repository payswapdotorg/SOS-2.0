# @sos-2/system-state

The SOS 2.0 **System State model** (Work Order W2, owned path 1 of 3): typed,
versioned system state binding the exact running/referenced state of the
system, with complete and queryable revision history.

> **Architecture Delta**: the W2 Architecture Delta record for all three W2
> packages lives at
> [`W2.architecture-delta.json`](./W2.architecture-delta.json)
> (this package is the first owned path of Work Order W2; `spec/**` is outside
> W2 ownership, so the record lives here — the same convention W1 used).

## Spec alignment

| Aspect | Authority |
| --- | --- |
| System State sections (architecture, implementation, configuration, deployment, policy, environment relationships, active experiments, package realizations) | `spec/architecture.md` §5 "System State" |
| Versioned System State | `spec/requirements.md` R7 |
| "Every promoted change is reproducible from exact revisions and evidence" | `spec/architecture.md` §18 |
| Envelope, identity, canonical serialization | `@sos-2/semantic-spine` (imported, never duplicated) |
| Architecture-as-hypothesis reference direction | `spec/architecture.md` §6 |

## Model

`SystemStateContent` carries the **exact eight sections** of
`spec/architecture.md` §5:

- `architecture_ref` — the ArchitectureGraph artifact (id + version) this
  system state is observed against;
- `implementation` — ImplementationModel artifact ids, each with an exact
  **git-sha** revision;
- `configuration` — configuration ids, each with an exact **config-version**
  revision;
- `deployment` — deployment ids with environment, each with an exact
  **deployment-id** revision;
- `policy` — active policies with integer versions;
- `environment_relationships` — typed relationships between environments
  (seeded registry: `depends-on`, `promotes-to`, `mirrors`, `isolated-from`;
  extensible via `registerEnvRelationshipKind`, kebab-case vocabulary);
- `active_experiments` — `sos://Experiment/…` artifact ids with environment;
- `package_realizations` — `sos://Package/…` artifact ids with version and the
  component ids that realize them.

## Exact-revision discipline (the W2 invariant)

Every implementation/deployment/configuration reference **must** carry an
`ExactRevision { kind, value }` of the frozen kind that matches its reference
type: `git-sha` for implementation, `deployment-id` for deployment,
`config-version` for configuration. The mapping is enforced in both
directions — a missing revision, an empty value, or a mismatched kind (e.g. a
configuration carrying a `git-sha`) makes the SystemState **invalid**
(`assertValidSystemStateContent` throws). This is pinned by negative tests.

## Identity and history

- `SystemStateArtifact = { envelope, content }`; the envelope always comes
  from the spine (`createEnvelope`, kind `SystemState`), the id is always
  content-addressed (`deriveDeterministicArtifactId` over the creation
  address: all envelope fields + content) — identical creation input
  reproduces the identical id.
- `SystemStateStore` keeps revision chains **linear, contiguous and
  complete**: `supersede()` performs the atomic ACTIVE → SUPERSEDED
  transition and registers version + 1; `history(id)` returns the full chain
  ordered root → newest; `latest(id)` walks to the chain head. Branching,
  gapped, or dangling supersedes are rejected at `put()`.
- `canonicalSystemStateText` / `systemStateHash` serialize/hash the whole
  artifact via the spine's canonical serializer.

## Zero-runtime-dependency note

Runtime dependency: `@sos-2/semantic-spine` only. Dev dependencies:
TypeScript, vitest, fast-check, `@types/node` — same layout as the W0.5/W1
packages.
