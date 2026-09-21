# @sos-2/api — the SOS 2.0 Live API service (Work Order P2)

A plain Node + TypeScript service (repo-standard ESM + tsc build, no vendor
framework) implementing `@sos-2/api-contracts` over `@sos-2/live-store`
ports. The in-memory reference backend serves today; provider adapters
(Neon / Upstash / R2) attach in later waves WITHOUT contract change.

## Route surface

| Route | Behavior |
| --- | --- |
| `GET /health` | typed per-provider availability (`UNKNOWN`/`UNAVAILABLE` when unconfigured — never fabricated) |
| `GET /mission` | list, seek pagination (`?limit`, `?cursor`) |
| `GET /mission/:id` | read; `x-sos-artifact-id` + `x-sos-revision` headers |
| `PUT /mission` | write; idempotent (`STORED`/`IDENTICAL`), CAS via `x-sos-expected-revision`, typed `CONFLICT` (409) |
| ... | same for `/system-state`, `/evidence`, `/task`, `/body-lease`, `/observation` |
| `POST /events` | event ingestion with replay protection: `201 APPLIED` or `409 DUPLICATE` with the first receipt |

Every failure is a typed error envelope (`INVALID` 400, `NOT_FOUND` 404,
`CONFLICT`/`DUPLICATE` 409, `UNAVAILABLE` 503, `UNKNOWN` 500) — provider
outages remain truthful UNAVAILABLE/UNKNOWN states, never fabricated
success, never silent absence-of-failure.

## Hosting neutrality

The request handler is TRANSPORT-AGNOSTIC (`ApiRequest` -> `ApiResponse`,
plain data from `@sos-2/api-contracts`): the same handler runs as a plain
Node process here and can be hosted in Vercel functions or an external
worker boundary later WITHOUT contract change. No long-running work inside
the request lifetime — handlers perform bounded store operations only
(bodies over 1 MiB are rejected typed).

## Run

```bash
pnpm --filter @sos-2/api dev        # default port 8788 (override with API_PORT)
```

The composition root is the only impure boundary (mirroring
`apps/console`): `SystemClock` and the port are injected at startup;
everything deeper is deterministic and clock-injected.
