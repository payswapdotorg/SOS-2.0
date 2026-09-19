# @sos-2/contracts

Normative contract **types** for the SOS 2.0 Semantic Spine. This package is
the single source of semantic truth for the frozen vocabularies and record
shapes — no second semantic registry is permitted (AGENTS.md §4).

## What lives here

| Contract | Aligned with |
| --- | --- |
| `ArtifactEnvelope` (exact 8-field set: `id, kind, version, status, authority_ref, provenance, created_at, supersedes`) | `spec/meta-model.md` (typed contract; no JSON Schema exists for the envelope) |
| `TRACE_LINK_TYPES` (17 frozen types) + `TraceLink` | `spec/contracts/trace-link.schema.json` |
| `EVIDENCE_TRUTH_STATES` (6 distinct states) + `EvidenceRecord` | `spec/contracts/evidence.schema.json` |
| `CONFORMANCE_CLASSES` (7 frozen classes) | `spec/architecture.md` §6 |
| `CORE_ARTIFACT_KINDS` (19 core entities) + extensible `KindRegistry` | `spec/meta-model.md` |
| `ArchitectureDelta` | `spec/contracts/architecture-delta.schema.json` |
| `PackageRecord` (+ 7-value maturity vocabulary) | `spec/contracts/package.schema.json` |
| `ImplementationModel` (+ sub-records) | `spec/contracts/implementation-model.schema.json` (added by W0.5) |

## Layering rule

- **This package** is schema-faithful: guards never accept what the
  corresponding JSON Schema rejects. The only documented strengthenings are
  non-empty identifier strings where a schema merely says `"string"` — no
  legitimate SOS artifact carries an empty identifier.
- **`@sos-2/semantic-spine`** adds operational SOS discipline on top
  (well-formed `sos://` ids, registered kinds, non-empty provenance, strict
  lifecycle transitions). Downstream code should obtain core identifiers from
  `@sos-2/semantic-spine`.

## Kind registry

The 19 core kinds are built-in and canonical. Extensions go through the
explicit API:

```ts
import { registerArtifactKind, listArtifactKinds } from '@sos-2/contracts';
registerArtifactKind('MissionStatement');   // explicit, throws on duplicates
```

## Schema loader (subpath export)

```ts
import { createContractValidator } from '@sos-2/contracts/schema-loader';
const validator = createContractValidator();          // finds spec/contracts by walking up
validator.assertValid('trace-link', someLink);        // by name...
validator.assertValid('sos://schema/evidence', rec);  // ...or by $id
```

The loader requires `ajv` (a devDependency of this package). It is exported as
a separate subpath so the main entry keeps **zero runtime dependencies**.
Repository location resolution order: explicit `root` argument →
`SOS_REPO_ROOT` env var → walk up from `process.cwd()` until `spec/contracts`
is found. Only top-level `*.schema.json` files are treated as schemas;
instance documents (e.g. `spec/contracts/deltas/*.json`) live in
subdirectories and are never loaded as schemas.

## Verification

- `pnpm run build` — TypeScript strict-mode compile (`dist/`)
- `pnpm test` — unit + negative guard tests, schema-loader tests, ajv-based
  schema consistency checks
