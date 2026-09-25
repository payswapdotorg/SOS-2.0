/**
 * MISSION INTAKE (Work Order P13) — the first stage of the §11 flagship
 * journey: "user mission -> SOS formalizes mission".
 *
 * Intake is TYPED RECORDS ONLY:
 *
 *   - the RAW USER MISSION as captured from the product (statement,
 *     repository context, provenance, caller-supplied instant);
 *   - the FORMALIZED MISSION as a @sos-2/mission MissionArtifact (the
 *     merged mission model — consumed, never re-defined);
 *   - or a TYPED ASK when formalization cannot proceed (empty mission,
 *     irrevocably ambiguous mission). ASK IS A SUCCESS STATE.
 *
 * Formalization itself runs through the INJECTABLE MissionFormalizerPort.
 * The reference implementation (./reference/formalizer.ts) is
 * deterministic; a real reasoning provider attaches later behind the same
 * seam and its output remains NON-AUTHORITATIVE (the port returns typed
 * records validated here — a formalizer can never mint authority).
 */

import type { MissionArtifact } from '@sos-2/mission';
import { assertValidMission } from '@sos-2/mission';
import { RFC3339_PATTERN } from '@sos-2/semantic-spine';
import { InvalidMissionIntakeError } from './errors.js';
import type { PipelineAsk } from './asks.js';

/** The raw user mission exactly as the product captured it. */
export interface RawUserMission {
  /** The user's mission statement (may be empty — an honest typed ASK follows). */
  readonly statement: string;
  /** The connected repository slug ('owner/name'), when the journey already connected one. */
  readonly repositorySlug: string | null;
  /** RFC3339 capture instant (caller-supplied; no hidden clocks). */
  readonly capturedAt: string;
  /** Provenance of the capture (non-empty, e.g. 'web-console:greenfield'). */
  readonly source: string;
}

/** The typed outcome of mission intake. */
export type MissionIntakeOutcome =
  | {
      readonly kind: 'FORMALIZED';
      readonly mission: MissionArtifact;
      /** Local ids of mission ambiguities the formalizer resolved (traceability). */
      readonly ambiguitiesResolved: readonly string[];
    }
  | {
      readonly kind: 'ASK';
      readonly ask: PipelineAsk;
    };

/**
 * The formalization seam. Implementations are replaceable MECHANISMS
 * (managed reasoning default, BYO optional): their output is typed records
 * validated by this package and is never authority.
 */
export interface MissionFormalizerPort {
  formalize(raw: RawUserMission): MissionFormalizationResult;
}

export type MissionFormalizationResult =
  | { readonly kind: 'FORMALIZED'; readonly mission: MissionArtifact; readonly ambiguitiesResolved: readonly string[] }
  | { readonly kind: 'ASK'; readonly ask: PipelineAsk };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate a raw user mission (throws InvalidMissionIntakeError). */
export function assertValidRawUserMission(value: unknown): asserts value is RawUserMission {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidMissionIntakeError('raw user mission must be an object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = ['statement', 'repositorySlug', 'capturedAt', 'source'];
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new InvalidMissionIntakeError(
      `raw user mission must have the exact field set { ${expected.join(', ')} }, received keys: ${JSON.stringify(keys)}`,
    );
  }
  if (typeof record['statement'] !== 'string') {
    throw new InvalidMissionIntakeError(`statement must be a string (possibly empty — an honest typed ASK follows), received: ${JSON.stringify(record['statement'])}`);
  }
  if (record['repositorySlug'] !== null && !isNonEmptyString(record['repositorySlug'])) {
    throw new InvalidMissionIntakeError(`repositorySlug must be 'owner/name' or null, received: ${JSON.stringify(record['repositorySlug'])}`);
  }
  if (typeof record['capturedAt'] !== 'string' || !RFC3339_PATTERN.test(record['capturedAt'])) {
    throw new InvalidMissionIntakeError(`capturedAt must be an RFC3339 literal, received: ${JSON.stringify(record['capturedAt'])}`);
  }
  if (!isNonEmptyString(record['source'])) {
    throw new InvalidMissionIntakeError(`source must be a non-empty provenance string, received: ${JSON.stringify(record['source'])}`);
  }
}

/**
 * Run mission intake: validate the raw mission, route it through the
 * injected formalizer and return the TYPED outcome. A formalized mission
 * is re-validated through the merged mission model's own guards (a
 * malformed formalizer output is a loud typed error — never accepted).
 */
export function runMissionIntake(raw: RawUserMission, formalizer: MissionFormalizerPort): MissionIntakeOutcome {
  assertValidRawUserMission(raw);
  if (typeof formalizer !== 'object' || formalizer === null || typeof formalizer.formalize !== 'function') {
    throw new InvalidMissionIntakeError('runMissionIntake requires an injected MissionFormalizerPort (no hidden mechanisms)');
  }
  const result = formalizer.formalize(raw);
  if (result.kind === 'ASK') {
    return { kind: 'ASK', ask: result.ask };
  }
  // The formalized mission must satisfy the merged model's own guards —
  // the seam's output is validated, never trusted.
  assertValidMission(result.mission);
  return { kind: 'FORMALIZED', mission: result.mission, ambiguitiesResolved: [...result.ambiguitiesResolved] };
}
