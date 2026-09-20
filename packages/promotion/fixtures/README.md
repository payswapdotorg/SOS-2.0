# Golden Contract Fixtures (W9 — promotion)

Canonical baseline instance of the W9 promotion decision contract. The
fixture reproduces bit-exactly from the documented golden path (pinned by
`test/fixtures.test.ts`; regenerate after `pnpm run build` with
`node scripts/make-fixtures.mjs`).

| Fixture | Contract |
| --- | --- |
| `promotion-decision.json` | `PromotionDecisionArtifact` — frozen core kind `Decision` spine envelope + content: an ACT promotion with the full gate audit trail and a bounded recovery declaration wired to a real `@sos-2/experiments` guardrail trigger record |

## Identifier discipline

The decision id is content-addressed through `@sos-2/semantic-spine`
(`sos://Decision/<first 32 hex of sha-256 over the canonical creation
address>`) and reproduced bit-exactly by `evaluatePromotion` on the
golden path. The consulted authority grant, assurance case and evidence
record are cited by exact spine ids (R30 reproducibility).

## Sample-data notice

The cited evidence `source_revision` references the W9 base commit
`f2f20663d84b55da7dcd7ac34125b2b7ce896e34` as realistic sample data. This
fixture is contract test data, not an evidence claim about any system.
