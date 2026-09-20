# Golden Contract Fixtures (W9 — experiments)

Canonical baseline instances of the W9 experimentation contracts. Every
fixture reproduces bit-exactly from the documented sample inputs (pinned
by `test/fixtures.test.ts`; regenerate after `pnpm run build` with
`node scripts/make-fixtures.mjs`).

| Fixture | Contract |
| --- | --- |
| `candidate-state.json` | `CandidateStateFixture` — frozen core kind `CandidateState` spine envelope + content (invariants, predicted effects, causal claim, confidence, base revision, hypothesis ref, bounded-subgraph ref, context) |
| `experiment.json` | `ExperimentArtifact` — frozen core kind `Experiment` spine envelope + content (design, SHADOW stage at creation, canary ladder, candidate + hypothesis links, producer) |
| `experiment-result.json` | `ExperimentResultRecord` — a typed result record under the frozen core kind `Evaluation`, linked to the experiment, the candidate and the causal hypothesis, with truthful 6-state metric outcomes |

## Identifier discipline

All artifact ids are content-addressed through `@sos-2/semantic-spine`
(`sos://<kind>/<first 32 hex of sha-256 over the canonical creation
address>`) and reproduced bit-exactly by the public API
(`createCandidateState`, `createExperiment`, `createExperimentResult`).

The fixture set is internally cross-referenced: the experiment's
`candidate_ref` is the candidate fixture's id; the result record cites the
experiment, the candidate and the hypothesis.

## Sample-data notice

The `source_revision` in dependent evidence fixtures references the W9
base commit `f2f20663d84b55da7dcd7ac34125b2b7ce896e34` as realistic
sample data. These fixtures are contract test data, not evidence claims
about any system.
