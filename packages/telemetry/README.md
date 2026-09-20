# @sos-2/telemetry

SOS 2.0 Telemetry (Work Order W3, parallel slot C). The **TelemetrySource
ingestion contract** (pull- and push-based) producing validated, normalized
raw observations with capture-level availability marking — plus an
OpenTelemetry-compatible adapter.

**Telemetry is INPUT, not semantic truth**: truth-state assignment happens in
the evidence layer (`@sos-2/evidence` `ingestObservation`), with explicit
method provenance. This package never decides what an observation MEANS.

## What lives here

| Export | Purpose |
| --- | --- |
| `RawObservation` | the normalized output of ingestion: `subject_ref`, `availability` (capture-level, one of the 6 frozen truth states imported from the spine), `window`, `observed`, `attributes`, `producer` |
| `assertValidRawObservation` / `rawObservationHash` | loud validation and deterministic content hashing (64 hex) — the hash is the evidence layer's bit-exact provenance reference |
| `TelemetrySource` | the ingestion CONTRACT: `fetch(query)` (pull) and optional `subscribe(listener)` (push) that production backends implement behind |
| `InMemoryTelemetrySource` | the in-memory adapter: push/fetch/subscribe, explicit gap recording (`recordGap`) and automatic gap detection for watched subjects, explicit UNSUPPORTED surfacing |
| `OtelSpan` / `OtelMetricDataPoint` / `OtelLogRecord` | OpenTelemetry-compatible shapes MODELED AS TYPES (spans, metric data points, log records) — no OTel SDK is imported at runtime |
| `convertOtelSpan` / `convertOtelMetricDataPoint` / `convertOtelLogRecord` / `convertOtelBatch` | pure converters from OTel shapes to validated `RawObservation`s (OTel is an ADAPTER/substrate — platform neutrality, spec/architecture.md §17) |
| `nanosToRfc3339` | unix-nanoseconds → RFC3339 conversion used by the span converter |

## Gap discipline (never silence)

A source with no data for a watched subject/window surfaces an explicit
**UNAVAILABLE** observation; unsupported subjects surface explicit
**UNSUPPORTED** observations. Nothing is interpreted as zero or as
absence-of-failure (spec/architecture-lock.md). OTel status `UNSET` maps to
capture-level **UNKNOWN** (unknown is NOT unavailable); status `ERROR` and
error-severity logs map to **FAILURE**.

## Layering

```
@sos-2/semantic-spine (W0.5, frozen)  ←  @sos-2/telemetry (this package)
@sos-2/provenance     (W3 sibling)    ←     (Producer, TimeWindow)
                                          @sos-2/evidence consumes RawObservation
```

Raw observations are deliberately NOT spine artifacts — they are pre-semantic
input; traceability is established by the evidence layer, which records the
observation content hash in the evidence record's provenance.

## Fixtures

`fixtures/` holds golden OTel span/metric/log records and their converted raw
observations (bit-exact, pinned by tests; see `fixtures/README.md`).

## Invariants pinned by tests

- A gap is UNAVAILABLE with a null payload — never SUCCESS, never zero.
- UNSUPPORTED stays distinct from UNAVAILABLE.
- OTel status UNSET → UNKNOWN (not UNAVAILABLE); ERROR → FAILURE.
- No network, no collector, no OTel SDK at runtime — converters are pure and
  total over validated shapes; invalid shapes fail loudly.
- Deterministic fetch order, defensive copies, deterministic hashes and
  canonical round trips (property tests, seed 424242).
