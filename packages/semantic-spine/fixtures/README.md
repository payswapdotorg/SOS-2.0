# Golden Contract Fixtures (W0.5)

These are the canonical baseline instances of every core contract type.
Downstream Work Orders (W1-W18) consume these fixtures — or mint new ids via
`@sos-2/semantic-spine` — so that **no downstream worker ever invents core
identifiers**.

| Fixture | Contract | Schema |
| --- | --- | --- |
| `artifact-envelope.json` | `ArtifactEnvelope` (Mission, DRAFT) | typed contract in `@sos-2/contracts` (no JSON Schema exists for the envelope) |
| `trace-link.json` | `TraceLink` (ImplementationModel REALIZES ArchitectureGraph) | `sos://schema/trace-link` |
| `architecture-delta.json` | `ArchitectureDelta` | `sos://schema/architecture-delta` |
| `evidence.json` | `EvidenceRecord` | `sos://schema/evidence` |
| `package-record.json` | `PackageRecord` | `sos://schema/package` |
| `implementation-model.json` | `ImplementationModel` (self-describing: the W0.5 packages themselves) | `sos://schema/implementation-model` |

## Identifier discipline

All artifact ids are **content-addressed** (`sos://<kind>/<first 32 hex of
sha-256 over the canonical serialization of the content minus the id field>`)
and are reproduced bit-exactly by the public API:

- `createEnvelope(...)` reproduces `artifact-envelope.json`'s id,
- `deriveDeterministicArtifactId('ImplementationModel', <model minus id>)`
  reproduces `implementation-model.json`'s id (same for evidence and package
  records),
- `sos://Constitution/9adb...` and `sos://ArchitectureGraph/1800...` are
  fixture anchor ids derived from fixed anchor content.

The fixture set is internally cross-referenced: the trace link's source is the
implementation-model id, its target is the declared architecture-graph anchor,
the evidence record's subject is the implementation model, and the package
record cites the evidence record and all five contract schemas.

## Sample-data notice

`source_revision` values in these fixtures reference the W0.5 base commit
`5b0aea0386ee56f91e53ffa0e34e74a0da1682bf` as realistic sample data. These
fixtures are contract test data, not evidence claims about any system.

## Verification

`packages/semantic-spine/test/fixtures.test.ts` validates every fixture
through BOTH the TypeScript guards and ajv (via
`@sos-2/contracts/schema-loader` against the schemas in `spec/contracts/`),
checks canonical-serialization round trips, and pins id reproduction.
