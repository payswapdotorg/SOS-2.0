/**
 * The JSON/raw import — the ADVANCED onboarding mode (Work Order P4:
 * "JSON/raw import remains an advanced mode", typed, clearly secondary).
 *
 * The advanced mode accepts a raw JSON mission draft (the same
 * MissionContent vocabulary the greenfield journey formalizes into)
 * plus an optional repository link, validates it with the DOMAIN's own
 * validator, and reuses the same confirmation machinery. It is
 * presented as clearly secondary to the guided journeys: the surface
 * labels it "Advanced" and the guidance says so.
 */

import { validateMissionContent } from '@sos-2/mission';
import type { MissionContent } from '@sos-2/mission';
import type { GreenfieldValidationError } from './greenfield';
import type { OnboardingVmCore } from './review-core';
import { ONBOARDING_CONFIRMATION_PERMISSION, assertValidOnboardingVmCore } from './review-core';
import type { DataSource } from '@sos-2/web-contracts';

/** The closed validation-error vocabulary of the advanced import. */
export const ADVANCED_IMPORT_VALIDATION_CODES = [
  'NOT_JSON',
  'NOT_AN_OBJECT',
  'MISSING_MISSION',
  'DOMAIN_REJECTED',
  'AUTHORITY_NOT_CONFIRMED',
] as const;

export type AdvancedImportValidationCode = (typeof ADVANCED_IMPORT_VALIDATION_CODES)[number];

export interface AdvancedImportValidationError {
  code: AdvancedImportValidationCode;
  message: string;
}

/** The advanced import draft (raw text in, validated content out). */
export interface AdvancedImportDraft {
  /** The raw JSON text the user pasted (or null while empty). */
  raw_text: string | null;
  /** The explicit authority confirmation (the same REVISE-class gate as the guided journeys). */
  authority_confirmed: boolean;
}

/** The empty advanced draft. */
export function emptyAdvancedImportDraft(): AdvancedImportDraft {
  return { raw_text: null, authority_confirmed: false };
}

/** Validate an advanced import draft (typed errors; the domain validator is the authority). */
export function validateAdvancedImport(draft: AdvancedImportDraft): {
  valid: boolean;
  content: MissionContent | null;
  errors: AdvancedImportValidationError[];
} {
  const errors: AdvancedImportValidationError[] = [];
  if (draft.raw_text === null || draft.raw_text.trim().length === 0) {
    errors.push({ code: 'MISSING_MISSION', message: 'Paste a mission JSON draft — or better, use the guided greenfield journey.' });
    return { valid: false, content: null, errors };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(draft.raw_text);
  } catch (cause) {
    errors.push({ code: 'NOT_JSON', message: `The text is not valid JSON: ${(cause as Error).message}` });
    return { valid: false, content: null, errors };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    errors.push({ code: 'NOT_AN_OBJECT', message: 'The JSON draft must be an object with the mission content fields (purpose, goals, outcomes, ...).' });
    return { valid: false, content: null, errors };
  }
  const record = parsed as Record<string, unknown>;
  const missionRecord = 'mission' in record ? record['mission'] : parsed;
  try {
    validateMissionContent(missionRecord);
  } catch (cause) {
    errors.push({ code: 'DOMAIN_REJECTED', message: `The mission domain validator rejected the draft: ${(cause as Error).message}` });
    return { valid: false, content: null, errors };
  }
  if (!draft.authority_confirmed) {
    errors.push({ code: 'AUTHORITY_NOT_CONFIRMED', message: `Formalizing a mission from raw JSON requires the same explicit ${ONBOARDING_CONFIRMATION_PERMISSION}-class confirmation as the guided journey.` });
  }
  return { valid: errors.length === 0, content: missionRecord as MissionContent, errors };
}

/** The advanced import stage view model (clearly secondary). */
export interface AdvancedImportVm {
  core: OnboardingVmCore;
  validation: AdvancedImportValidationError[];
}

/** Project the advanced import view model. */
export function projectAdvancedImport(input: { draft: AdvancedImportDraft; data_source: DataSource }): AdvancedImportVm {
  const { draft, data_source } = input;
  const validation = validateAdvancedImport(draft);
  const core: OnboardingVmCore = {
    subject_id: 'onboarding:advanced:raw-import',
    data_source: data_source.kind === 'DEMO' ? { ...data_source, label: data_source.label } : data_source,
    what: 'The advanced raw-JSON mission import — for users who already have a mission draft as JSON.',
    why: {
      basis: 'Raw JSON import is the escape hatch for machine-written drafts; the guided greenfield journey is the primary path (this mode is clearly secondary).',
      basis_refs: [],
    },
    evidence_refs: [],
    uncertainty: {
      uncertainty_class: 'UNQUANTIFIED',
      statement: 'A pasted draft is trusted only after the domain validator accepts it and you confirm your authority — never before.',
    },
    authority: {
      mode: 'SUPERVISED',
      required_permission: ONBOARDING_CONFIRMATION_PERMISSION,
      grant_ref: null,
      note: `Formalizing from raw JSON requires the same explicit ${ONBOARDING_CONFIRMATION_PERMISSION}-class confirmation as the guided journey.`,
    },
    next_allowed_action: {
      action_id: 'advanced-import-continue',
      kind: 'DECIDE',
      label: validation.valid ? 'Confirm and formalize the mission' : 'Resolve the draft findings',
      description: validation.valid
        ? 'The draft passes the domain validator — the explicit authority confirmation gate is next.'
        : 'The draft has findings that must be resolved before it can be formalized.',
      href: null,
      rationale_ref: null,
      requires_authority: ONBOARDING_CONFIRMATION_PERMISSION,
    },
  };
  assertValidOnboardingVmCore(core);
  return { core, validation: validation.errors };
}

/** Re-export for the surface (typed greenfield-compatible errors). */
export type { GreenfieldValidationError };
