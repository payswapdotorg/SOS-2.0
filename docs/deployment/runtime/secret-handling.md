# Secret Handling

Secret values are never echoed, logged or serialized. The machine-checked
policy is `infra/deployment/src/secrets/policy.ts`, pinned by
`infra/deployment/test/secrets.test.ts`; the classification lives in the
environment registry (`secret: true` flags — see
[environment-matrix.md](environment-matrix.md)).

## Classification

- Registry classification: every credential-carrying variable is declared
  `secret: true` (tokens, connection strings with credentials, webhook
  secrets, access keys — 10 of the 20 registry variables).
- Conservative fallback: an UNREGISTERED variable whose NAME looks
  secret-shaped (`*_TOKEN`, `*_SECRET`, `*_KEY`, `*_PASSWORD`,
  `*_CREDENTIAL*`) is treated as a secret — unknown variables can never
  leak into public logs by classification default.

## The never-echo rule, structurally

Loaded environment records keep secret values **in a closure**, reachable
only via `getSecretValue(name)`. Functions do not serialize: any
accidental `JSON.stringify(record)` produces names with `[REDACTED]`
markers and zero value material. The only sanctioned serialization path
is `serializeEnvironment()` (and `redactRawSource()` for raw records),
both emitting the redacted view. Tests pin that serialized output of a
fully-loaded environment contains none of the secret values.

## Detection (secret-shape patterns)

The policy carries a deterministic pattern corpus (pure regexes, no
entropy randomness): classic and fine-grained GitHub tokens, GitHub
app/client secrets, Slack bot tokens, AWS access key ids, private key
blocks, JWTs, credential-bearing postgres/redis/https URLs, generic
`SECRET=...`-style assignments, and `sk-…` provider keys. Findings carry
**label, line, column and pattern id only** — never the matched text.

## Presence validation (names only)

`assertRequiredSecretsPresent(tier, source)` validates that every
REQUIRED secret for a tier is present — by NAME. The failure message
lists the missing names and explicitly never reads, echoes or logs
values. Absence fails closed; presence says nothing about the value
(shape validation happens at load time, separately).

## CI wiring

`infra/deployment/scripts/secret-scan.mjs` scans the P3-owned
deliverable files (package source/scripts/config, the deployment
workflow definitions, the thin caller, and these runtime docs) and fails
the build on any secret-shaped finding — names and positions only. It is
wired into `.github/workflows/deployment/contract-verify.yml` and runs
on every pull request and push to main. The scan scope excludes
`infra/deployment/test/` because the test corpus intentionally contains
SYNTHETIC secret-shaped fixtures (clearly synthetic values used to prove
the detection corpus works); keeping them out of deliverable files is
exactly what the scan enforces.

## Operational rules

- Real secrets live only in the deployment surfaces' secret stores
  (Vercel project environment settings scoped per environment dimension,
  GitHub Actions secrets for CI) — never in the repository, never in
  docs, never in logs.
- CI failure messages report variable names and pattern ids, never
  values — this rule is encoded in the CI topology contract and in the
  scanner output format.
- Local fixtures are credential-free by design (the local `DATABASE_URL`
  fixture has no user:password material); there is no "local test
  credential" that could leak.
- If a secret-shaped value ever appears in a scan, the response is to
  remove it and rotate the credential if it was real — not to widen the
  exclusion scope.
