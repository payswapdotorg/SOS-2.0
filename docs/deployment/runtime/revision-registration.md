# Deployment Revision Registration

Every completed deployment records its exact revisions. The
machine-checkable record contract and the in-memory/local reference
registrar live in `infra/deployment/src/revisions/registrar.ts`; the
suites in `infra/deployment/test/revisions.test.ts` pin the contract.

## The record

```jsonc
{
  "environment": "preview",              // local | preview | production
  "provider": "vercel",                  // vercel | neon | upstash | r2 | github | execution-body-provider
  "region": "iad1",                      // from the provider region contract
  "source_revision_sha": "c924e617650a243df9df7580e60d0e021fac1059",  // exact 40-hex git sha
  "deployment_revision_id": "dpl-preview-0001",  // provider-assigned, opaque
  "registered_at": "2026-01-05T09:00:00Z",       // RFC3339 UTC — INJECTED clock value
  "rollback_pointer": { "previous_deployment_revision_id": null }
}
```

Contract rules (all typed-rejected on violation):

- the source revision is the **exact git sha** the deployment was built
  from — the exact-head rule; 40 lowercase hex chars, no aliases, no
  branch names;
- `registered_at` is an injected instant — the registrar never reads a
  clock (library code contains no `Date.now`);
- the region must belong to the provider's region contract (documented
  subsets with defaults: Vercel `iad1`, Neon `aws-us-east-1`, Upstash
  `global`, R2 `auto`, GitHub `global`, body providers `provider-defined`);
- the **rollback pointer** references the previous deployment revision
  for the same environment+provider — `null` only for the first;
- records **round-trip** through serialization with validation on both
  ends (`serializeDeploymentRevisionRecord` /
  `parseDeploymentRevisionRecord`).

## The registrar

`DeploymentRevisionRegistrar` is the interface later waves implement
against durable stores; `InMemoryDeploymentRevisionRegistrar` is the
deterministic reference implementation used by tests and local tooling.
Registration is **append-only**: re-registering an existing revision id
is rejected, and a record whose rollback pointer does not extend the
actual chain is rejected — the pointer chain is the rollback path, so it
cannot lie.

```ts
const registrar = new InMemoryDeploymentRevisionRegistrar();
registrar.register({ ...first, rollback_pointer: { previous_deployment_revision_id: null } });
registrar.register({ ...second, rollback_pointer: { previous_deployment_revision_id: 'dpl-preview-0001' } });
registrar.latest('preview', 'vercel');          // the current deployment
registrar.rollbackTarget('preview', 'vercel');  // 'dpl-preview-0001' — where a rollback lands
```

## Registration flow (when validation accounts exist)

1. CI builds from the exact merged head sha and deploys (preview first,
   then production after preview evidence).
2. CI registers a revision record per provider per environment: source
   sha from the checkout, deployment revision id from the provider's
   deployment API response, region from the deployment target,
   registered-at from the CI clock, rollback pointer from the current
   chain tip.
3. Registration lands in System State (the live-data waves wire the
   registrar interface to the durable store) — this package deliberately
   ships only the contract and the reference implementation, because no
   real store credentials exist yet.
4. The completion/evidence discipline then requires the exact deployment
   revision in every task completion record (the release standard of
   `docs/implementation/PRODUCTIZATION-HANDOFF.md`).

## Status

NOT_YET_DEPLOYED: no deployment revision records exist for real systems.
What exists today is the contract (validated shape, chain semantics,
round-trip) proven by deterministic tests — including negative tests for
bad shas, out-of-contract regions, malformed instants, broken chains and
duplicate registrations. First real records arrive with the validation
accounts.
