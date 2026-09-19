/**
 * Producer — WHO or WHAT produced a record (the W3 realization of the
 * provenance-chain producer description from the W3 Work Order:
 * "tool, model+version if LLM-involved, command, environment").
 *
 * Single authority: this package defines the producer shape once; the
 * telemetry and evidence packages import it (no duplication).
 *
 * LLM discipline (spec/architecture.md §18, spec/meta-model.md):
 * `model !== null` marks LLM-involved output. Such records are never
 * authoritative (see record.ts `isNonAuthoritativeProvenance`).
 */

import { ProvenanceError } from './errors.js';

export interface Producer {
  /** Producing tool (e.g. "vitest", "otel-collector"). Non-empty. */
  tool: string;
  /** Tool version, or null. */
  tool_version: string | null;
  /** Model id when LLM-involved, or null. */
  model: string | null;
  /** Model version, or null (only meaningful when model is set). */
  model_version: string | null;
  /** The command that produced the record (e.g. "pnpm -r test"), or null. */
  command: string | null;
  /** Environment description (e.g. "ci:github-actions:ubuntu-24.04"), or null. */
  environment: string | null;
}

const PRODUCER_KEYS = ['tool', 'tool_version', 'model', 'model_version', 'command', 'environment'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullOrNonEmptyString(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.length > 0);
}

/** Structural check (exact 6-field shape, string fields null-or-non-empty). */
export function isProducer(value: unknown): value is Producer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = new Set<string>(PRODUCER_KEYS);
  if (actual.length !== PRODUCER_KEYS.length || !actual.every((key) => expected.has(key))) {
    return false;
  }
  if (!isNonEmptyString(record['tool'])) {
    return false;
  }
  return ['tool_version', 'model', 'model_version', 'command', 'environment'].every((key) =>
    isNullOrNonEmptyString(record[key]),
  );
}

/** Full validation with a specific error message (throws ProvenanceError). */
export function assertValidProducer(value: unknown): asserts value is Producer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProvenanceError('producer must be an object with exact fields { tool, tool_version, model, model_version, command, environment }');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = new Set<string>(PRODUCER_KEYS);
  if (actual.length !== PRODUCER_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new ProvenanceError('producer must be an object with exact fields { tool, tool_version, model, model_version, command, environment }');
  }
  if (!isNonEmptyString(record['tool'])) {
    throw new ProvenanceError(`producer.tool must be a non-empty string, received: ${JSON.stringify(record['tool'])}`);
  }
  for (const key of ['tool_version', 'model', 'model_version', 'command', 'environment'] as const) {
    if (!isNullOrNonEmptyString(record[key])) {
      throw new ProvenanceError(`producer.${key} must be null or a non-empty string, received: ${JSON.stringify(record[key])}`);
    }
  }
  // A model version without a model id is meaningless and rejected loudly.
  if (record['model_version'] !== null && record['model'] === null) {
    throw new ProvenanceError(
      'producer.model_version is set but producer.model is null (a model version requires a model id)',
    );
  }
}

/** Predicate form of assertValidProducer. */
export function validateProducer(value: unknown): value is Producer {
  try {
    assertValidProducer(value);
    return true;
  } catch {
    return false;
  }
}

/** True iff the producer is LLM-involved (a model id is present). */
export function isLlmProducer(producer: Producer): boolean {
  return producer.model !== null;
}
