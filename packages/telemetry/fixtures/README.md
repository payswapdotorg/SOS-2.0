# Golden OTel Adapter Fixtures (W3)

Canonical input/output pairs pinning the OpenTelemetry adapter conversion
bit-exactly. The conversion is pure and deterministic: identical input
reproduces the identical raw observation (pinned by
`test/otel.test.ts`, including canonical round trips).

| Fixture pair | Signal | Availability rule |
| --- | --- | --- |
| `otel-span.json` → `raw-observation-span.json` | span, status ERROR | ERROR → `FAILURE` (OK → `SUCCESS`, UNSET → `UNKNOWN`) |
| `otel-metric.json` → `raw-observation-metric.json` | GAUGE datapoint | value observed → `SUCCESS` (presence semantics; outcome interpretation belongs to the evidence layer) |
| `otel-log.json` → `raw-observation-log.json` | log, severity 17 (ERROR) | severity >= 17 → `FAILURE`, else `UNKNOWN` |

Shared conversion rules:

- `subject_ref` = `otel:service:<resource.attributes["service.name"]>`
  (service.name is REQUIRED — conversion fails loudly without it).
- `window` = RFC3339 millisecond precision derived from unix nanos (full
  nano precision preserved inside `observed`).
- `producer` derived from resource attributes (`telemetry.sdk.version`,
  `deployment.environment.name` / `service.namespace`).
- `attributes` = the OTel resource attributes.

These are contract test data, not evidence claims about any system.
