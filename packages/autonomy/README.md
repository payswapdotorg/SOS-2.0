# @sos-2/autonomy

SOS 2.0 Autonomy Policy (Work Order W10, parallel slot A). The **autonomy
level ladder**, **scoped authority enforcement**, the **risk x
irreversibility escalation matrix** and **governed autonomy raises**
(spec/architecture.md §3, §5, §18; spec/requirements.md R15;
spec/architecture-lock.md forbidden shortcuts "confidence alone authorizing
risky changes" and "unauthorized autonomy increases").

## What lives here

| Export | Purpose |
| --- | --- |
| `AUTONOMY_LEVELS` / `AUTONOMY_LEVEL_RANKS` | the frozen, totally-ranked ladder: `SUPERVISED` (grant + explicit per-request authority decision), `BOUNDED` (currently-valid covering grant), `AUTONOMOUS_LOW_RISK` (grant + the risk profile stays in the autonomous-safe region) |
| `REQUIRED_LEVEL_TABLE` / `requiredLevel` | the default required level per (action kind x blast radius) — action kinds are the frozen @sos-2/authority permissions (READ, REVISE, RETIRE, PROMOTE, DELEGATE — consumed, never redefined) |
| `ESCALATION_MATRIX` / `escalationOutcome` / `escalates` | the risk x irreversibility matrix, total over the 4x3 grid: SEVERE escalates at any reversibility; HIGH unless fully reversible; MODERATE only when irreversible. A pure function of (risk, reversibility) — **no confidence input exists anywhere in the API** |
| `evaluateAuthorityCoverage` | the authority dimension: grants (through @sos-2/authority's `evaluateGrant` + `scopeCovers`, verbatim), raises, level satisfaction -> `PERMITTED` / `DENIED` (structured codes) / `ESCALATED` (structured codes) |
| `evaluateAutonomy` | coverage PLUS the escalation matrix — a PERMITTED coverage still escalates in the corner; the matrix applies at EVERY level |
| `authorizeAutonomyRaise` / `AutonomyRaiseArtifact` | GOVERNED raises: minted only with an explicit, currently-valid, scope-covering, action-permissive grant FOR THE RAISE ITSELF; strictly-increasing level anchored to the table default; expiry within the grant's; **silent raises throw loudly** |
| `raiseApplies` | enforcement-time applicability: a raise applies only while its backing grant is presented, VALID, permissive and covering — otherwise ignored (fail-closed toward the MORE restrictive default) |

## The enforcement verdicts (deterministic, total)

- **PERMITTED** — the effective level is satisfied (grants never implicitly
  authorize: dead grants never qualify; several qualifying grants resolve
  to the first in sorted-id order — presentation order never matters).
- **DENIED** — structured codes: `EXPIRED` / `REVOKED` (dead grants
  dominate every other failure), `NO_GRANT`, `PERMISSION_MISSING`,
  `SCOPE_MISMATCH`, `INDETERMINATE_EVALUATION` (never silently VALID —
  the W9 mapping for revision-bound grants at a clock).
- **ESCALATED** — `SUPERVISED_REQUIRES_EXPLICIT_DECISION`,
  `LOW_RISK_PROFILE_VIOLATION`, `RISK_IRREVERSIBILITY_ESCALATION`.

Confidence is **never consulted** — not a parameter, not a field, not a
code path. The locked invariant is enforced structurally.

All identities and the kind registry come from @sos-2/semantic-spine
(AutonomyRaise is an explicitly-registered add-only extension kind); grant
semantics, permissions, risk severities and uncertainty classes are
consumed from @sos-2/authority. See ARCHITECTURE-DELTA.json for the full
delta record.
