# @sos-2/recovery-control

SOS 2.0 Recovery Control (Work Order W8, parallel slot B). The **rollback
contract**: every live change declares a bounded recovery mechanism,
trigger, authority and evidence; unbounded/unspecified recovery is
**rejected** unless an explicit governed exception record exists; and the
**trusted boundary** — candidate code can never disable the assurance
policy.

## What lives here

| Export | Purpose |
| --- | --- |
| `RecoveryDeclarationArtifact` | a Semantic Spine envelope (extension kind `RecoveryDeclaration`, registered through the spine's add-only API) + the exact content: `change_ref`, `mechanism`, `trigger`, `authority_ref`, `evidence_ref`, `exception` — **all four declarations mandatory** (docs/assurance-model.md: "Every live change declares: rollback mechanism, trigger, authority and evidence") |
| `RecoveryMechanism` | typed and bounded-by-construction: `ROLLBACK_DEPLOYMENT { to_deployment_id }`, `DISABLE_FEATURE { feature_id }`, `RESTORE_STATE { snapshot_id }`, `CUSTOM_PROCEDURE { procedure_ref }`, `UNSPECIFIED` (the unbounded case — policy-rejected without an exception) |
| `RecoveryTrigger` | concrete triggers only: `BUDGET { metric, threshold, window_ms }`, `DEADLINE { within_ms }`, `MANUAL { authority_ref }` ("someone will notice" is rejected) |
| `GovernedException` | the explicit exception record (authority + alternative containment + provenance) — the ONLY way unbounded recovery is ever accepted (spec/architecture.md §13) |
| `checkRecoveryDeclarationAgainstPolicy` | pure policy verdict: `{ required, satisfied, reason }` — satisfaction is exactly (bounded OR exception OR policy-off) |
| `RecoveryPolicyArtifact` / `updateRecoveryPolicy` | the trusted policy (`require_bounded_recovery`, default **true**) and its ONLY mutation path: origin `TRUSTED_OPERATORS` + a valid `@sos-2/authority` grant carrying `REVISE` over this policy + (to weaken) a governed exception record |
| `RecoveryGate` | the full gate for live change registration: declaration → policy → authority → evidence, every refusal loud |

## The trusted boundary (architecture lock)

spec/architecture-lock.md forbids "the trusted assurance mechanism disabled
by untrusted candidate code". Policy changes therefore require **both**:

1. **Trusted origin** — `origin: 'CANDIDATE'` is rejected
   **unconditionally**, before any authority evaluation: no grant, however
   broad, lifts this. Candidates propose through the governed ASK /
   Architect path, never through this one. (Pinned by the dedicated test:
   a candidate disable attempt with a fully valid grant is still rejected.)
2. **Valid authority** — `authorize(grant, { action: 'REVISE', target: this
   policy })` through the merged W1 authority: expired/revoked grants,
   scope violations and missing permissions all refuse loudly.

Additionally, **weakening** the policy (setting
`require_bounded_recovery` to false) requires an explicit governed
exception record — turning the global rule off is itself an exceptional act
(§13), so the per-change exception mechanism applies to the policy lever
too.

## The gate (registration order)

1. **Declaration** — structurally valid (mechanism, trigger, authority,
   evidence all declared and well formed).
2. **Policy** — unbounded/unspecified recovery REJECTED unless an explicit
   governed exception record exists.
3. **Authority** — the presented grant must BE the declaration's named
   `authority_ref` (no substitution) and validly authorize `PROMOTE` on the
   live change artifact at the registration instant (merged W1 authority).
4. **Evidence** — the referenced Evidence record must be present in the
   provided pool with availability `SUCCESS` — only working-mechanism
   evidence passes (failed/inconclusive rehearsals and missing records are
   refused; fail-safe).

## Layering

```
@sos-2/semantic-spine (W0.5, frozen)  ←  @sos-2/recovery-control (this package)
@sos-2/authority      (W1, merged)    ←     (authorize, AuthorityGrantArtifact — never re-implemented)
@sos-2/evidence       (W3, merged)    ←     (assertValidEvidenceRecord, EvidenceRecordW3)
```

Two documented extension kinds are registered through the spine's
sanctioned add-only API (the W3 `ProvenanceRecord` / W5 `CorrelationRecord`
precedent): `RecoveryDeclaration` and `RecoveryPolicy`.

## Invariants pinned by tests

- Unbounded recovery without a governed exception is rejected (the core
  rollback contract).
- Candidate-originated attempts to change the recovery policy are ALWAYS
  rejected — even with a fully valid grant (the architecture-lock test).
- Trusted + granted weakening without a governed exception is rejected.
- Expired/out-of-scope/unpermitted grants never register live changes; the
  declaration's own grant must be presented (no substitution).
- Missing, failed or inconclusive rehearsal evidence never registers.
- Creation/update/gate determinism and canonical round trips (property
  tests, fixed seed).
