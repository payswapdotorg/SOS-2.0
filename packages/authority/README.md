# @sos-2/authority

SOS 2.0 **Authority** (Work Order W1): scoped AuthorityGrants with expiry and
revocation, deterministic grant evaluation, loud authorization and
anti-escalation delegation, and the first-class **ASK** contract.

## Spec alignment

| Aspect | Authority |
| --- | --- |
| Authority ordering; authority-controlled evolution | `spec/architecture.md` §3 |
| AuthorityGrant, AskRequest (core entities) | `spec/meta-model.md` |
| Decision actions ACT / EXPERIMENT / GATHER_EVIDENCE / **ASK** / REJECT / ROLLBACK | `spec/architecture.md` §5 "Decision" (frozen vocabulary in `decisions.ts`) |
| Authority-aware autonomy; first-class ASK | `spec/requirements.md` R15, R16 |
| Envelope, identity, trace links | `@sos-2/semantic-spine` (imported, never duplicated) |

## AuthorityGrant

`AuthorityGrantArtifact = { envelope, content }` (kind `AuthorityGrant`,
content-addressed deterministic id over the exact creation address — same
discipline as the other W1 packages). Content (exact field set): `grantee`,
`scope`, `permissions`, `expiry`, `revoked_at`, `revocation_provenance`.

- **Scope**: `{ kind: 'ARTIFACT', artifact_id }` (one artifact) or
  `{ kind: 'KIND', artifact_kind }` (a registered artifact kind).
- **Permissions** (frozen vocabulary): `READ`, `REVISE`, `RETIRE`, `PROMOTE`,
  `DELEGATE`.
- **Expiry** (required): `{ kind: 'TIME', at }` or
  `{ kind: 'REVISION', artifact_id, max_version }`.

### Lifecycle — VALID → EXPIRED/REVOKED, deterministic evaluation

`evaluateGrant(grant, at)` with `at = { kind: 'TIME', now }` or
`{ kind: 'REVISION', artifact_id, version }` (evaluate(grant, now|revision)):

1. `revoked_at` set → **REVOKED** (revocation beats expiry);
2. TIME expiry + TIME input → EXPIRED iff `now >= at` (instants, offsets
   honored — never string comparison);
3. REVISION expiry + matching checkpoint → EXPIRED iff `version > max_version`;
4. mismatched input kinds / wrong checkpoint artifact → **indeterminate**,
   throws `AuthorityError` (indeterminacy is never silently VALID).

`ALLOWED_GRANT_TRANSITIONS`: VALID → {EXPIRED, REVOKED}; EXPIRED and REVOKED
are terminal (`transitionGrantStatus` fails loudly on every invalid
transition). **Expired/revoked grants never authorize.**

Revocation is an explicit, versioned act: `revokeGrant(head, input)` creates
the revoked successor revision (version + 1, supersedes, provenance-carrying);
`GrantStore` keeps complete/contiguous revision history, head resolution
(`latest`), history queries and `issue`/`revoke` workflows.

## Authorization (loud) and delegation (anti-escalation)

`authorize(grant, { action, target, at })` returns the grant on success and
throws `AuthorityError` on every refusal: dead grant (EXPIRED/REVOKED) →
scope violation → missing permission (checked in that order).
`canAuthorize` is the non-throwing predicate. Scope rule: ARTIFACT scope
covers exactly its artifact; KIND scope covers its kind's artifacts and the
kind; **narrower never authorizes broader**.

`delegateGrant(parent, spec)` mints strictly-narrower children. Escalation
attempts throw: parent lacking DELEGATE or not VALID; broader child scope;
child permissions beyond the parent's; child expiry not within the parent's
(same expiry kind, within bound — a child never outlives its parent). The
delegation act itself is authorized through the same `authorize` gate with
the child scope as target.

## ASK — a SUCCESS state, not an error

`AskRequestArtifact` (kind `AskRequest`) carries the **exact decision**,
typed alternatives (each bound to one of the 6 frozen Decision actions), a
qualitative evidence-quality summary (NONE/WEAK/MODERATE/STRONG), a
qualitative uncertainty class + basis (LOW/MODERATE/HIGH/IRREDUCIBLE),
non-empty trade-offs, a typed risk `{ description, severity }`, and **why
current authority is insufficient**. Constructing a valid AskRequest is a
positive workflow; `ASK` is a first-class Decision action. Numeric
`confidence` fields are explicitly rejected (spec/meta-model.md: qualitative
classes only — uncalibrated numbers never pass as certainty).

The decision *engine* (enforcement using evidence, calibrated uncertainty,
impact, risk, reversibility, blast radius) is Work Order W10 and builds on
these contracts.

## Verification

- `pnpm run build` — TypeScript strict-mode compile (`dist/`)
- `pnpm test` — unit, negative (invalid transitions, expired/revoked use,
  scope violations, escalation attempts) and property tests (fast-check,
  seed 424242: evaluation determinism/totality, authorize/canAuthorize
  agreement, delegation-never-escalates, ASK round trips)
