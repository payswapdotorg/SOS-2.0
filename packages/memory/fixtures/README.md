# Golden Contract Fixture (W5 — @sos-2/memory)

The canonical baseline instance of this package's artifact, following the
W0.5 golden-fixture discipline: downstream consumers (and this package's own
tests) never invent identifiers — they mint ids through
`@sos-2/semantic-spine` or consume this fixture.

| Fixture | Contract |
| --- | --- |
| `architecture-memory.json` | `ArchitectureMemoryArtifact` — one entry of each of the seven memory kinds: a PREDICTION (derived from a CausalHypothesis artifact), an OBSERVATION, a REALIZED OUTCOME (referencing the prediction), a FAILURE (with retained context), an OPEN HIGH TEAM-owned LIABILITY, a ROLLBACK (with from/to revisions and reason) and a LEARNED_RULE (applicability + evidence + qualitative uncertainty); update provenance: a tool producer + one evidence ref |

## Identifier discipline

The artifact id is content-addressed (deterministic over the creation
address — envelope fields minus `id`, plus content):

- `sos://ArchitectureMemory/f5440c62f185fd4833f2d4c1451e8b5a`

`ArchitectureMemory` is one of the 19 frozen core kinds — no kind
registration is performed or needed.

The fixture is PINNED by `test/fixtures.test.ts`: it reproduces
bit-exactly from the documented golden sample input (`test/helpers.ts`
`sampleMemoryContent` with provenance `['W5:fixture']` and `created_at`
`2025-01-01T00:00:00.000Z`).

## Sample-data notice

The `source_revision` values reference the W3 base content as realistic
sample data; the referenced evidence records are synthetic contract test
data, not evidence claims about any real system.
