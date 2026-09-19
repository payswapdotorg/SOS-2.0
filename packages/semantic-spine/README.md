# @sos-2/semantic-spine

The operational core of the SOS 2.0 Semantic Spine (Work Order W0.5):
stable semantic identities, versioned artifact envelopes, typed trace links,
canonical serialization, the Architecture Delta contract and deterministic
conformance classification.

## EXPORT DISCIPLINE (binding for downstream Work Orders)

**This package is the ONLY sanctioned way downstream code obtains core
identifiers and spine vocabulary.** Downstream code must either:

1. mint ids through the exported minters:
   - `mintRandomArtifactId(kind)` — UUID v4-backed random segment
   - `deriveDeterministicArtifactId(kind, content)` — sha-256 content-addressed
     segment (first 32 hex chars over the canonical serialization)
2. consume the golden fixtures in [`./fixtures/`](./fixtures/README.md) —
   never invent identifiers.

The normative TYPES are re-exported from `@sos-2/contracts` (the single
semantic registry — no second registry is permitted). The only runtime
dependency of this package is that intra-workspace package; there are zero
external (npm registry) runtime dependencies.

## Artifact identity

Ids are globally unique and stable: `sos://<kind>/<segment>` where the segment
is 32 lowercase hex characters.

- **Deterministic mode** (default for `createEnvelope`): the segment is the
  first 32 hex chars of `sha-256(canonical JSON of the content)`. Same
  (kind, content) → same id, forever. The kind is part of the id namespace.
- **Random mode**: UUID v4, dashes stripped.
- `ArtifactIdRegistry` detects collisions: registering an id that already
  exists with a different content hash throws — different content never
  collides silently. `register(id, kind, contentHash)` supports reloading ids
  from durable storage and is idempotent for identical content.

## Envelope lifecycle

Status vocabulary: `DRAFT → ACTIVE → SUPERSEDED/RETIRED`, plus
`DRAFT → RETIRED`. `SUPERSEDED` and `RETIRED` are terminal.

| From | Allowed transitions |
| --- | --- |
| DRAFT | ACTIVE, RETIRED |
| ACTIVE | SUPERSEDED, RETIRED |
| SUPERSEDED | (terminal) |
| RETIRED | (terminal) |

- Envelopes are created in `DRAFT` (default) or `ACTIVE` (when superseding);
  never in a terminal state.
- `created_at` is caller-supplied RFC3339 — no hidden clocks.
- Identity is minted at creation and **preserved across transitions**
  (`withStatus`, `EnvelopeStore.setStatus`).
- `supersedes` must reference an existing id — enforced by `EnvelopeStore.put`.
- `EnvelopeStore.supersede(oldId, input)` marks the old envelope `SUPERSEDED`
  and registers the next version (`version + 1`, `ACTIVE`,
  `authority_ref` inherited by default, same kind).

## Typed trace links

17 frozen types (see `@sos-2/contracts` `TRACE_LINK_TYPES`). `createTraceLink`
requires provenance (non-empty entries); `validateTraceLink` accepts
schema-valid links whose provenance is absent (the frozen schema permits
absence — the layering is documented and tested). `TraceLinkStore` rejects
duplicate `(source, target, type)` pairs and answers forward (`from`) and
backward (`to`) queries.

## Canonical serialization

Canonical JSON: recursively sorted keys (UTF-16 code-unit order), no
insignificant whitespace, UTF-8 bytes for hashing. `serialize → parse →
serialize` is byte-identical.

**Documented behavior on non-canonical input: NORMALIZE.** The canonicalizer
accepts any JSON value (or text, via parse) and deterministically emits the
canonical form; it does not reject non-canonical spellings. `isCanonicalText`
tests whether a text is already canonical. Non-JSON values (functions,
symbols, bigints, `undefined`, non-finite numbers, class instances) are
rejected with `CanonicalizationError`. `contentHash` is the full sha-256 hex
over the canonical bytes.

## Architecture Delta

`buildArchitectureDelta` / `validateArchitectureDelta` enforce the frozen
schema plus the SOS strictness that a delta must affect something
(`affected_artifacts` non-empty) and preserve something
(`preserved_invariants` non-empty) with non-empty string entries.

## Conformance classifier

`classifyDifferences(observed: ImplementationModel, declared:
ArchitectureGraphRef, config?) → ConformanceFinding[]` — a deterministic,
rule-based, fully documented mapping (rules are documented in the source of
`src/conformance-classifier.ts` and summarized here):

| Situation | Classification |
| --- | --- |
| declared & present, kinds equal | not reported (match) |
| declared & present, kinds differ | `UNKNOWN` (ambiguous) — or `INTENTIONAL_EVOLUTION` when pre-authorized |
| declared, missing, normal | `DRIFT` |
| declared, missing, critical | `CONTRADICTION` |
| declared, missing, realized via `realizes` refinement components | `PRESERVING_REFINEMENT` |
| declared, missing, pre-authorized | `INTENTIONAL_EVOLUTION` |
| present but undeclared | `IMPLEMENTATION_DETAIL` (default) or `EXPECTED_VARIATION` (via `expectedVariations` allowlist or `undeclaredPolicy`) |

The same rules apply to dependency edges (subject `"<source>-><target>"`).
`ArchitectureGraphRef` is a minimal typed node/edge subset — the full
ArchitectureGraph is W2's work and is intentionally NOT implemented here.
W0.5 classifies components and dependency edges only; interfaces, tests,
builds, deployments and runtime mappings are carried by the
ImplementationModel contract for later Work Orders.

## Validation layering

| Layer | Behavior |
| --- | --- |
| `@sos-2/contracts` guards | schema-faithful (ajv-equivalent) shape checks |
| `@sos-2/semantic-spine` | SOS discipline: well-formed `sos://` ids, registered kinds, non-empty provenance, strict lifecycle transitions, non-empty delta core fields |

## Verification

- `pnpm run build` — TypeScript strict-mode compile (`dist/`)
- `pnpm test` — unit, negative, property (fast-check, seed 424242) and
  golden-fixture consistency tests through both TS guards and ajv
