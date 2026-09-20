/**
 * @sos-2/evidence — SOS 2.0 Evidence (Work Order W3).
 *
 * The Evidence Graph and telemetry ingestion contracts:
 *   - evidence records carrying the 6 frozen truth states (imported from the
 *     spine — NEVER redefined) with exact source/deployment revisions,
 *     time windows and explicit truth-state assignment method provenance;
 *   - the observation/intervention distinction — exactly one class per
 *     record, never conflated; strong causal claims require intervention
 *     evidence;
 *   - confidence discipline: calibrated numeric confidence ONLY with a
 *     calibration artifact ref (and never for LLM producers); qualitative
 *     uncertainty classes otherwise;
 *   - stale-evidence detection: evaluateFreshness with DISTINCT statuses for
 *     expired time windows, superseded subject revisions and unknown
 *     provenance;
 *   - telemetry ingestion (ingestObservation): verbatim truth-state
 *     assignment from validated raw observations — UNAVAILABLE is never
 *     interpreted as zero or absence-of-failure;
 *   - the Evidence Graph: records + spine typed trace links, with
 *     evidence-to-System-State traceability as a first-class query.
 *
 * All identities, canonical serialization, truth states, trace links and the
 * evidence contract TYPE come from @sos-2/semantic-spine (the single
 * sanctioned authority); producers, time windows and revision tokens come
 * from @sos-2/provenance; raw observations come from @sos-2/telemetry.
 * Nothing here duplicates an authority; invalid evidence always fails loudly.
 */

export * from './classification.js';
export * from './confidence.js';
export * from './errors.js';
export * from './freshness.js';
export * from './graph.js';
export * from './ingest.js';
export * from './record.js';
