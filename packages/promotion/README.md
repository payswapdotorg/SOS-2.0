# @sos-2/promotion

SOS 2.0 Promotion (Work Order W9, parallel slot C). The **evidence-gated
promotion/rollback gate** — `evaluatePromotion(candidate, { authority,
assurance, evidence })` (spec/architecture.md §13, §14;
docs/assurance-model.md: "Promotion requires current authority + assurance
+ evidence + compatible current System State"; requirements R13, R14, R15).

## What lives here

| Export | Purpose |
| --- | --- |
| `evaluatePromotion` | the gate. Deterministic and total: every valid input produces exactly ONE decision from the frozen six, a full reason audit trail and a Decision-kind spine artifact record. Promotion (ACT) happens ONLY with current authority + current assurance + current evidence + compatible current System State + a valid bounded recovery declaration |
| `DECISION_ACTIONS` (consumed) | the decision outcomes are EXACTLY the frozen six — ACT, EXPERIMENT, GATHER_EVIDENCE, ASK, REJECT, ROLLBACK — imported from `@sos-2/authority`'s frozen vocabulary; never redefined, never extended |
| `AssuranceCaseFixture` / `evaluateAssuranceCase` | the AssuranceCase-shaped input (claims + verdict + validity), consumed as a contract fixture per the W9 parallelization rule — **NOT assumed valid**: structurally invalid or REFUTED cases REJECT; INCOMPLETE verdicts and non-CURRENT validity (EXPIRED / SUPERSEDED / VIOLATED — including a case claiming CURRENT whose `expires_at` has passed, truthfully evaluated EXPIRED) block promotion with GATHER_EVIDENCE |
| `evaluateEvidenceGate` | CURRENT evidence: intervention-grade for causal claims (INTERVENTIONAL class + SUCCESS + subject-bound to the candidate, spec §18), freshness consumed from `@sos-2/evidence`'s `evaluateFreshness` (the merged W3 authority), LLM-produced records rejected (never authoritative), and **simulated records NEVER satisfy intervention requirements** — every record carrying the simulation mark is rejected loudly |
| `BoundedRecoveryDeclaration` / `assertValidBoundedRecovery` | the rollback contract — a STRUCTURAL MIRROR of the unmerged W8 `@sos-2/recovery-control` types (no W8 source imported): mechanism + bounded time OR a governed containment exception (exactly one — §13 "Live changes require bounded recovery unless a governed exception defines another containment mechanism"), with rollback triggers **wired to `@sos-2/experiments` guardrail trigger records** |
| `PromotionDecisionArtifact` / `createPromotionDecision` | Decision-kind spine artifacts recording the outcome: action, candidate, consulted grant/assurance/evidence ids (exact spine ids — R30), full reasons, the recovery declaration (REQUIRED when and only when the action is ACT), system-state snapshot, wired trigger rule ids |

## The gate order (fixed, deterministic)

0. **Candidate shape** — structurally invalid fixtures are REJECTED.
1. **Live guardrails** — a triggered ROLLBACK trigger record → decision
   ROLLBACK (safety first; unknown guardrails arrive here as triggered,
   fail-closed rollback triggers from `@sos-2/experiments`).
2. **Authority** — CURRENT authority via `@sos-2/authority`'s exported
   evaluation (`assertValidGrant` + `evaluateGrant` + `scopeCovers` + the
   frozen permission vocabulary): expired/revoked/scope/permission
   failures REJECT; **confidence is NOT authorization** (locked invariant
   — the candidate's confidence mark is never consulted); an INDETERMINATE
   evaluation (revision-bound grant without a usable checkpoint) is ASK —
   the first-class, successful ask-the-authority outcome (R16).
3. **System State** — a candidate based on a superseded revision REJECTs
   (incompatible current System State).
4. **Assurance** — see above (never assumed valid).
5. **Evidence** — missing intervention evidence → EXPERIMENT (run a real
   controlled experiment); existing-but-not-current → GATHER_EVIDENCE;
   simulated-records-only → REJECT (simulation is evaluation
   infrastructure, never evidence).
6. **Recovery** — ACT requires a valid bounded recovery declaration;
   missing/invalid → REJECT.

## Parallelization

This package consumes only MERGED authorities (`@sos-2/semantic-spine`,
`@sos-2/authority`, `@sos-2/evidence`, `@sos-2/provenance`) plus W9's own
`@sos-2/experiments`. It has **no dependency on W7 (search) or W8
(assurance) source** — candidates and assurance cases arrive through their
frozen contract shapes (see `test/compatibility.test.ts`).

## Golden fixtures

`fixtures/promotion-decision.json` is the golden ACT decision, reproduced
bit-exactly from the documented golden path (pinned by tests; regenerate
with `node scripts/make-fixtures.mjs` after `pnpm run build`).
