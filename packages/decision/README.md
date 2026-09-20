# @sos-2/decision

SOS 2.0 Decision Engine (Work Order W10, parallel slot A).
`evaluate(request) → DecisionRecord` — the outcome is **exactly one of the
frozen six** (ACT, EXPERIMENT, GATHER_EVIDENCE, ASK, REJECT, ROLLBACK —
consumed from @sos-2/authority's `DECISION_ACTIONS`, never redefined), and
every record is **reproducible**: it carries the exact input digest
(canonical sha-256 over the request) and the ordered rule trace;
re-evaluation of the same input yields the byte-identical record
(spec/architecture.md §3, §5, §18; spec/requirements.md R15, R16, R30).

## The rule order (explicit, deterministic; ties: authority, then safety, then evidence)

0. **R0 SHAPE** — a structurally invalid request (foreign vocabulary,
   malformed target/instant, invalid grants) is REJECTED, never evaluated.
1. **R1 AUTHORITY** — the autonomy policy (@sos-2/autonomy
   `evaluateAuthorityCoverage`): dead grants (EXPIRED/REVOKED) → REJECT;
   insufficient authority (NO_GRANT / scope / permission / indeterminate)
   → **ASK** (the first-class ask-the-authority outcome); SUPERVISED
   without the explicit decision → ASK; **confidence is never consulted**
   (the optional Confidence mark is digested, recorded, displayed — and
   read by no rule).
2. **R2 SAFETY** — wired rollback signals → ROLLBACK; the risk x
   irreversibility matrix corner → **ASK regardless of confidence**
   (locked invariant).
3. **R3 EVIDENCE** — consumed from @sos-2/evidence (+ the
   @sos-2/experiments simulation mark, checked first — the W9 discipline):
   simulated evidence → REJECT; LLM evidence never satisfies; causal
   claims without real interventional evidence → EXPERIMENT;
   existing-but-not-current → GATHER_EVIDENCE; HIGH/CRITICAL impact
   without current SUCCESS evidence → GATHER_EVIDENCE.
4. **R4 UNCERTAINTY** — IRREDUCIBLE → ASK; HIGH → GATHER_EVIDENCE.
5. **R5 ACT** — every gate passed.

## Key exports

| Export | Purpose |
| --- | --- |
| `evaluate` | the engine. Deterministic, total, reproducible; mints a Decision-kind spine artifact |
| `DecisionRequest` / `assertValidDecisionRequest` / `decisionInputDigest` | the typed input and its canonical digest |
| `DecisionRecord` / `assertValidDecisionRecord` | record validation: frozen-six action, non-empty contiguous rule trace, escalation iff ASK, resolution iff the resolution path, 64-hex digest |
| `verifyDecision` | reproducibility verification: re-evaluates and rejects tampered records |
| `mintResolutionDecision` | an ASK resolved by an authority produces a DecisionRecord with the provenance of who resolved it, bound to the origin's exact input digest |

Records are Decision-kind spine artifacts (deterministic content-addressed
ids — exactly like @sos-2/promotion's decision records). See
ARCHITECTURE-DELTA.json for the full delta record.
