# Golden Contract Fixtures (W5 — @sos-2/causal)

The canonical baseline instances of this package's artifacts, following the
W0.5 golden-fixture discipline: downstream consumers (and this package's own
tests) never invent identifiers — they mint ids through `@sos-2/semantic-spine`
or consume these fixtures.

| Fixture | Contract |
| --- | --- |
| `causal-hypothesis.json` | `CausalHypothesisArtifact` — a CAUSAL claim (cache → p99) with the full content contract: intervention, mechanism, predicted outcomes, assumptions, context, alternatives, refutations, causal graph (incl. a CONFOUNDS relation), one observational + one interventional SUCCESS evidence reference, qualitative MODERATE uncertainty |
| `correlation.json` | `CorrelationRecordArtifact` — a NEGATIVE correlation (cache hit rate ↔ p99) with two variables, one observational evidence reference and qualitative UNQUANTIFIED uncertainty |

## Identifier discipline

Both artifact ids are content-addressed (deterministic over the creation
address — envelope fields minus `id`, plus content):

- `sos://CausalHypothesis/1be0fa16f7bfcf890d8a01ed437962c9`
- `sos://CorrelationRecord/e5b96c7c7b97c2d90be6e2bbf1217dc0`

`CausalHypothesis` is one of the 19 frozen core kinds; `CorrelationRecord`
is a documented, explicitly registered spine extension kind (the sanctioned
add-only `registerArtifactKind` API).

The fixtures are PINNED by `test/fixtures.test.ts`: they reproduce
bit-exactly from the documented golden sample inputs (the defaults of
`test/helpers.ts` `sampleHypothesisContent` / `sampleCorrelationContent`
with provenance `['W5:fixture']` and `created_at` `2025-01-01T00:00:00.000Z`).

## Sample-data notice

The `source_revision` values reference the W3 base content as realistic
sample data; the referenced evidence records are synthetic contract test
data, not evidence claims about any real system.
